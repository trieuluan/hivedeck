use std::collections::HashSet;

use axum::{
    Json,
    extract::{Query, State},
    response::Json as ResponseJson,
};
use db::models::{
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcess, ExecutionProcessStatus},
    issue::Issue,
    issue_workspace::IssueWorkspace,
    repo::Repo,
    requests::{
        CloseOrchestratorResponse, CreateAndStartWorkspaceRequest, CreateAndStartWorkspaceResponse,
        CreateWorkspaceApiRequest, OrchestratorStatus, SpawnOrchestratorRequest,
        SpawnOrchestratorResponse, WorkspaceRepoInput,
    },
    scratch::{DraftWorkspaceRepo, Scratch, ScratchPayload, ScratchType},
    session::Session,
    workspace::{CreateWorkspace, Workspace, WorkspaceKind},
};
use deployment::Deployment;
use executors::{executors::BaseCodingAgent, profile::ExecutorConfig};
use services::services::container::ContainerService;
use utils::response::ApiResponse;
use uuid::Uuid;
use workspace_manager::WorkspaceError;

use crate::{DeploymentImpl, error::ApiError, routes::sessions::run_follow_up};

pub(crate) async fn create_workspace_record(
    deployment: &DeploymentImpl,
    name: Option<String>,
    kind: Option<WorkspaceKind>,
) -> Result<Workspace, ApiError> {
    let workspace_id = Uuid::new_v4();
    let branch_label = name
        .as_deref()
        .filter(|branch_label| !branch_label.is_empty())
        .unwrap_or("workspace");
    let git_branch_name = deployment
        .container()
        .git_branch_from_workspace(&workspace_id, branch_label)
        .await;

    let workspace = Workspace::create(
        &deployment.db().pool,
        &CreateWorkspace {
            branch: git_branch_name,
            name: name.filter(|workspace_name| !workspace_name.is_empty()),
            kind,
        },
        workspace_id,
    )
    .await?;

    Ok(workspace)
}

pub async fn create_workspace(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateWorkspaceApiRequest>,
) -> Result<ResponseJson<ApiResponse<Workspace>>, ApiError> {
    let workspace = create_workspace_record(&deployment, payload.name, None).await?;

    Ok(ResponseJson(ApiResponse::success(workspace)))
}

/// Project default repos (from the `PROJECT_REPO_DEFAULTS` scratch — the same
/// source the web UI's create flow reads) that the caller did not already
/// supply and that still exist, as `WorkspaceRepoInput`s on their configured
/// target branch. Dedup is by `repo_id` (caller entries always win, and each
/// `repo_id` is emitted at most once even if the scratch lists it twice), so a
/// repo is never attached twice; stale repo ids (no longer in
/// `existing_repo_ids`) are skipped, mirroring the UI's
/// `getValidProjectRepoDefaults` filter.
fn sibling_repo_inputs(
    caller_repos: &[WorkspaceRepoInput],
    project_defaults: &[DraftWorkspaceRepo],
    existing_repo_ids: &HashSet<Uuid>,
) -> Vec<WorkspaceRepoInput> {
    let mut seen: HashSet<Uuid> = caller_repos.iter().map(|r| r.repo_id).collect();
    project_defaults
        .iter()
        .filter(|d| existing_repo_ids.contains(&d.repo_id))
        .filter(|d| seen.insert(d.repo_id))
        .map(|d| WorkspaceRepoInput {
            repo_id: d.repo_id,
            target_branch: d.target_branch.clone(),
        })
        .collect()
}

