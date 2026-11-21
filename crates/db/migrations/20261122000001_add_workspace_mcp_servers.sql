CREATE TABLE IF NOT EXISTS workspace_mcp_servers (
    workspace_id BLOB NOT NULL,
    mcp_name     TEXT NOT NULL,
    PRIMARY KEY (workspace_id, mcp_name),
    FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
