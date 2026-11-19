use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use thiserror::Error;
use ts_rs::TS;
use uuid::Uuid;
use super::execution_process::{ExecutionProcessRunReason, ExecutionProcessStatus};

use super::workspace_repo::WorkspaceRepo;

#[derive(Debug, Error)]
pub enum SessionError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error("Session not found")]
    NotFound,
    #[error("Workspace not found")]
    WorkspaceNotFound,
    #[error("Executor mismatch: session uses {expected} but request specified {actual}")]
    ExecutorMismatch { expected: String, actual: String },
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Session {
    pub id: Uuid,
    pub workspace_id: Uuid,
    pub name: Option<String>,
    pub executor: Option<String>,
    pub agent_working_dir: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub latest_execution_id: Option<Uuid>,
    pub latest_execution_status: Option<ExecutionProcessStatus>,
    pub latest_execution_run_reason: Option<ExecutionProcessRunReason>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateSession {
    pub executor: Option<String>,
    pub name: Option<String>,
}

impl Session {
    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT s.id,
                      s.workspace_id,
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.created_at,
                      s.updated_at,
                      ep.id AS latest_execution_id,
                      ep.status AS latest_execution_status,
                      ep.run_reason AS latest_execution_run_reason
               FROM sessions s
               LEFT JOIN (
                   SELECT session_id, id, status, run_reason,
                          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
                   FROM execution_processes
                   WHERE dropped = FALSE
               ) ep ON s.id = ep.session_id AND ep.rn = 1
               WHERE s.id = ?"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    /// Find all sessions for a workspace, ordered by most recently used.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT s.id,
                      s.workspace_id,
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.created_at,
                      s.updated_at,
                      lep.id AS latest_execution_id,
                      lep.status AS latest_execution_status,
                      lep.run_reason AS latest_execution_run_reason
               FROM sessions s
               LEFT JOIN (
                   SELECT session_id, id, status, run_reason,
                          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
                   FROM execution_processes
                   WHERE dropped = FALSE
               ) lep ON s.id = lep.session_id AND lep.rn = 1
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = ?
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC"#,
        )
        .bind(workspace_id)
        .fetch_all(pool)
        .await
    }

    /// Find the most recently used session for a workspace.
    /// "Most recently used" is defined as the most recent non-dev server execution process.
    /// Sessions with no executions fall back to created_at for ordering.
    pub async fn find_latest_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT s.id,
                      s.workspace_id,
                      s.name,
                      s.executor,
                      s.agent_working_dir,
                      s.created_at,
                      s.updated_at,
                      lep.id AS latest_execution_id,
                      lep.status AS latest_execution_status,
                      lep.run_reason AS latest_execution_run_reason
               FROM sessions s
               LEFT JOIN (
                   SELECT session_id, id, status, run_reason,
                          ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at DESC) as rn
                   FROM execution_processes
                   WHERE dropped = FALSE
               ) lep ON s.id = lep.session_id AND lep.rn = 1
               LEFT JOIN (
                   SELECT ep.session_id, MAX(ep.created_at) as last_used
                   FROM execution_processes ep
                   WHERE ep.run_reason != 'devserver' AND ep.dropped = FALSE
                   GROUP BY ep.session_id
               ) latest_ep ON s.id = latest_ep.session_id
               WHERE s.workspace_id = ?
               ORDER BY COALESCE(latest_ep.last_used, s.created_at) DESC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    /// Find the first-created session for a workspace.
    /// This is a temporary policy for orchestrator MCP session discovery.
    pub async fn find_first_by_workspace_id(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Session>(
            r#"SELECT id,
                      workspace_id,
                      name,
                      executor,
                      agent_working_dir,
                      created_at,
                      updated_at,
                      NULL as latest_execution_id,
                      NULL as latest_execution_status,
                      NULL as latest_execution_run_reason
               FROM sessions
               WHERE workspace_id = ?
               ORDER BY created_at ASC, id ASC
               LIMIT 1"#,
        )
        .bind(workspace_id)
        .fetch_optional(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        data: &CreateSession,
        id: Uuid,
        workspace_id: Uuid,
    ) -> Result<Self, SessionError> {
        let agent_working_dir = Self::resolve_agent_working_dir(pool, workspace_id).await?;
        let name = data.name.as_deref().filter(|s| !s.is_empty());

        Ok(sqlx::query_as::<_, Session>(
            r#"INSERT INTO sessions (id, workspace_id, name, executor, agent_working_dir)
               VALUES (?, ?, ?, ?, ?)
               RETURNING id, workspace_id, name, executor, agent_working_dir, created_at, updated_at,
                         NULL as latest_execution_id, NULL as latest_execution_status, NULL as latest_execution_run_reason"#,
        )
        .bind(id)
        .bind(workspace_id)
        .bind(name)
        .bind(&data.executor)
        .bind(agent_working_dir)
        .fetch_one(pool)
        .await?)
    }

    pub async fn resolve_agent_working_dir(
        pool: &SqlitePool,
        workspace_id: Uuid,
    ) -> Result<Option<String>, sqlx::Error> {
        let repos = WorkspaceRepo::find_repos_for_workspace(pool, workspace_id).await?;
        if repos.len() != 1 {
            return Ok(None);
        }

        let repo = &repos[0];
        let path = match repo.default_working_dir.as_deref() {
            Some(subdir) if !subdir.is_empty() => std::path::PathBuf::from(&repo.name).join(subdir),
            _ => std::path::PathBuf::from(&repo.name),
        };

        Ok(Some(path.to_string_lossy().to_string()))
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        let name_value = name.filter(|s| !s.is_empty());
        let name_provided = name.is_some();

        sqlx::query!(
            r#"UPDATE sessions SET
                name = CASE WHEN $1 THEN $2 ELSE name END,
                updated_at = datetime('now', 'subsec')
            WHERE id = $3"#,
            name_provided,
            name_value,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }

    pub async fn update_executor(
        pool: &SqlitePool,
        id: Uuid,
        executor: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query!(
            r#"UPDATE sessions SET executor = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2"#,
            executor,
            id
        )
        .execute(pool)
        .await?;
        Ok(())
    }
}
