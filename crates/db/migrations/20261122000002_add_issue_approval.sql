-- HIVE-85: separate issue approval from merge/push/PR permission.
-- An approval is recorded on the card; scope='revision' is the only scope
-- that authorizes a merge/push for the matching workspace branch head.
ALTER TABLE issues ADD COLUMN approval_owner TEXT;
ALTER TABLE issues ADD COLUMN approval_at TEXT;
ALTER TABLE issues ADD COLUMN approval_revision TEXT;
ALTER TABLE issues ADD COLUMN approval_scope TEXT;
