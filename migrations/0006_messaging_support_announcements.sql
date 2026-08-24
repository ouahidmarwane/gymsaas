-- Messaging support and platform announcements.
-- Schema-only migration: it creates tables/indexes, and does not import or seed local test data.

CREATE TABLE IF NOT EXISTS support_threads (
  id          TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL UNIQUE REFERENCES organizations(id) ON DELETE CASCADE,
  created_by  TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE TABLE IF NOT EXISTS support_messages (
  id          TEXT PRIMARY KEY,
  thread_id   TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  author_id   TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('club','support')),
  body        TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_support_messages_cursor
  ON support_messages(thread_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS support_reads (
  thread_id            TEXT NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  last_read_message_id TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (thread_id, user_id)
);

CREATE TABLE IF NOT EXISTS platform_announcements (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 160),
  content      TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 8000),
  status       TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  published_at TEXT,
  created_by   TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_announcements_published
  ON platform_announcements(status, published_at DESC);

CREATE TABLE IF NOT EXISTS announcement_reads (
  announcement_id TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id)
);
