CREATE TABLE IF NOT EXISTS pending_grants (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  owner_id TEXT,
  created_at INTEGER NOT NULL
);