fn normalize_prompt(prompt: &str) -> Option<String> {
    let trimmed = prompt.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub async fn create_and_start_workspace(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateAndStartWorkspaceRequest>,
) -> Result<ResponseJson<ApiResponse<CreateAndStartWorkspaceResponse>>, ApiError> {
    let CreateAndStartWorkspaceRequest {
        name,
        repos,
        linked_issue,
        executor_config,
        prompt,
        attachment_ids,
        kind,
        mcp_servers,
        skills,
    } = payload;

    let workspace_prompt = normalize_prompt(&prompt).ok_or_else(|| {
        ApiError::BadRequest(
            "A workspace prompt is required. Provide a non-empty `prompt`.".to_string(),
        )
    })?;

    if repos.is_empty() {
        return Err(ApiError::BadRequest(
            "At least one repository is required".to_string(),
        ));
    }

    let mut managed_workspace = deployment
        .workspace_manager()
        .load_managed_workspace(create_workspace_record(&deployment, name, kind).await?)
        .await?;

    let pool = &deployment.db().pool;

    // Resolve the linked issue once (read-only). Feeds Fix 1 (link) and Fix 2 (repo union).
    let linked_local_issue = match &linked_issue {
        Some(li) => match Issue::find_by_id(pool, li.issue_id).await? {
            Some(issue) => Some(issue),
            None => {
                tracing::warn!(
                    "linked issue {} not found locally; skipping issue<->workspace link and project-repo expansion",
                    li.issue_id
                );
                None
            }
        },
        None => None,
    };

    // Fix 2: expand an issue-linked workspace to the project's full default repo
    // set so sibling path-dependency repos are mounted even when the caller
    // supplied only one. The source is the `PROJECT_REPO_DEFAULTS` scratch — the
    // same set the web UI's create flow reads — so MCP/orchestrator starts match
    // UI starts. Applies to every linked-issue workspace; the union is deduped by
    // `repo_id` (caller entries win), so it's a no-op when the caller already
    // sent the full set. Scratch read/parse failures degrade to no expansion.
    let sibling_repos: Vec<WorkspaceRepoInput> = match &linked_local_issue {
        Some(issue) => {
            match Scratch::find_by_id(pool, issue.project_id, &ScratchType::ProjectRepoDefaults)
                .await
            {
                Ok(Some(Scratch {
                    payload: ScratchPayload::ProjectRepoDefaults(defaults),
                    ..
                })) => {
                    let default_ids: Vec<Uuid> = defaults.repos.iter().map(|r| r.repo_id).collect();
                    let existing_repo_ids: HashSet<Uuid> = Repo::find_by_ids(pool, &default_ids)
                        .await?
                        .into_iter()
                        .map(|r| r.id)
                        .collect();
                    sibling_repo_inputs(&repos, &defaults.repos, &existing_repo_ids)
                }
                Ok(_) => Vec::new(),
                Err(e) => {
                    tracing::warn!(
                        "failed to read project repo defaults for project {} (skipping expansion): {}",
                        issue.project_id,
                        e
                    );
                    Vec::new()
                }
            }
        }
        None => Vec::new(),
    };

    for repo in &repos {
        managed_workspace
            .add_repository(repo, deployment.git())
            .await
            .map_err(ApiError::from)?;
    }

    for repo in &sibling_repos {
        match managed_workspace
            .add_repository(repo, deployment.git())
            .await
        {
            Ok(()) => {}
            Err(WorkspaceError::BranchNotFound { repo_name, branch }) => {
                tracing::warn!(
                    "skipping project sibling repo {} (branch '{}' not found): expanding project scope best-effort",
                    repo_name,
                    branch
                );
            }
            Err(e) => return Err(ApiError::from(e)),
        }
    }

    if let Some(ids) = &attachment_ids {
        managed_workspace.associate_attachments(ids).await?;
    }

    let workspace = managed_workspace.workspace.clone();
    tracing::info!("Created workspace {}", workspace.id);

    if let Some(ref servers) = mcp_servers
        && let Err(e) = Workspace::set_selected_mcp_servers(pool, workspace.id, servers).await
    {
        tracing::warn!(
            "failed to save selected MCP servers for workspace {}: {}",
            workspace.id,
            e
        );
    }

    if let Some(ref skill_names) = skills
        && let Err(e) = Workspace::set_selected_skills(pool, workspace.id, skill_names).await
    {
        tracing::warn!(
            "failed to save selected skills for workspace {}: {}",
            workspace.id,
            e
        );
    }

    // Fix 1: create the local issue<->workspace link before the terminal tab
    // opens (inside `start_workspace`) so `interactive_tab_title` finds it and
    // titles the tab from the card instead of falling back to the branch. All
    // hard-fail work (caller repos, attachments) has already succeeded by this
    // point, so a failed start never leaves a workspace linked.
    if let Some(issue) = &linked_local_issue
        && let Err(e) = IssueWorkspace::link(pool, issue.id, workspace.id).await
    {
        tracing::warn!(
            "failed to link workspace {} to issue {} before start (tab title falls back to branch): {}",
            workspace.id,
            issue.id,
            e
        );
    }

    let execution_process = deployment
        .container()
        .start_workspace(&workspace, executor_config.clone(), workspace_prompt)
        .await?;

    Ok(ResponseJson(ApiResponse::success(
        CreateAndStartWorkspaceResponse {
            workspace,
            execution_process,
        },
    )))
}

/// Build the executor config for the orchestrator: a headed Claude Code
/// session running HiveDeck's own captain (ADR-030). The container recognises
/// the captain's agent id and adds `--agents` (the captain's instructions from
/// `assets/captain/captain.md` or the owner's override) and `--mcp-config`
/// (this backend's `/mcp` endpoint), so no external plugin is required. The
/// `/loop` body the caller composes (see `composeOrchestratorPrompt`) is only
/// the short per-tick pointer.
///
/// ADR-031: Codex can be the captain too. It runs headless with the captain's
/// manual as developer instructions and the MCP endpoint wired by the
/// container; it never asks for approval (it only calls HiveDeck's MCP tools)
/// and the backend drives its loop (`captain_loop`).
fn orchestrator_executor_config(executor: BaseCodingAgent) -> ExecutorConfig {
    let is_codex = executor == BaseCodingAgent::Codex;
    // Headless agents (Codex, headless Claude) never stop to ask: Codex only
    // calls HiveDeck's tools, and headless Claude pre-approves just those.
    let headless = !executor.is_headed();
    ExecutorConfig {
        executor,
        variant: None,
        model_id: None,
        agent_id: (!is_codex).then(|| services::services::captain::AGENT_ID.to_string()),
        reasoning_id: None,
        permission_policy: headless.then_some(executors::model_selector::PermissionPolicy::Auto),
    }
}

/// Agents that can be the captain: the headed ones (own `/loop`) and Codex
/// (backend-driven loop).
fn is_captain_executor(executor: &BaseCodingAgent) -> bool {
    executor.is_headed()
        || matches!(
            executor,
            BaseCodingAgent::Codex | BaseCodingAgent::ClaudeCode
        )
}

/// Start the backend loop for a captain without its own `/loop`.
fn start_captain_loop(
    deployment: &DeploymentImpl,
    workspace_id: Uuid,
    executor_config: &ExecutorConfig,
    _interval: Option<std::time::Duration>,
    tick_prompt: String,
) {
    crate::captain_loop::start(
        deployment.clone(),
        crate::captain_loop::LoopInfo {
            workspace_id,
            executor: executor_config.executor,
            // Event-driven (ADR-035); the `/loop` interval is not used.
            interval: crate::captain_loop::HEARTBEAT,
        },
        executor_config.clone(),
        tick_prompt,
    );
}

/// ADR-032: which captain a request is about: a project's (`project_id`) or
/// the global one.
#[derive(Debug, serde::Deserialize, Default)]
pub struct CaptainScope {
    #[serde(default)]
    pub project_id: Option<Uuid>,
}

/// Prefix the per-tick body with the captain's project, so both a headed
/// `/loop` and backend ticks carry it. `/loop <interval>` stays first.
fn scope_prompt(prompt: &str, scope: Option<&str>) -> String {
    let Some(scope) = scope else {
        return prompt.to_string();
    };
    let trimmed = prompt.trim_start();
    if let Some(rest) = trimmed.strip_prefix("/loop ") {
        let rest = rest.trim_start();
        if let Some((interval, body)) = rest.split_once(char::is_whitespace) {
            return format!("/loop {interval} {scope}\n\n{}", body.trim_start());
        }
    }
    format!("{scope}\n\n{}", prompt.trim())
}

/// The scope line for a project's captain: name, id and repos on disk.
async fn project_scope_line(pool: &sqlx::SqlitePool, project_id: Uuid) -> Result<String, ApiError> {
    let project = db::models::project::Project::find_by_id(pool, project_id)
        .await?
        .ok_or_else(|| ApiError::BadRequest("Project not found.".to_string()))?;
    let repos = db::models::project_repo::ProjectRepo::list_repo_paths(pool, project_id).await?;
    let repos = if repos.is_empty() {
        "no repository linked yet".to_string()
    } else {
        repos.join(", ")
    };
    Ok(format!(
        "You are the captain of project \"{}\" (project_id {}; repos: {}). \
         Work only on this project's board and repos; ignore other projects.",
        project.name, project_id, repos
    ))
}

/// Spawn (or reuse) the singleton orchestrator.
///
/// The orchestrator is repo-independent and runs from a fixed
/// `~/.hivedeck/orchestrator` folder. There is at most one active
/// orchestrator workspace:
/// - if one is already running, its live tmux session is reused (`reused: true`);
/// - if one exists but is idle, its latest session is resumed when possible;
/// - otherwise the singleton workspace is created and started.
pub async fn spawn_orchestrator(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<SpawnOrchestratorRequest>,
) -> Result<ResponseJson<ApiResponse<SpawnOrchestratorResponse>>, ApiError> {
    let prompt = normalize_prompt(&payload.prompt)
        .ok_or_else(|| ApiError::BadRequest("An orchestrator prompt is required.".to_string()))?;
    let name = payload
        .name
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "Orchestrator".to_string());
    // Resolve the captain's agent: Claude Code Headed by default; any agent
    // that can't be the captain falls back to it.
    let executor = payload
        .executor
        .filter(is_captain_executor)
        .unwrap_or(BaseCodingAgent::ClaudeCodeHeaded);
    let executor_config = orchestrator_executor_config(executor);
    // Headed agents run the `/loop` themselves; for the others the backend
    // loops, so the agent only ever sees the per-tick body.
    let backend_loop = !executor.is_headed();
    let pool = &deployment.db().pool;
    let project_id = payload.project_id;
    let scope = match project_id {
        Some(pid) => Some(project_scope_line(pool, pid).await?),
        None => None,
    };
    let prompt = scope_prompt(&prompt, scope.as_deref());
    let (loop_interval, tick_prompt) = crate::captain_loop::split_loop_prompt(&prompt);
    let prompt = if backend_loop {
        crate::captain_loop::startup_message(&tick_prompt)
    } else {
        prompt
    };

    // Singleton: at most one active orchestrator workspace.
    if let Some(existing) = Workspace::find_captain(pool, project_id).await? {
        // A backend-driven captain is "on" between ticks too.
        if crate::captain_loop::active(existing.id).is_some() {
            return Ok(ResponseJson(ApiResponse::success(
                SpawnOrchestratorResponse {
                    workspace: existing,
                    reused: true,
                    resume_fallback: false,
                },
            )));
        }
        // Reuse only when a headed coding-agent session is *genuinely* live.
        // The DB `running` status lags behind a tmux session that ended
        // out-of-band (Claude exited, the `/loop` finished, or it crashed), so
        // attaching on the strength of the DB alone would drop the user into a
        // dead session. Confirm the tmux session itself is alive instead.
        let candidate =
            ExecutionProcess::find_latest_running_coding_agent_for_workspace(pool, existing.id)
                .await?;
        let live = match &candidate {
            Some(proc)
                if proc
                    .executor_action()
                    .is_ok_and(|a| a.interactive_config().is_none()) =>
            {
                // A headless run is live while the DB says it's running.
                true
            }
            Some(proc) => {
                deployment
                    .container()
                    .is_interactive_session_live(proc)
                    .await
            }
            None => false,
        };

        if live {
            // A session is already live — reuse its tmux session.
            return Ok(ResponseJson(ApiResponse::success(
                SpawnOrchestratorResponse {
                    workspace: existing,
                    reused: true,
                    resume_fallback: false,
                },
            )));
        }

        // DB still marks a coding-agent process running even though its tmux
        // session is gone; finalize it so the respawn starts from a clean slate
        // (and the liveness poller doesn't later double-finalize it).
        if let Some(stale) = candidate
            && let Err(e) = deployment
                .container()
                .stop_execution(&stale, ExecutionProcessStatus::Completed)
                .await
        {
            tracing::warn!(
                "Failed to finalize stale orchestrator process {}: {}",
                stale.id,
                e
            );
        }

        let mut resumed = false;
        let mut resume_fallback = false;
        if !payload.new_session {
            if let Some(session) = Session::find_latest_by_workspace_id(pool, existing.id).await? {
                let resume_info =
                    CodingAgentTurn::find_latest_session_info(pool, session.id).await?;
                if resume_info.is_some_and(|info| !info.session_id.trim().is_empty()) {
                    let resume_prompt = if backend_loop {
                        crate::captain_loop::tick_message(&tick_prompt)
                    } else {
                        crate::captain_loop::tick_message(&prompt)
                    };
                    match run_follow_up(
                        &deployment,
                        session,
                        existing.clone(),
                        resume_prompt,
                        executor_config.clone(),
                        None,
                        None,
                        None,
                    )
                    .await
                    {
                        // ponytail: later executor failures remain visible in execution status;
                        // add asynchronous fallback only with a safe retry policy.
                        Ok(_) => resumed = true,
                        Err(error) => tracing::warn!("Captain resume failed: {error:?}"),
                    }
                }
            }
            resume_fallback = !resumed;
        }
        if !resumed {
            deployment
                .container()
                .start_workspace(&existing, executor_config.clone(), prompt)
                .await?;
        }
        if backend_loop {
            start_captain_loop(
                &deployment,
                existing.id,
                &executor_config,
                loop_interval,
                tick_prompt,
            );
        }
        let workspace = Workspace::find_by_id(pool, existing.id)
            .await?
            .unwrap_or(existing);
        return Ok(ResponseJson(ApiResponse::success(
            SpawnOrchestratorResponse {
                workspace,
                reused: false,
                resume_fallback,
            },
        )));
    }

    // None exists — create the singleton orchestrator workspace and start it.
    // `branch` is just a label here; no git worktree is ever created for it.
    let workspace = Workspace::create(
        pool,
        &CreateWorkspace {
            branch: "orchestrator".to_string(),
            name: Some(name),
            kind: Some(WorkspaceKind::Orchestrator),
        },
        Uuid::new_v4(),
    )
    .await?;
    if let Some(pid) = project_id {
        Workspace::set_captain_project_id(pool, workspace.id, pid).await?;
    }

    deployment
        .container()
        .start_workspace(&workspace, executor_config.clone(), prompt)
        .await?;
    if backend_loop {
        start_captain_loop(
            &deployment,
            workspace.id,
            &executor_config,
            loop_interval,
            tick_prompt,
        );
    }

    let workspace = Workspace::find_by_id(pool, workspace.id)
        .await?
        .unwrap_or(workspace);

    Ok(ResponseJson(ApiResponse::success(
        SpawnOrchestratorResponse {
            workspace,
            reused: false,
            resume_fallback: false,
        },
    )))
}

