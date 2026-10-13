import { getD1 } from '@/db/index';
import { ensureSchema, storeBookmarks } from '@/db/storage';
import { getStoredXSession } from './x-auth-server';
import { iterateXBookmarks } from './x-bookmarks';
import { getRuntimeValue } from './runtime-env';
import { XRequestError } from './x-errors';
import { POLL_INTERVAL_MS, POLL_LEASE_MS, pollDelay } from './background-policy';
import { withOwnerWork } from './owner-work';

export async function pollConnectedAccounts() {
  if (getRuntimeValue('STIMGRAPH_BACKGROUND_POLL') !== 'true') return;
  await ensureSchema();
  const d1 = getD1();
  const now = Date.now();
  await d1.prepare(`INSERT INTO background_health(id, heartbeat_at) VALUES (1, ?)
    ON CONFLICT(id) DO UPDATE SET heartbeat_at = excluded.heartbeat_at`).bind(now).run();
  const sessions = await d1.prepare(`SELECT id, owner_id FROM x_sessions
    WHERE expires_at > ? ORDER BY updated_at DESC`).bind(now)
    .all<{ id: string; owner_id: string }>();
  for (const stored of sessions.results) {
    await withOwnerWork(stored.owner_id, async () => {
      // Deletion may have completed after the scheduler took its session snapshot.
      if (!await d1.prepare('SELECT id FROM x_sessions WHERE id = ?').bind(stored.id).first()) return;
      await d1.prepare('INSERT OR IGNORE INTO bookmark_sync_state(owner_id) VALUES (?)').bind(stored.owner_id).run();
      const claimed = await d1.prepare(`UPDATE bookmark_sync_state
        SET lease_until = ?, last_started_at = ?, status = 'polling'
        WHERE owner_id = ? AND next_poll_at <= ? AND lease_until < ?
        RETURNING failures, continuation`).bind(now + POLL_LEASE_MS, now, stored.owner_id, now, now)
        .first<{ failures: number; continuation: string | null }>();
      if (!claimed) return;
      let fetched = 0;
      let continuation: string | null = claimed.continuation;
      try {
        const active = await getStoredXSession(stored.id);
        if (!active) {
          await d1.prepare(`UPDATE bookmark_sync_state SET lease_until = 0, status = 'reconnect_required',
            next_poll_at = ? WHERE owner_id = ?`).bind(now + POLL_INTERVAL_MS, stored.owner_id).run();
          return;
        }
        // Most polls read one page. Catch up across a persisted cursor when a burst
        // exceeds five pages, instead of silently dropping saves beyond the limit.
        for await (const page of iterateXBookmarks({ accessToken: active.session.accessToken,
          userId: stored.owner_id, limit: 100, pageSize: 20, startToken: continuation ?? undefined })) {
          const saved = await storeBookmarks({ owner: active.session.profile, bookmarks: page.bookmarks,
            skipUnchanged: true, optimize: false });
          fetched += page.bookmarks.length;
          const overlap = saved.inserted < page.bookmarks.length;
          continuation = overlap ? null : page.nextToken ?? null;
          if (overlap || !continuation) break;
        }
        await d1.prepare(`UPDATE bookmark_sync_state SET lease_until = 0, failures = 0,
          last_succeeded_at = ?, next_poll_at = ?, status = 'ok', fetched = ?, continuation = ?
          WHERE owner_id = ?`).bind(Date.now(), Date.now() + POLL_INTERVAL_MS, fetched, continuation, stored.owner_id).run();
      } catch (error) {
        const failures = claimed.failures + 1;
        const status = error instanceof XRequestError ? `x_${error.status}` : 'temporary_error';
        const retryAt = error instanceof XRequestError ? error.retryAt : 0;
        // Expired pagination cursors can be restarted at the head on the next attempt.
        if (error instanceof XRequestError && error.status === 400) continuation = null;
        await d1.prepare(`UPDATE bookmark_sync_state SET lease_until = 0, failures = ?,
          next_poll_at = ?, status = ?, fetched = ?, continuation = ? WHERE owner_id = ?`)
          .bind(failures, Date.now() + pollDelay(failures, retryAt), status, fetched, continuation, stored.owner_id).run();
      }
    });
  }
}
