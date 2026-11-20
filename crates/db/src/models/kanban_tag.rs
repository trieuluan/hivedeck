use serde::{Deserialize, Serialize};
use sqlx::{SqliteConnection, SqlitePool};
use uuid::Uuid;

/// Project tag. Mirrors the wire `Tag` shape (served at /v1/fallback/tags).
/// Backed by the `kanban_tags` table (a `tags` table already exists locally).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KanbanTag {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub color: String,
}

/// Tags every project starts with: (name, HSL color). Matches `hivedeck`.
pub const DEFAULT_TAGS: [(&str, &str); 4] = [
    ("bug", "0 84% 60%"),
    ("debug", "38 92% 50%"),
    ("feature", "142 71% 45%"),
    ("research", "217 91% 60%"),
];

impl KanbanTag {
    /// Insert [`DEFAULT_TAGS`] unless the project already has any tag.
    /// Takes a connection so callers can run it inside their own transaction.
    /// Returns whether tags were added.
    pub async fn seed_defaults(
        conn: &mut SqliteConnection,
        project_id: Uuid,
    ) -> Result<bool, sqlx::Error> {
        let existing =
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM kanban_tags WHERE project_id = ?")
                .bind(project_id)
                .fetch_one(&mut *conn)
                .await?;
        if existing != 0 {
            return Ok(false);
        }
        for (name, color) in DEFAULT_TAGS {
            sqlx::query(
                "INSERT INTO kanban_tags (id, project_id, name, color) VALUES (?, ?, ?, ?)",
            )
            .bind(Uuid::new_v4())
            .bind(project_id)
            .bind(name)
            .bind(color)
            .execute(&mut *conn)
            .await?;
        }
        Ok(true)
    }

    /// Seed default tags into every project that has no tag. Idempotent.
    /// Returns how many projects were seeded.
    pub async fn backfill_missing_defaults(pool: &SqlitePool) -> Result<usize, sqlx::Error> {
        let project_ids = sqlx::query_scalar::<_, Uuid>(
            "SELECT id FROM projects
             WHERE NOT EXISTS (SELECT 1 FROM kanban_tags WHERE project_id = projects.id)",
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
            KanbanTag,
            r#"SELECT id as "id!: Uuid", project_id as "project_id!: Uuid", name, color
               FROM kanban_tags WHERE project_id = $1 ORDER BY name ASC"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        id: Uuid,
        project_id: Uuid,
        name: &str,
        color: &str,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            KanbanTag,
            r#"INSERT INTO kanban_tags (id, project_id, name, color)
               VALUES ($1, $2, $3, $4)
               RETURNING id as "id!: Uuid", project_id as "project_id!: Uuid", name, color"#,
            id,
            project_id,
            name,
            color,
        )
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        name: Option<&str>,
        color: Option<&str>,
    ) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as!(
            KanbanTag,
            r#"UPDATE kanban_tags
               SET name = COALESCE($2, name), color = COALESCE($3, color)
               WHERE id = $1
               RETURNING id as "id!: Uuid", project_id as "project_id!: Uuid", name, color"#,
            id,
            name,
            color,
        )
        .fetch_optional(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM kanban_tags WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

/// Issue<->tag link. Served at /v1/fallback/issue_tags.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IssueTag {
    pub id: Uuid,
    pub issue_id: Uuid,
    pub tag_id: Uuid,
}

impl IssueTag {
    pub async fn list_by_project(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            IssueTag,
            r#"SELECT it.id as "id!: Uuid", it.issue_id as "issue_id!: Uuid", it.tag_id as "tag_id!: Uuid"
               FROM issue_tags it
               JOIN issues i ON i.id = it.issue_id
               WHERE i.project_id = $1"#,
            project_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn list_by_issue(
        pool: &SqlitePool,
        issue_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as!(
            IssueTag,
            r#"SELECT id as "id!: Uuid", issue_id as "issue_id!: Uuid", tag_id as "tag_id!: Uuid"
               FROM issue_tags WHERE issue_id = $1"#,
            issue_id
        )
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        id: Uuid,
        issue_id: Uuid,
        tag_id: Uuid,
    ) -> Result<Self, sqlx::Error> {
        sqlx::query_as!(
            IssueTag,
            r#"INSERT INTO issue_tags (id, issue_id, tag_id)
               VALUES ($1, $2, $3)
               RETURNING id as "id!: Uuid", issue_id as "issue_id!: Uuid", tag_id as "tag_id!: Uuid""#,
            id,
            issue_id,
            tag_id,
        )
        .fetch_one(pool)
        .await
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query!("DELETE FROM issue_tags WHERE id = $1", id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use sqlx::SqlitePool;
    use uuid::Uuid;

    use super::KanbanTag;

    async fn pool_with_projects(count: usize) -> (SqlitePool, Vec<Uuid>) {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::migrate!("./migrations").run(&pool).await.unwrap();
        let mut ids = Vec::new();
        for _ in 0..count {
            let id = Uuid::new_v4();
            sqlx::query("INSERT INTO projects (id, name, color) VALUES (?, 'P', '#fff')")
                .bind(id)
                .execute(&pool)
                .await
                .unwrap();
            ids.push(id);
        }
        (pool, ids)
    }

    #[tokio::test]
    async fn seed_defaults_creates_four_tags_once() {
        let (pool, ids) = pool_with_projects(1).await;
        let mut conn = pool.acquire().await.unwrap();
        assert!(KanbanTag::seed_defaults(&mut conn, ids[0]).await.unwrap());
        assert!(!KanbanTag::seed_defaults(&mut conn, ids[0]).await.unwrap());
        drop(conn);

        let tags: Vec<_> = KanbanTag::list_by_project(&pool, ids[0])
            .await
            .unwrap()
            .into_iter()
            .map(|t| (t.name, t.color))
            .collect();
        let expected: Vec<_> = [
            ("bug", "0 84% 60%"),
            ("debug", "38 92% 50%"),
            ("feature", "142 71% 45%"),
            ("research", "217 91% 60%"),
        ]
        .map(|(n, c)| (n.to_string(), c.to_string()))
        .into();
        assert_eq!(tags, expected);
    }

    #[tokio::test]
    async fn backfill_is_idempotent_and_keeps_custom_tags() {
        let (pool, ids) = pool_with_projects(2).await;
        KanbanTag::create(&pool, Uuid::new_v4(), ids[1], "mine", "1 1% 1%")
            .await
            .unwrap();

        assert_eq!(
            KanbanTag::backfill_missing_defaults(&pool).await.unwrap(),
            1
        );
        assert_eq!(
            KanbanTag::backfill_missing_defaults(&pool).await.unwrap(),
            0
        );

        assert_eq!(
            KanbanTag::list_by_project(&pool, ids[0])
                .await
                .unwrap()
                .len(),
            4
        );
        let custom = KanbanTag::list_by_project(&pool, ids[1]).await.unwrap();
        assert_eq!(custom.len(), 1);
        assert_eq!(custom[0].name, "mine");
    }
}
