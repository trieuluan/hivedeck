//! ADR-031: the backend drives the captain's loop for agents that have no
//! `/loop` of their own (Codex). A headed Claude captain keeps using its
//! built-in `/loop`; for everything else HiveDeck sends the per-tick prompt as
//! a follow-up on the captain's session.
//!
//! Ticks are event-driven: the loop polls a cheap fingerprint of what the
//! captain watches (its cards, the agent runs on those cards, agents waiting
//! for approval or an answer) and wakes the captain when it changes. While
//! cards are in Todo or In Progress a slow heartbeat also wakes it, as a
//! safety net. An idle board costs nothing.
//!
//! There is at most one loop per captain workspace (the global captain and
//! one per project, ADR-032). Loops live in memory: a backend restart stops
//! them, and spawning again restarts them.

use std::{collections::HashMap, sync::Mutex, time::Duration};

use chrono::Utc;
use db::models::{
    execution_process::{ExecutionProcess, ExecutionProcessRunReason, ExecutionProcessStatus},
    session::Session,
    workspace::Workspace,
};
use deployment::Deployment;
use executors::{executors::BaseCodingAgent, profile::ExecutorConfig};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::{DeploymentImpl, routes::sessions::run_follow_up};

/// First line of every automatic tick, so the chat can show it as an
/// automatic turn instead of a message from the owner. An HTML comment: the
/// model ignores it and Markdown renders nothing.
pub const TICK_MARKER: &str = "<!-- hivedeck:auto-tick -->";

/// The message sent for an automatic tick.
pub fn tick_message(body: &str) -> String {
    format!("{TICK_MARKER}\n{body}")
}

/// Safety-net tick while cards are in Todo or In Progress and nothing else
/// woke the captain.
pub const HEARTBEAT: Duration = Duration::from_secs(30 * 60);
/// Wait this long after the previous tick finished, so a burst of changes
/// (and the captain's own moves) wakes it once.
const DEBOUNCE: Duration = Duration::from_secs(20);
/// How often the loop checks the fingerprint.
const POLL: Duration = Duration::from_secs(15);
/// Consecutive failed ticks after which the loop gives up.
const MAX_FAILURES: u32 = 3;

#[derive(Clone, Debug)]
pub struct LoopInfo {
    pub workspace_id: Uuid,
    pub executor: BaseCodingAgent,
    pub interval: Duration,
}

type Slot = (LoopInfo, CancellationToken, Uuid);
/// Running loops keyed by captain workspace id.
static ACTIVE: Mutex<Option<HashMap<Uuid, Slot>>> = Mutex::new(None);

/// Split a `/loop <interval> <body>` prompt into its interval and body.
/// Prompts without the prefix (or with an unparseable interval) are returned
/// whole with no interval.
pub fn split_loop_prompt(prompt: &str) -> (Option<Duration>, String) {
    let trimmed = prompt.trim_start();
    let Some(rest) = trimmed.strip_prefix("/loop ") else {
        return (None, prompt.trim().to_string());
    };
    let rest = rest.trim_start();
    let (head, body) = rest.split_once(char::is_whitespace).unwrap_or((rest, ""));
    match parse_interval(head) {
        Some(interval) => (Some(interval), body.trim().to_string()),
        None => (None, rest.trim().to_string()),
    }
}

/// `30s`, `5m`, `2h` (a bare number means minutes). Minimum one minute.
fn parse_interval(s: &str) -> Option<Duration> {
    let (num, unit) = s
        .find(|c: char| !c.is_ascii_digit())
        .map(|i| s.split_at(i))
        .unwrap_or((s, "m"));
    let n: u64 = num.parse().ok()?;
    let secs = match unit {
        "s" => n,
        "m" => n * 60,
        "h" => n * 3600,
        _ => return None,
    };
    Some(Duration::from_secs(secs.max(60)))
}

/// The running loop of a captain workspace, if any.
pub fn active(workspace_id: Uuid) -> Option<LoopInfo> {
    ACTIVE.lock().ok().and_then(|guard| {
        guard
            .as_ref()
            .and_then(|loops| loops.get(&workspace_id))
            .map(|(info, _, _)| info.clone())
    })
}

