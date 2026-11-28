export type OwnerDeletionDb = {
  run(sql: string, params: (string | number)[]): Promise<void>;
  first<T extends Record<string, unknown>>(sql: string, params: (string | number)[]): Promise<T | null>;
};

const RECORD_SQL = `INSERT INTO deleted_owners (owner_id, deleted_at) VALUES (?, ?)
  ON CONFLICT(owner_id) DO UPDATE SET deleted_at = MAX(deleted_owners.deleted_at, excluded.deleted_at)`;

const SINCE_SQL = 'SELECT owner_id FROM deleted_owners WHERE owner_id = ? AND deleted_at >= ? LIMIT 1';

const LIVE_SQL = `SELECT id FROM x_sessions
  WHERE owner_id = ?
  AND NOT EXISTS (
    SELECT 1 FROM deleted_owners
    WHERE owner_id = x_sessions.owner_id AND deleted_at >= x_sessions.created_at
  )
  LIMIT 1`;

export async function recordOwnerDeleted(db: OwnerDeletionDb, ownerId: string, at: number) {
  await db.run(RECORD_SQL, [ownerId, at]);
}

export async function ownerDeletedSince(db: OwnerDeletionDb, ownerId: string, since: number) {
  const row = await db.first(SINCE_SQL, [ownerId, since]);
  return row !== null;
}

export async function ownerIsLive(db: OwnerDeletionDb, ownerId: string) {
  const row = await db.first(LIVE_SQL, [ownerId]);
  return row !== null;
}
