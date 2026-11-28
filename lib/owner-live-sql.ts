export const INSERT_SESSION_IF_LIVE_SQL = `INSERT INTO x_sessions (id, owner_id, payload, expires_at, created_at, updated_at)
  SELECT ?, ?, ?, ?, ?, ?
  WHERE NOT EXISTS (
    SELECT 1 FROM deleted_owners WHERE owner_id = ? AND deleted_at >= ?
  )`;

export const POLL_LIVE_SESSIONS_SQL = `SELECT id, owner_id FROM x_sessions
  WHERE expires_at > ?
  AND NOT EXISTS (
    SELECT 1 FROM deleted_owners
    WHERE owner_id = x_sessions.owner_id AND deleted_at >= x_sessions.created_at
  )
  ORDER BY updated_at DESC`;

export const BOOKMARKS_REQUIRE_LIVE_OWNER_SQL = `CREATE TRIGGER IF NOT EXISTS bookmarks_require_live_owner
BEFORE INSERT ON bookmarks
BEGIN
  SELECT RAISE(ABORT, 'stimgraph-owner-not-live')
  WHERE NOT EXISTS (
    SELECT 1 FROM x_sessions
    WHERE owner_id = NEW.owner_id
    AND NOT EXISTS (
      SELECT 1 FROM deleted_owners
      WHERE owner_id = x_sessions.owner_id AND deleted_at >= x_sessions.created_at
    )
  );
END`;
