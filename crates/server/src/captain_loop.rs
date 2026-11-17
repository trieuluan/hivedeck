//! ADR-031: the backend drives the captain's loop for agents that have no
//! `/loop` of their own (Codex). A headed Claude captain keeps using its
//! built-in `/loop`; for everything else HiveDeck sends the per-tick prompt as
//! a follow-up on the captain's session once the previous tick has finished
//! and the interval has passed.
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

/// Interval used when the prompt carries no `/loop <interval>` prefix.
pub const DEFAULT_INTERVAL: Duration = Duration::from_secs(5 * 60);
/// How often the loop checks whether a tick is due.
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
    let due = finished + chrono::Duration::from_std(info.interval)?;
    if Utc::now() < due {
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
        tick_prompt.to_string(),
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
    Ok(Step::Ticked)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::split_loop_prompt;

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
