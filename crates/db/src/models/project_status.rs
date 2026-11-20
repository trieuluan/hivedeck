use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

/// Kanban column. Mirrors the wire `ProjectStatus` shape (served at
/// /v1/fallback/project_statuses).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectStatus {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub color: String,
    pub sort_order: i64,
    pub hidden: bool,
    /// Explicit "this card is finished" marker. Replaces the old positional
    /// heuristic (hidden ∪ last visible by sort_order) — reordering columns
    /// no longer changes which one is terminal.
    pub is_terminal: bool,
    pub created_at: DateTime<Utc>,
}

/// Canonical board columns every project starts with: (name, color, is_terminal).
/// Matches the `hivedeck` project's board, in board order.
pub const DEFAULT_STATUSES: [(&str, &str, bool); 5] = [
    ("Todo", "#94a3b8", false),
    ("In Progress", "#3b82f6", false),
    ("In Review", "#a855f7", false),
    ("Done", "#22c55e", true),
    ("Cancelled", "#64748b", true),
];

impl ProjectStatus {
    /// Insert [`DEFAULT_STATUSES`] unless the project already has any status.
    /// Takes a connection so callers can run it inside their own transaction.
    /// Returns whether columns were added.
    pub async fn seed_defaults(
        conn: &mut SqliteConnection,
        project_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let existing = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM project_statuses WHERE project_id = ?",
        )
        .bind(project_id)
        .fetch_one(&mut *conn)
        .await?;
        if existing != 0 {
            return Ok(false);
        }
        for (idx, (name, color, is_terminal)) in DEFAULT_STATUSES.iter().enumerate() {
            sqlx::query(
                "INSERT INTO project_statuses (id, project_id, name, color, sort_order, hidden, is_terminal)
                 VALUES (?, ?, ?, ?, ?, 0, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(name)
            .bind(color)
            .bind(idx as i64)
            .bind(is_terminal)
            .execute(&mut *conn)
            .await?;
        }
        Ok(true)
    }

    /// Seed defaults into every project that has no status at all. Idempotent;
    /// never touches a project that already has columns. Returns how many
    /// projects were seeded.
    pub async fn backfill_missing_defaults(pool: &SqlitePool) -> Result<usize, sqlx::Error> {
        let project_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM projects
             WHERE NOT EXISTS (SELECT 1 FROM project_statuses WHERE project_id = projects.id)",
        )
        .fetch_all(pool)
        .await?;
        let mut seeded = 0;
        for project_id in project_ids {
            let mut tx = pool.begin().await?;
            if Self::seed_defaults(&mut tx, project_id).await? {
                seeded += 1;
            }
            tx.commit().await?;
        }
        Ok(seeded)
    }

