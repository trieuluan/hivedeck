use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
    response::Json as ResponseJson,
};
use db::models::{
    coding_agent_turn::CodingAgentTurn,
    execution_process::{ExecutionProcess, ExecutionProcessStatus},
    issue_workspace::IssueWorkspace,
    workspace::{Workspace, WorkspaceError},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use services::services::{container::ContainerService, project_config};
use sqlx::Error as SqlxError;
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;
use workspace_manager::WorkspaceManager;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize)]
pub struct DeleteWorkspaceQuery {
    #[serde(default)]
    pub delete_branches: bool,
}

#[derive(Debug, Deserialize, TS)]
pub struct CleanupFinishedWorkspacesRequest {
    #[serde(default)]
    pub project_id: Option<Uuid>,
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Debug, Serialize, TS)]
pub struct CleanupFinishedWorkspacesResponse {
    pub deleted_count: usize,
    pub skipped_running_count: usize,
}

pub async fn get_workspaces(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Workspace>>>, ApiError> {
    let pool = &deployment.db().pool;
    let workspaces = Workspace::fetch_all(pool).await?;
    Ok(ResponseJson(ApiResponse::success(workspaces)))
}

pub async fn get_workspace(
    Extension(workspace): Extension<Workspace>,
) -> Result<ResponseJson<ApiResponse<Workspace>>, ApiError> {
    Ok(ResponseJson(ApiResponse::success(workspace)))
}

/// Open (creating if needed) a persistent workspace-level tmux session in the
/// user's configured terminal emulator, so the workspace's working directory
/// pops up in a real terminal window.
pub async fn open_terminal(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    deployment
        .container()
        .open_workspace_terminal(&workspace)
        .await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn update_workspace(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<db::models::requests::UpdateWorkspace>,
) -> Result<ResponseJson<ApiResponse<Workspace>>, ApiError> {
    let pool = &deployment.db().pool;
    let is_archiving = request.archived == Some(true) && !workspace.archived;

    Workspace::update(
        pool,
        workspace.id,
        request.archived,
        request.pinned,
        request.name.as_deref(),
    )
    .await?;
    let updated = Workspace::find_by_id(pool, workspace.id)
        .await?
        .ok_or(WorkspaceError::WorkspaceNotFound)?;

    if is_archiving && let Err(e) = deployment.container().archive_workspace(workspace.id).await {
        tracing::error!("Failed to archive workspace {}: {}", workspace.id, e);
    }

    Ok(ResponseJson(ApiResponse::success(updated)))
}

pub async fn get_first_user_message(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Option<String>>>, ApiError> {
    let pool = &deployment.db().pool;
    let message = Workspace::get_first_user_message(pool, workspace.id).await?;
    Ok(ResponseJson(ApiResponse::success(message)))
}

pub async fn delete_workspace(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Query(query): Query<DeleteWorkspaceQuery>,
) -> Result<(StatusCode, ResponseJson<ApiResponse<()>>), ApiError> {
    delete_workspace_and_cleanup(&deployment, workspace, query.delete_branches).await?;
    Ok((StatusCode::ACCEPTED, ResponseJson(ApiResponse::success(()))))
}

pub(crate) async fn delete_workspace_and_cleanup(
    deployment: &DeploymentImpl,
    workspace: Workspace,
    delete_branches: bool,
) -> Result<(), ApiError> {
    let pool = &deployment.db().pool;
    let workspace_manager = deployment.workspace_manager();
    let workspace_id = workspace.id;

    if ExecutionProcess::has_running_non_dev_server_processes_for_workspace(pool, workspace_id)
        .await?
    {
        return Err(ApiError::Conflict(
            "Cannot delete workspace while processes are running. Stop all processes first."
                .to_string(),
        ));
    }

    let dev_servers =
        ExecutionProcess::find_running_dev_servers_by_workspace(pool, workspace_id).await?;

    for dev_server in dev_servers {
        tracing::info!(
            "Stopping dev server {} before deleting workspace {}",
            dev_server.id,
            workspace_id
        );

        if let Err(e) = deployment
            .container()
            .stop_execution(&dev_server, ExecutionProcessStatus::Killed)
            .await
        {
            tracing::error!(
                "Failed to stop dev server {} for workspace {}: {}",
                dev_server.id,
                workspace_id,
                e
            );
        }
    }

    let managed_workspace = workspace_manager.load_managed_workspace(workspace).await?;
    let deletion_context = managed_workspace.prepare_deletion_context().await?;
    let rows_affected = managed_workspace.delete_record().await?;

    if rows_affected == 0 {
        return Err(ApiError::Database(SqlxError::RowNotFound));
    }

    WorkspaceManager::spawn_workspace_deletion_cleanup(deletion_context, delete_branches);
    Ok(())
}

pub async fn cleanup_finished_workspaces(
    State(deployment): State<DeploymentImpl>,
    Json(request): Json<CleanupFinishedWorkspacesRequest>,
) -> Result<ResponseJson<ApiResponse<CleanupFinishedWorkspacesResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let candidates =
        IssueWorkspace::list_non_pinned_linked_with_status(pool, request.project_id).await?;

    let mut deleted_count = 0usize;
    let mut skipped_running_count = 0usize;

    for row in candidates {
        if row.workspace.kind.is_some_and(|k| k.is_no_worktree()) {
            continue;
        }
        if !project_config::is_finished_status(&row.status_name, row.status_is_terminal) {
            continue;
        }

        if request.dry_run {
            if ExecutionProcess::has_running_non_dev_server_processes_for_workspace(
                pool,
                row.workspace.id,
            )
            .await?
            {
                skipped_running_count += 1;
            } else {
                deleted_count += 1;
            }
            continue;
        }

        match delete_workspace_and_cleanup(&deployment, row.workspace, true).await {
            Ok(()) => deleted_count += 1,
            Err(ApiError::Conflict(_)) => skipped_running_count += 1,
            Err(err) => {
                tracing::warn!("Failed to clean up finished workspace: {}", err);
            }
        }
    }

    Ok(ResponseJson(ApiResponse::success(
        CleanupFinishedWorkspacesResponse {
            deleted_count,
            skipped_running_count,
        },
    )))
}

#[axum::debug_handler]
pub async fn mark_seen(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let pool = &deployment.db().pool;
    CodingAgentTurn::mark_seen_by_workspace_id(pool, workspace.id).await?;
    Ok(ResponseJson(ApiResponse::success(())))
}

#[derive(Debug, Serialize)]
pub struct WorkspaceMcpItem {
    pub name: String,
    pub summary: String,
    pub injection_mode: executors::plugins::McpInjectionMode,
    pub selected: bool,
}

#[derive(Debug, Serialize)]
pub struct WorkspaceMcpResponse {
    pub items: Vec<WorkspaceMcpItem>,
}

#[derive(Debug, Deserialize)]
pub struct UpdateWorkspaceMcpRequest {
    pub selected: Vec<String>,
}

#[axum::debug_handler]
pub async fn get_workspace_mcp_servers(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<WorkspaceMcpResponse>>, ApiError> {
    let pool = &deployment.db().pool;
    let selected = Workspace::get_selected_mcp_servers(pool, workspace.id).await?;
    let dir = utils::assets::asset_dir();
    let plugins = executors::plugins::read_plugins(&dir).unwrap_or_default();

    let mut items = Vec::new();
    let mut seen = std::collections::BTreeSet::new();
    for plugin in plugins {
        if !plugin.enabled {
            continue;
        }
        for entry in plugin.mcp {
            if !entry.enabled
                || entry.name == "hivedeck"
                || !entry.roles.iter().any(|r| r == "crew")
                || !seen.insert(entry.name.clone())
            {
                continue;
            }
            let summary: String = entry
                .instructions
                .as_deref()
                .or(entry.server_instructions.as_deref())
                .unwrap_or("")
                .lines()
                .map(str::trim)
                .find(|l| !l.is_empty() && !l.starts_with('#'))
                .unwrap_or("")
                .chars()
                .take(100)
                .collect();
            let is_selected = entry.injection_mode == executors::plugins::McpInjectionMode::Always
                || selected.iter().any(|s| s == &entry.name);
            items.push(WorkspaceMcpItem {
                name: entry.name,
                summary,
                injection_mode: entry.injection_mode,
                selected: is_selected,
            });
        }
    }
    Ok(ResponseJson(ApiResponse::success(WorkspaceMcpResponse {
        items,
    })))
}

#[axum::debug_handler]
pub async fn update_workspace_mcp_servers(
    Extension(workspace): Extension<Workspace>,
    State(deployment): State<DeploymentImpl>,
    Json(req): Json<UpdateWorkspaceMcpRequest>,
) -> Result<ResponseJson<ApiResponse<Vec<String>>>, ApiError> {
    let pool = &deployment.db().pool;
    Workspace::set_selected_mcp_servers(pool, workspace.id, &req.selected).await?;
    let updated = Workspace::get_selected_mcp_servers(pool, workspace.id).await?;
    Ok(ResponseJson(ApiResponse::success(updated)))
}

#[derive(Debug, Serialize)]
pub struct WorkspaceLiveTelemetry {
    pub executor: Option<String>,
    pub started_at: chrono::DateTime<chrono::Utc>,
    pub context_percent: Option<u32>,
}

#[axum::debug_handler]
pub async fn get_live_workspace_telemetry(
    State(deployment): State<DeploymentImpl>,
) -> Result<
    ResponseJson<ApiResponse<std::collections::HashMap<Uuid, WorkspaceLiveTelemetry>>>,
    ApiError,
> {
    let pool = &deployment.db().pool;
    let running = ExecutionProcess::find_running(pool).await?;
    let mut out = std::collections::HashMap::new();
    for proc in running {
        if proc.run_reason != db::models::execution_process::ExecutionProcessRunReason::CodingAgent
        {
            continue;
        }
        let Ok(Some(session)) =
            db::models::session::Session::find_by_id(pool, proc.session_id).await
        else {
            continue;
        };
        let executor = proc
            .executor_action()
            .ok()
            .and_then(|a| a.base_executor())
            .map(|e| e.to_string());
        let context_percent = deployment
            .llm_inspector()
            .get_session_telemetry(proc.session_id)
            .and_then(|b| {
                let win = b.model_context_window?;
                if win == 0 || b.payload_tokens == 0 {
                    return None;
                }
                Some(((b.payload_tokens as u64 * 100) / (win as u64)).min(100) as u32)
            });
        out.insert(
            session.workspace_id,
            WorkspaceLiveTelemetry {
                executor,
                started_at: proc.started_at,
                context_percent,
            },
        );
    }
    Ok(ResponseJson(ApiResponse::success(out)))
}
