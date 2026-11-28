CREATE TRIGGER IF NOT EXISTS bookmarks_require_live_owner
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
END;
