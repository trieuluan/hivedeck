CREATE TABLE IF NOT EXISTS workspace_skills (
    workspace_id BLOB NOT NULL,
    skill_name TEXT NOT NULL,
    PRIMARY KEY (workspace_id, skill_name),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
