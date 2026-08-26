-- Expand announcement reactions and keep only one reaction per user per announcement.

CREATE TABLE announcement_reactions_next (
  announcement_id TEXT NOT NULL REFERENCES platform_announcements(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji           TEXT NOT NULL CHECK (emoji IN ('👍','❤️','😂','👏','🔥','💪','😍','😮','😢','🙏','✅','🎉')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  PRIMARY KEY (announcement_id, user_id, emoji)
);

INSERT OR IGNORE INTO announcement_reactions_next (announcement_id, user_id, emoji, created_at)
SELECT announcement_id, user_id, emoji, MIN(created_at)
  FROM announcement_reactions
 WHERE emoji IN ('👍','❤️','😂','👏','🔥','💪','😍','😮','😢','🙏','✅','🎉')
 GROUP BY announcement_id, user_id;

DROP TABLE announcement_reactions;
ALTER TABLE announcement_reactions_next RENAME TO announcement_reactions;

CREATE INDEX IF NOT EXISTS idx_announcement_reactions_summary
  ON announcement_reactions(announcement_id, emoji);