/// Close the singleton orchestrator: stop its live headed session (killing the
/// tmux session). The singleton workspace itself
/// is preserved for reuse. No-op (`closed: false`) when no orchestrator — or no
/// running session — exists.
pub async fn close_orchestrator(
    State(deployment): State<DeploymentImpl>,
    Query(scope): Query<CaptainScope>,
) -> Result<ResponseJson<ApiResponse<CloseOrchestratorResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let Some(existing) = Workspace::find_captain(pool, scope.project_id).await? else {
        return Ok(ResponseJson(ApiResponse::success(
            CloseOrchestratorResponse { closed: false },
        )));
    };
    // Stop a backend-driven loop first so it can't start another tick.
    let loop_stopped = crate::captain_loop::stop(existing.id);

    let Some(process) =
        ExecutionProcess::find_latest_running_coding_agent_for_workspace(pool, existing.id).await?
    else {
        return Ok(ResponseJson(ApiResponse::success(
            CloseOrchestratorResponse {
                closed: loop_stopped,
            },
        )));
    };

    // Stop the headed session, killing its tmux session. If the tmux session
    // already vanished (so there's no tracked handle to stop), the process is
    // effectively gone already — finalize the DB record directly so it stops
    // reporting as running.
    if let Err(e) = deployment
        .container()
        .stop_execution(&process, ExecutionProcessStatus::Killed)
        .await
    {
        tracing::warn!(
            "stop_execution failed for orchestrator process {}: {}; marking killed",
            process.id,
            e
        );
        ExecutionProcess::update_completion(pool, process.id, ExecutionProcessStatus::Killed, None)
            .await?;
    }

    Ok(ResponseJson(ApiResponse::success(
        CloseOrchestratorResponse { closed: true },
    )))
}