    pub async fn list_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectStatus,
            r#"SELECT id as "id!: Uuid",
                      project_id as "project_id!: Uuid",
                      name,
                      color,
                      sort_order,
                      hidden as "hidden!: bool",
                      is_terminal as "is_terminal!: bool",
                      created_at as "created_at!: DateTime<Utc>"
               FROM project_statuses
               WHERE project_id = $1
               ORDER BY sort_order ASC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn count_by_project(pool: &SqlitePool, project_id: Uuid) -> Result<i64, sqlx::Error> {
        let row = sqlx::query!(
            r#"SELECT COUNT(*) as "count!: i64" FROM project_statuses WHERE project_id = $1"#,
            project_id
        )
        .fetch_one(pool)
        .await?;
        Ok(row.count)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Uuid,
        name: &str,
        color: &str,
        sort_order: i64,
        hidden: bool,
        is_terminal: bool,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            ProjectStatus,
            r#"INSERT INTO project_statuses (id, project_id, name, color, sort_order, hidden, is_terminal)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id as "id!: Uuid",
                         project_id as "project_id!: Uuid",
                         name,
                         color,
                         sort_order,
                         hidden as "hidden!: bool",
                         is_terminal as "is_terminal!: bool",
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            project_id,
            name,
            color,
            sort_order,
            hidden,
            is_terminal,
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: Option<&str>,
        color: Option<&str>,
        sort_order: Option<i64>,
        hidden: Option<bool>,
        is_terminal: Option<bool>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            ProjectStatus,
            r#"UPDATE project_statuses
               SET name = COALESCE($2, name),
                   color = COALESCE($3, color),
                   sort_order = COALESCE($4, sort_order),
                   hidden = COALESCE($5, hidden),
                   is_terminal = COALESCE($6, is_terminal)
               WHERE id = $1
               RETURNING id as "id!: Uuid",
                         project_id as "project_id!: Uuid",
                         name,
                         color,
                         sort_order,
                         hidden as "hidden!: bool",
                         is_terminal as "is_terminal!: bool",
                         created_at as "created_at!: DateTime<Utc>""#,
            id,
            name,
            color,
            sort_order,
            hidden,
            is_terminal,
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM project_statuses WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use std::borrow::Cow;

    use sqlx::{SqlitePool, migrate::Migrator};
    use uuid::Uuid;

    const TERMINAL_MIGRATION_VERSION: i64 = 20260808000001;

    async fn migrated_pool() -> SqlitePool {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        pool
    }

    fn partial_migrator(from_version: i64, to_version: i64) -> Migrator {
        // Start from the full migrator and narrow it, rather than building
        // `Migrator` field by field (its fields change between sqlx versions).
        let mut migrator = sqlx::migrate!("./migrations");
        let subset: Vec<_> = migrator
            .migrations
            .iter()
            .filter(|m| m.version >= from_version && m.version < to_version)
            .cloned()
            .collect();
        migrator.migrations = Cow::Owned(subset);
        migrator.ignore_missing = true;
        migrator
    }

    async fn insert_legacy_status(
        pool: &SqlitePool,
        project_id: Uuid,
        name: &str,
        sort_order: i64,
        hidden: bool,
    ) {
        sqlx::query(
            "INSERT INTO project_statuses (id, project_id, name, color, sort_order, hidden)
             VALUES (?, ?, ?, '#fff', ?, ?)",
        )
        .bind(Uuid::new_v4())
        .bind(project_id)
        .bind(name)
        .bind(sort_order)
        .bind(hidden)
        .execute(pool)
        .await
        .unwrap();
    }

    async fn insert_project(pool: &SqlitePool, id: Uuid, name: &str) {
        sqlx::query("INSERT INTO projects (id, name, color) VALUES (?, ?, '#fff')")
            .bind(id)
            .bind(name)
            .execute(pool)
            .await
            .unwrap();
    }

    /// Existing boards must upgrade with identical terminal-column behavior:
    /// hidden columns ∪ the last visible column by sort_order.
    #[tokio::test]
    async fn backfill_reproduces_positional_heuristic() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        partial_migrator(0, TERMINAL_MIGRATION_VERSION)
            .run(&pool)
            .await
            .unwrap();

        let project_id = Uuid::new_v4();
        insert_project(&pool, project_id, "P").await;
        insert_legacy_status(&pool, project_id, "Todo", 0, false).await;
        insert_legacy_status(&pool, project_id, "In Progress", 1, false).await;
        insert_legacy_status(&pool, project_id, "Done", 2, false).await;
        insert_legacy_status(&pool, project_id, "Cancelled", 3, true).await;

        // A board whose columns are ALL hidden has no "last visible" column.
        let all_hidden_project = Uuid::new_v4();
        insert_project(&pool, all_hidden_project, "H").await;
        insert_legacy_status(&pool, all_hidden_project, "Gone", 0, true).await;

        partial_migrator(TERMINAL_MIGRATION_VERSION, i64::MAX)
            .run(&pool)
            .await
            .unwrap();

        let statuses = super::ProjectStatus::list_by_project(&pool, project_id)
            .await
            .unwrap();
        let terminal: Vec<&str> = statuses
            .iter()
            .filter(|s| s.is_terminal)
            .map(|s| s.name.as_str())
            .collect();
        assert_eq!(terminal, vec!["Done", "Cancelled"]);

        let hidden_statuses = super::ProjectStatus::list_by_project(&pool, all_hidden_project)
            .await
            .unwrap();
        assert!(hidden_statuses.iter().all(|s| s.is_terminal));
    }