/// Stop a captain's loop. Returns whether one was running.
pub fn stop(workspace_id: Uuid) -> bool {
    let Ok(mut guard) = ACTIVE.lock() else {
        return false;
    };
    match guard.as_mut().and_then(|loops| loops.remove(&workspace_id)) {
        Some((_, token, _)) => {
            token.cancel();
            true
        }
        None => false,
    }
}

/// Start (or replace) the loop for the orchestrator workspace.
pub fn start(
    deployment: DeploymentImpl,
    info: LoopInfo,
    executor_config: ExecutorConfig,
    tick_prompt: String,
) {
    let token = CancellationToken::new();
    let loop_id = Uuid::new_v4();
    if let Ok(mut guard) = ACTIVE.lock()
        && let Some((_, old, _)) = guard
            .get_or_insert_with(HashMap::new)
            .insert(info.workspace_id, (info.clone(), token.clone(), loop_id))
    {
        old.cancel();
    }
    tracing::info!(
        "captain loop started for workspace {} ({:?}, every {:?})",
        info.workspace_id,
        info.executor,
        info.interval
    );
    tokio::spawn(run(
        deployment,
        info,
        executor_config,
        tick_prompt,
        token,
        loop_id,
    ));
}

enum Step {
    Wait,
    Ticked,
    Failed,
    Stop(&'static str),
}

async fn run(
    deployment: DeploymentImpl,
    info: LoopInfo,
    executor_config: ExecutorConfig,
    tick_prompt: String,
    token: CancellationToken,
    loop_id: Uuid,
) {
    let mut failures = 0u32;
    // Fingerprint at the last tick. The spawn's first prompt was a tick, so
    // start from the current state rather than ticking again right away.
    let mut last_board: Option<u64> = {
        let pool = &deployment.db().pool;
        let project = Workspace::captain_project_id(pool, info.workspace_id)
            .await
            .ok()
            .flatten();
        watch_state(&deployment, project)
            .await
            .ok()
            .map(|state| state.signature)
    };
    let reason = loop {
        tokio::select! {
            _ = token.cancelled() => break "stopped",
            _ = tokio::time::sleep(POLL) => {}
        }
        match step(
            &deployment,
            &info,
            &executor_config,
            &tick_prompt,
            &mut failures,
            &mut last_board,
        )
        .await
        {
            Ok(Step::Wait | Step::Ticked) => {}
            Ok(Step::Failed) if failures >= MAX_FAILURES => break "too many failed ticks",
            Ok(Step::Failed) => {}
            Ok(Step::Stop(reason)) => break reason,
            Err(e) => {
                failures += 1;
                tracing::warn!("captain loop tick failed: {e}");
                if failures >= MAX_FAILURES {
                    break "too many failed ticks";
                }
            }
        }
    };
    tracing::info!(
        "captain loop for workspace {} ended: {reason}",
        info.workspace_id
    );
    // Clear the slot unless a newer loop already replaced this one.
    if let Ok(mut guard) = ACTIVE.lock()
        && let Some(loops) = guard.as_mut()
        && loops
            .get(&info.workspace_id)
            .is_some_and(|(_, _, id)| *id == loop_id)
    {
        loops.remove(&info.workspace_id);
    }
}

async fn step(
    deployment: &DeploymentImpl,
    info: &LoopInfo,
    executor_config: &ExecutorConfig,
    tick_prompt: &str,
    failures: &mut u32,
    last_board: &mut Option<u64>,
) -> anyhow::Result<Step> {
    let pool = &deployment.db().pool;
    let Some(workspace) = Workspace::find_by_id(pool, info.workspace_id).await? else {
        return Ok(Step::Stop("orchestrator workspace deleted"));
    };
    if workspace.archived {
        return Ok(Step::Stop("orchestrator workspace archived"));
    }
    let Some(latest) = ExecutionProcess::find_latest_by_workspace_and_run_reason(
        pool,
        workspace.id,
        &ExecutionProcessRunReason::CodingAgent,
    )
    .await?
    else {
        return Ok(Step::Wait);
    };
    match latest.status {
        ExecutionProcessStatus::Running => return Ok(Step::Wait),
        ExecutionProcessStatus::Killed => return Ok(Step::Stop("stopped by the owner")),
        ExecutionProcessStatus::Failed => {}
        ExecutionProcessStatus::Completed => {}
    }
    let finished = latest.completed_at.unwrap_or(latest.started_at);
    let since = Utc::now() - finished;
    if since < chrono::Duration::from_std(DEBOUNCE)? {
        return Ok(Step::Wait);
    }
    // Wake on a change, or on the heartbeat while there is work in flight.
    // Owner messages don't wait for ticks; they run at once.
    let project_id = Workspace::captain_project_id(pool, workspace.id).await?;
    let board = watch_state(deployment, project_id).await?;
    let changed = *last_board != Some(board.signature);
    let heartbeat = board.active && since >= chrono::Duration::from_std(HEARTBEAT)?;
    if !changed && !heartbeat {
        return Ok(Step::Wait);
    }

    // Consecutive failures: a failed tick, or a tick we couldn't start.
    // Only a tick that completed clears the count.
    let previous_failed = latest.status == ExecutionProcessStatus::Failed;
    if previous_failed {
        *failures += 1;
        if *failures >= MAX_FAILURES {
            return Ok(Step::Failed);
        }
    }
    let Some(session) = Session::find_by_id(pool, latest.session_id).await? else {
        return Ok(Step::Stop("captain session missing"));
    };
    if let Err(e) = run_follow_up(
        deployment,
        session,
        workspace,
        tick_message(tick_prompt),
        executor_config.clone(),
        None,
        None,
        None,
    )
    .await
    {
        tracing::warn!("captain loop could not start a tick: {e:?}");
        *failures += 1;
        return Ok(Step::Failed);
    }
    if !previous_failed {
        *failures = 0;
    }
    *last_board = Some(board.signature);
    Ok(Step::Ticked)
}

struct BoardState {
    /// A card the captain must act on: one to dispatch (Todo) or to watch
    /// (In Progress).
    active: bool,
    /// Changes when any card is added, removed, moved or edited.
    signature: u64,
}

/// What the captain watches, in its scope (its project, or every project
/// for the global captain): the cards, the agent runs on those cards, and
/// which of those runs wait for approval or an answer.
async fn watch_state(
    deployment: &DeploymentImpl,
    project_id: Option<Uuid>,
) -> Result<BoardState, sqlx::Error> {
    let pool = &deployment.db().pool;
    let rows: Vec<(Uuid, String, String)> = match project_id {
        Some(project_id) => {
            sqlx::query_as(
                "SELECT i.id, ps.name, i.updated_at FROM issues i
                 JOIN project_statuses ps ON ps.id = i.status_id
                 WHERE i.project_id = ?",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT i.id, ps.name, i.updated_at FROM issues i
                 JOIN project_statuses ps ON ps.id = i.status_id",
            )
            .fetch_all(pool)
            .await?
        }
    };
    let runs: Vec<(Uuid, String, Option<String>)> = match project_id {
        Some(project_id) => {
            sqlx::query_as(
                "SELECT ep.id, ep.status, ep.completed_at FROM execution_processes ep
                 JOIN sessions s ON s.id = ep.session_id
                 JOIN issue_workspaces iw ON iw.workspace_id = s.workspace_id
                 JOIN issues i ON i.id = iw.issue_id
                 WHERE i.project_id = ? AND ep.run_reason = 'codingagent'",
            )
            .bind(project_id)
            .fetch_all(pool)
            .await?
        }
        None => {
            sqlx::query_as(
                "SELECT ep.id, ep.status, ep.completed_at FROM execution_processes ep
                 JOIN sessions s ON s.id = ep.session_id
                 JOIN issue_workspaces iw ON iw.workspace_id = s.workspace_id
                 WHERE ep.run_reason = 'codingagent'",
            )
            .fetch_all(pool)
            .await?
        }
    };
    let running: Vec<Uuid> = runs
        .iter()
        .filter(|(_, status, _)| status == "running")
        .map(|(id, _, _)| *id)
        .collect();
    let mut waiting: Vec<Uuid> = deployment
        .approvals()
        .get_pending_execution_process_ids(&running)
        .into_iter()
        .collect();
    waiting.sort();
    Ok(summarize(rows, runs, waiting))
}

fn summarize(
    mut rows: Vec<(Uuid, String, String)>,
    mut runs: Vec<(Uuid, String, Option<String>)>,
    waiting: Vec<Uuid>,
) -> BoardState {
    use std::hash::{Hash, Hasher};
    rows.sort();
    runs.sort();
    let active = rows.iter().any(|(_, status, _)| {
        let status = status.trim().to_ascii_lowercase();
        status == "todo" || status == "in progress"
    });
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    rows.hash(&mut hasher);
    runs.hash(&mut hasher);
    waiting.hash(&mut hasher);
    BoardState {
        active,
        signature: hasher.finish(),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use uuid::Uuid;

    use super::{TICK_MARKER, split_loop_prompt, summarize, tick_message};

    fn summarize_board(rows: Vec<(Uuid, String, String)>) -> super::BoardState {
        summarize(rows, vec![], vec![])
    }

    fn row(status: &str, updated: &str) -> (Uuid, String, String) {
        (Uuid::from_u128(1), status.to_string(), updated.to_string())
    }

    #[test]
    fn board_is_active_only_with_todo_or_in_progress() {
        assert!(!summarize_board(vec![]).active);
        assert!(!summarize_board(vec![row("In Review", "t1")]).active);
        assert!(!summarize_board(vec![row("Done", "t1")]).active);
        assert!(summarize_board(vec![row("Todo", "t1")]).active);
        assert!(summarize_board(vec![row("in progress", "t1")]).active);
    }

    #[test]
    fn signature_changes_when_a_card_moves_or_is_edited() {
        let base = summarize_board(vec![row("In Review", "t1")]).signature;
        assert_eq!(
            base,
            summarize_board(vec![row("In Review", "t1")]).signature
        );
        assert_ne!(base, summarize_board(vec![row("Done", "t1")]).signature);
        assert_ne!(
            base,
            summarize_board(vec![row("In Review", "t2")]).signature
        );
    }

    #[test]
    fn signature_changes_when_an_agent_finishes_or_waits() {
        let run = |status: &str, done: Option<&str>| {
            (
                Uuid::from_u128(7),
                status.to_string(),
                done.map(str::to_string),
            )
        };
        let running = summarize(vec![], vec![run("running", None)], vec![]).signature;
        let done = summarize(vec![], vec![run("completed", Some("t9"))], vec![]).signature;
        let waiting =
            summarize(vec![], vec![run("running", None)], vec![Uuid::from_u128(7)]).signature;
        assert_ne!(running, done);
        assert_ne!(running, waiting);
    }

    #[test]
    fn tick_message_starts_with_the_marker() {
        let msg = tick_message("Run one tick.");
        assert!(msg.starts_with(TICK_MARKER));
        assert!(msg.ends_with("Run one tick."));
    }

    #[test]
    fn splits_loop_prefix() {
        let (interval, body) = split_loop_prompt("/loop 5m Run one tick.\n\nDirectives");
        assert_eq!(interval, Some(Duration::from_secs(300)));
        assert_eq!(body, "Run one tick.\n\nDirectives");
    }

    #[test]
    fn units_and_minimum() {
        assert_eq!(
            split_loop_prompt("/loop 2h x").0,
            Some(Duration::from_secs(7200))
        );
        assert_eq!(
            split_loop_prompt("/loop 10s x").0,
            Some(Duration::from_secs(60))
        );
        assert_eq!(
            split_loop_prompt("/loop 7 x").0,
            Some(Duration::from_secs(420))
        );
    }

    #[test]
    fn no_prefix_or_bad_interval_keeps_prompt() {
        assert_eq!(
            split_loop_prompt("Do a tick"),
            (None, "Do a tick".to_string())
        );
        assert_eq!(
            split_loop_prompt("/loop soon do it"),
            (None, "soon do it".to_string())
        );
    }
}
