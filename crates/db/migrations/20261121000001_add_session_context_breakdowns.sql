CREATE TABLE IF NOT EXISTS session_context_breakdowns (
    session_id BLOB PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
    payload    TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now', 'subsec'))
);
