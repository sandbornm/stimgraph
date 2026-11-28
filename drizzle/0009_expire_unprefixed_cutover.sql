CREATE TABLE IF NOT EXISTS schema_events (
  id TEXT PRIMARY KEY NOT NULL,
  applied_at INTEGER NOT NULL
);
--> statement-breakpoint
UPDATE x_sessions SET expires_at = 0 WHERE NOT EXISTS (
  SELECT 1 FROM schema_events WHERE id = 'expire_sessions_https_cookie_cutover'
);
--> statement-breakpoint
INSERT OR IGNORE INTO schema_events (id, applied_at) VALUES ('expire_sessions_https_cookie_cutover', unixepoch() * 1000);
