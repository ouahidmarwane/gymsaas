-- Reactions on platform announcements.
-- Clubs can acknowledge official messages without gaining publishing rights.

CREATE TABLE IF NOT EXISTS announcement_reactions (
  announcement_id TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL CHECK (emoji IN ('👍','❤️','😂','👏')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_announcement_reactions_summary
  ON announcement_reactions(announcement_id, emoji);