    /// The terminal marker is data, not position: reordering columns must
    /// not change which ones are terminal.
    #[tokio::test]
    async fn reordering_keeps_terminal_marking() {
        let pool = migrated_pool().await;
        let project_id = Uuid::new_v4();
        insert_project(&pool, project_id, "P").await;

        let todo = super::ProjectStatus::create(
            &pool,
            Uuid::new_v4(),
            project_id,
            "Todo",
            "#fff",
            0,
            false,
            false,
        )
        .await
        .unwrap();
        let done = super::ProjectStatus::create(
            &pool,
            Uuid::new_v4(),
            project_id,
            "Done",
            "#fff",
            1,
            false,
            true,
        )
        .await
        .unwrap();

        super::ProjectStatus::update(&pool, todo.id, None, None, Some(5), None, None)
            .await
            .unwrap();

        let statuses = super::ProjectStatus::list_by_project(&pool, project_id)
            .await
            .unwrap();
        assert_eq!(statuses[0].id, done.id);
        assert!(statuses[0].is_terminal);
        assert!(!statuses[1].is_terminal);
    }

    async fn status_names(pool: &SqlitePool, project_id: Uuid) -> Vec<(String, bool)> {
        super::ProjectStatus::list_by_project(pool, project_id)
            .await
            .unwrap()
            .into_iter()
            .map(|s| (s.name, s.is_terminal))
            .collect()
    }

    #[tokio::test]
    async fn seed_defaults_creates_five_ordered_columns_once() {
        let pool = migrated_pool().await;
        let project_id = Uuid::new_v4();
        sqlx::query("INSERT INTO projects (id, name, color) VALUES (?, 'P', '#fff')")
            .bind(project_id)
            .execute(&pool)
            .await
            .unwrap();

        let mut conn = pool.acquire().await.unwrap();
        assert!(
            super::ProjectStatus::seed_defaults(&mut conn, project_id)
                .await
                .unwrap()
        );
        assert!(
            !super::ProjectStatus::seed_defaults(&mut conn, project_id)
                .await
                .unwrap()
        );
        drop(conn);

        let statuses = super::ProjectStatus::list_by_project(&pool, project_id)
            .await
            .unwrap();
        let summary: Vec<_> = statuses
            .iter()
            .map(|s| {
                (
                    s.name.as_str(),
                    s.color.as_str(),
                    s.sort_order,
                    s.hidden,
                    s.is_terminal,
                )
            })
            .collect();
        assert_eq!(
            summary,
            [
                ("Todo", "#94a3b8", 0, false, false),
                ("In Progress", "#3b82f6", 1, false, false),
                ("In Review", "#a855f7", 2, false, false),
                ("Done", "#22c55e", 3, false, true),
                ("Cancelled", "#64748b", 4, false, true),
            ]
        );
    }

    #[tokio::test]
    async fn backfill_is_idempotent_and_keeps_custom_columns() {
        let pool = migrated_pool().await;
        let empty = Uuid::new_v4();
        let custom = Uuid::new_v4();
        for id in [empty, custom] {
            sqlx::query("INSERT INTO projects (id, name, color) VALUES (?, 'P', '#fff')")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
        }
        insert_legacy_status(&pool, custom, "Backlog", 0, false).await;

        assert_eq!(
            super::ProjectStatus::backfill_missing_defaults(&pool)
                .await
                .unwrap(),
            1
        );
        assert_eq!(
            super::ProjectStatus::backfill_missing_defaults(&pool)
                .await
                .unwrap(),
            0
        );

        assert_eq!(status_names(&pool, empty).await.len(), 5);
        assert_eq!(
            status_names(&pool, custom).await,
            [("Backlog".to_string(), false)]
        );
    }
}
