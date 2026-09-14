CREATE TABLE IF NOT EXISTS production_cuts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_owner    TEXT NOT NULL,
  repo_name     TEXT NOT NULL,
  branch_name   TEXT NOT NULL,
  sha           TEXT NOT NULL,
  staging_sha   TEXT NOT NULL,
  previous_sha  TEXT,
  tickets_json  TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL,
  UNIQUE(repo_owner, repo_name, branch_name)
);
CREATE INDEX IF NOT EXISTS idx_production_cuts_repo
  ON production_cuts(repo_owner, repo_name, created_at DESC, id DESC);
