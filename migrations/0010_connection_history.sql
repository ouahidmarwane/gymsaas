-- Persistent, non-replayable club connection history.

CREATE TABLE IF NOT EXISTS connection_history (
  session_hash    TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          TEXT REFERENCES organizations(id) ON DELETE CASCADE,
  connected_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_seen_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  disconnected_at TEXT,
  ip              TEXT,
  user_agent      TEXT
);

CREATE INDEX IF NOT EXISTS idx_connection_history_org_time
  ON connection_history(org_id, connected_at DESC);
CREATE INDEX IF NOT EXISTS idx_connection_history_user
  ON connection_history(user_id, connected_at DESC);