/// Whether the captain is on, on which agent, and (for a backend-driven
/// loop) how often it ticks. A headed captain counts as on while its tmux
/// session is alive; a backend-driven one while its loop runs, including
/// between ticks.
pub async fn orchestrator_status(
    State(deployment): State<DeploymentImpl>,
    Query(scope): Query<CaptainScope>,
) -> Result<ResponseJson<ApiResponse<OrchestratorStatus>>, ApiError> {
    let pool = &deployment.db().pool;
    let captain = Workspace::find_captain(pool, scope.project_id).await?;
    let mut status = OrchestratorStatus {
        active: false,
        executor: None,
        loop_interval_secs: None,
        workspace_id: captain.as_ref().map(|w| w.id),
    };
    if let Some(info) = captain
        .as_ref()
        .and_then(|w| crate::captain_loop::active(w.id))
    {
        status.active = true;
        status.executor = Some(info.executor);
        status.loop_interval_secs = Some(info.interval.as_secs());
        return Ok(ResponseJson(ApiResponse::success(status)));
    }
    if let Some(existing) = captain
        && let Some(process) =
            ExecutionProcess::find_latest_running_coding_agent_for_workspace(pool, existing.id)
                .await?
    {
        let action = process.executor_action().ok();
        status.executor = action.and_then(|a| a.base_executor());
        status.active = match action {
            Some(a) if a.interactive_config().is_some() => {
                deployment
                    .container()
                    .is_interactive_session_live(&process)
                    .await
            }
            _ => true,
        };
    }
    Ok(ResponseJson(ApiResponse::success(status)))
}

