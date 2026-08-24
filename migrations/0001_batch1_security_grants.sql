-- Batch 1/1.1 control-plane prerequisites.
-- Apply this migration before deploying application code that reads these tables.
CREATE TABLE IF NOT EXISTS privileged_grants (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_privileged_grants_exp ON privileged_grants(expires_at);

CREATE TABLE IF NOT EXISTS support_write_grants (
  token_hash TEXT PRIMARY KEY REFERENCES sessions(token_hash) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_support_write_grants_exp ON support_write_grants(expires_at);

CREATE TABLE IF NOT EXISTS step_up_attempts (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip           TEXT,
  succeeded    INTEGER NOT NULL DEFAULT 0 CHECK (succeeded IN (0,1)),
  attempted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_step_up_attempts_user
  ON step_up_attempts(user_id, attempted_at);
CREATE INDEX IF NOT EXISTS idx_step_up_attempts_ip
  ON step_up_attempts(ip, attempted_at);
