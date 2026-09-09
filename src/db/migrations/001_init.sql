CREATE TABLE IF NOT EXISTS tickets (
  ticket_key          TEXT PRIMARY KEY,
  summary             TEXT,
  jira_status         TEXT NOT NULL,
  last_seen_status    TEXT NOT NULL,
  pipeline_state      TEXT NOT NULL DEFAULT 'unmerged',
  branch_name         TEXT,
  pr_number           INTEGER,
  pr_state            TEXT,
  check_status        TEXT,
  head_sha            TEXT,
  assignee_name       TEXT,
  assignee_avatar_url TEXT,
  sprint_name         TEXT,
  jira_updated_at     TEXT,
  updated_at          TEXT NOT NULL,
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp      TEXT NOT NULL,
  correlation_id TEXT,
  ticket_key     TEXT,
  trigger_label  TEXT NOT NULL,
  action         TEXT NOT NULL,
  outcome        TEXT NOT NULL,
  title          TEXT NOT NULL,
  detail         TEXT,
  metadata_json  TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_ticket ON events(ticket_key, timestamp);
CREATE INDEX IF NOT EXISTS idx_events_timestamp ON events(timestamp);

CREATE TABLE IF NOT EXISTS poll_state (
  id                         INTEGER PRIMARY KEY CHECK (id = 1),
  cursor                     TEXT,
  last_poll_at               TEXT,
  last_poll_ok               INTEGER,
  last_error                 TEXT,
  jira_rate_limit_remaining  INTEGER,
  jira_rate_limit_reset_at   TEXT
);
INSERT OR IGNORE INTO poll_state (id, cursor) VALUES (1, NULL);

CREATE TABLE IF NOT EXISTS lock_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  ref_name       TEXT NOT NULL,
  acquired_at    TEXT NOT NULL,
  released_at    TEXT,
  held_ms        INTEGER,
  holder         TEXT NOT NULL,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_lock_events_ref ON lock_events(ref_name, acquired_at);
