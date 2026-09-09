CREATE TABLE IF NOT EXISTS repos (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  owner      TEXT NOT NULL,
  name       TEXT NOT NULL,
  active     INTEGER NOT NULL DEFAULT 1,
  added_at   TEXT NOT NULL,
  removed_at TEXT,
  UNIQUE(owner, name)
);

ALTER TABLE tickets ADD COLUMN repo_owner TEXT;
ALTER TABLE tickets ADD COLUMN repo_name TEXT;
CREATE INDEX IF NOT EXISTS idx_tickets_repo ON tickets(repo_owner, repo_name);

ALTER TABLE events ADD COLUMN repo_owner TEXT;
ALTER TABLE events ADD COLUMN repo_name TEXT;
CREATE INDEX IF NOT EXISTS idx_events_repo ON events(repo_owner, repo_name);

ALTER TABLE lock_events ADD COLUMN repo_owner TEXT;
ALTER TABLE lock_events ADD COLUMN repo_name TEXT;