#[cfg(test)]
mod scope_prompt_tests {
    use super::scope_prompt;
    use db::models::requests::SpawnOrchestratorRequest;

    #[test]
    fn new_session_is_opt_in() {
        let default: SpawnOrchestratorRequest =
            serde_json::from_str(r#"{"prompt":"tick"}"#).unwrap();
        let fresh: SpawnOrchestratorRequest =
            serde_json::from_str(r#"{"prompt":"tick","new_session":true}"#).unwrap();
        assert!(!default.new_session);
        assert!(fresh.new_session);
    }

    #[test]
    fn keeps_loop_prefix_first() {
        assert_eq!(
            scope_prompt("/loop 5m Run one tick.", Some("SCOPE")),
            "/loop 5m SCOPE\n\nRun one tick."
        );
    }

    #[test]
    fn plain_prompt_and_no_scope() {
        assert_eq!(scope_prompt("Do it", Some("SCOPE")), "SCOPE\n\nDo it");
        assert_eq!(scope_prompt("/loop 5m Do it", None), "/loop 5m Do it");
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use db::models::{requests::WorkspaceRepoInput, scratch::DraftWorkspaceRepo};
    use uuid::Uuid;

    use super::sibling_repo_inputs;

    fn default_repo(id: Uuid, target_branch: &str) -> DraftWorkspaceRepo {
        DraftWorkspaceRepo {
            repo_id: id,
            target_branch: target_branch.to_string(),
        }
    }

    #[test]
    fn sibling_repo_inputs_includes_existing_default_not_supplied_by_caller() {
        let sibling_id = Uuid::new_v4();
        let defaults = vec![default_repo(sibling_id, "main")];
        let existing: HashSet<Uuid> = [sibling_id].into_iter().collect();

        let result = sibling_repo_inputs(&[], &defaults, &existing);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].repo_id, sibling_id);
        assert_eq!(result[0].target_branch, "main");
    }

    #[test]
    fn sibling_repo_inputs_excludes_repo_already_supplied_by_caller() {
        let repo_id = Uuid::new_v4();
        let defaults = vec![default_repo(repo_id, "main")];
        let existing: HashSet<Uuid> = [repo_id].into_iter().collect();
        let caller_repos = vec![WorkspaceRepoInput {
            repo_id,
            target_branch: "feature".to_string(),
        }];

        let result = sibling_repo_inputs(&caller_repos, &defaults, &existing);

        assert!(result.is_empty());
    }

    #[test]
    fn sibling_repo_inputs_skips_stale_default_not_in_existing_repos() {
        let stale_id = Uuid::new_v4();
        let defaults = vec![default_repo(stale_id, "main")];
        let existing: HashSet<Uuid> = HashSet::new();

        let result = sibling_repo_inputs(&[], &defaults, &existing);

        assert!(result.is_empty());
    }

    #[test]
    fn sibling_repo_inputs_empty_defaults_yields_empty() {
        let result = sibling_repo_inputs(&[], &[], &HashSet::new());

        assert!(result.is_empty());
    }

    #[test]
    fn sibling_repo_inputs_dedups_duplicate_default_entries() {
        let sibling_id = Uuid::new_v4();
        let defaults = vec![
            default_repo(sibling_id, "main"),
            default_repo(sibling_id, "other"),
        ];
        let existing: HashSet<Uuid> = [sibling_id].into_iter().collect();

        let result = sibling_repo_inputs(&[], &defaults, &existing);

        // Emitted exactly once (first occurrence wins), so it is never attached twice.
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].repo_id, sibling_id);
        assert_eq!(result[0].target_branch, "main");
    }

    #[test]
    fn sibling_repo_inputs_caller_only_repo_not_in_defaults_is_unaffected() {
        let sibling_id = Uuid::new_v4();
        let defaults = vec![default_repo(sibling_id, "main")];
        let existing: HashSet<Uuid> = [sibling_id].into_iter().collect();
        let caller_only_repo = Uuid::new_v4();
        let caller_repos = vec![WorkspaceRepoInput {
            repo_id: caller_only_repo,
            target_branch: "feature".to_string(),
        }];

        let result = sibling_repo_inputs(&caller_repos, &defaults, &existing);

        assert_eq!(result.len(), 1);
        assert_eq!(result[0].repo_id, sibling_id);
        assert_eq!(result[0].target_branch, "main");
    }
}
