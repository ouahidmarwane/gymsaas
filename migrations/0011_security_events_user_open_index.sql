CREATE INDEX IF NOT EXISTS idx_security_events_user_open
  ON security_events(user_id, handled_at, created_at DESC) WHERE user_id IS NOT NULL;
