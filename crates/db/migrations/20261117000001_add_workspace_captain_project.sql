-- ADR-032: a project can have its own captain. The captain is an orchestrator
-- workspace that belongs to one project; NULL keeps the global captain.
ALTER TABLE workspaces ADD COLUMN captain_project_id BLOB;
CREATE INDEX IF NOT EXISTS idx_workspaces_captain_project
    ON workspaces (captain_project_id) WHERE captain_project_id IS NOT NULL;
