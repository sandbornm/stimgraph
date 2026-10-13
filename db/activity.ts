import { getD1 } from './index';

export const ACTIVITY_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS bookmark_observations (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
    post_id TEXT NOT NULL, observed_at INTEGER NOT NULL,
    UNIQUE(owner_id, post_id)
  )`,
  'CREATE INDEX IF NOT EXISTS idx_observations_owner_sequence ON bookmark_observations(owner_id, sequence)',
  `CREATE TABLE IF NOT EXISTS bookmark_sync_state (
    owner_id TEXT PRIMARY KEY NOT NULL, next_poll_at INTEGER NOT NULL DEFAULT 0,
    lease_until INTEGER NOT NULL DEFAULT 0, failures INTEGER NOT NULL DEFAULT 0,
    last_started_at INTEGER, last_succeeded_at INTEGER, status TEXT NOT NULL DEFAULT 'waiting',
    fetched INTEGER NOT NULL DEFAULT 0, continuation TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS background_health (
    id INTEGER PRIMARY KEY CHECK (id = 1), heartbeat_at INTEGER NOT NULL
  )`,
];

export async function readActivity(ownerId: string, after: number, limit: number) {
  const result = await getD1().prepare(`SELECT o.sequence, o.post_id AS postId,
    o.observed_at AS firstObservedAt, b.created_at AS postCreatedAt,
    b.author_username AS authorUsername, b.text
    FROM bookmark_observations o JOIN bookmarks b
    ON b.owner_id = o.owner_id AND b.post_id = o.post_id
    WHERE o.owner_id = ? AND o.sequence > ? ORDER BY o.sequence ASC LIMIT ?`)
    .bind(ownerId, after, limit + 1).all<{
      sequence: number; postId: string; firstObservedAt: number;
      postCreatedAt: string | null; authorUsername: string; text: string;
    }>();
  const events = result.results.slice(0, limit).map((row) => ({
    ...row, type: 'first_observed' as const,
    url: `https://x.com/${row.authorUsername}/status/${row.postId}`,
  }));
  const sync = await getD1().prepare(`SELECT last_started_at AS lastStartedAt,
    last_succeeded_at AS lastSucceededAt, next_poll_at AS nextPollAt,
    status, fetched, (continuation IS NOT NULL) AS catchingUp
    FROM bookmark_sync_state WHERE owner_id = ?`).bind(ownerId).first();
  const latest = await getD1().prepare('SELECT MAX(sequence) AS cursor FROM bookmark_observations WHERE owner_id = ?')
    .bind(ownerId).first<{ cursor: number | null }>();
  return { events, nextCursor: events.at(-1)?.sequence ?? after, latestCursor: latest?.cursor ?? 0,
    hasMore: result.results.length > limit, sync };
}
