import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withOwnerWork } from './owner-work.ts';
import { revokeExpiredSessions } from './revoke-expired-sessions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('import polling only selects unexpired rows, and revoke-expired deletes only after X confirms', async () => {
  const sync = readFileSync(join(root, 'lib/background-sync.ts'), 'utf8');
  const importAt = sync.indexOf('prepare(POLL_LIVE_SESSIONS_SQL)');
  const loopAt = sync.indexOf('for (const stored of sessions.results)');
  assert.ok(importAt >= 0 && importAt < loopAt);
  const pollSql = readFileSync(join(root, 'lib/owner-live-sql.ts'), 'utf8');
  const poll = pollSql.slice(pollSql.indexOf('export const POLL_LIVE_SESSIONS_SQL'));
  assert.match(poll, /WHERE expires_at > \?/);
  assert.doesNotMatch(poll, /expires_at <=/);
  assert.match(poll, /deleted_owners/);
  const revokeAt = sync.indexOf('revokeExpiredSessions(');
  const pendingAt = sync.indexOf('revokePendingGrants(');
  assert.ok(sync.indexOf('if (!tokenKeyUsable(') < revokeAt && revokeAt < pendingAt && pendingAt < importAt);
  assert.equal(sync.includes('iterateXBookmarks'), true);
  const helper = readFileSync(join(root, 'lib/revoke-expired-sessions.ts'), 'utf8');
  assert.equal(helper.includes('bookmark'), false);
  assert.match(helper, /if \(revoked\) await input\.deleteRow\(row\.id\)/);
  const health = readFileSync(join(root, 'app/api/health/route.ts'), 'utf8');
  assert.match(health, /SELECT COUNT\(\*\) AS count FROM x_sessions WHERE expires_at > \?/);
  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  const expiredQuery = storage.slice(
    storage.indexOf('export async function loadExpiredXSessionRows'),
    storage.indexOf('function ownerDeletionDb'),
  );
  assert.match(expiredQuery, /WHERE expires_at <= \? AND payload != ''/);

  const rows = [
    { id: 'ok', ownerId: 'owner-a', payload: 'sealed-ok', expiresAt: 0 },
    { id: 'no', ownerId: 'owner-a', payload: 'sealed-no', expiresAt: 0 },
    { id: 'boom', ownerId: 'owner-b', payload: 'sealed-boom', expiresAt: 0 },
    { id: 'closed', ownerId: 'owner-b', payload: 'sealed-closed', expiresAt: 0 },
    { id: 'empty', ownerId: 'owner-b', payload: '', expiresAt: 0 },
    { id: 'live', ownerId: 'owner-c', payload: 'sealed-live', expiresAt: 50 },
  ];
  const revoked: string[] = [];
  const deleted: string[] = [];
  await revokeExpiredSessions({
    now: 10,
    loadExpired: async (now) => rows
      .filter((row) => row.expiresAt <= now && row.payload !== '')
      .map((row) => ({ id: row.id, ownerId: row.ownerId, payload: row.payload })),
    withLock: withOwnerWork,
    openPayload: async (payload) => {
      if (payload === 'sealed-closed') throw new Error('sealed');
      if (payload === 'sealed-ok') return { refreshToken: 'refresh-ok' };
      if (payload === 'sealed-no') return { refreshToken: 'refresh-no' };
      if (payload === 'sealed-boom') return { refreshToken: 'refresh-boom' };
      return null;
    },
    revoke: async (session: { refreshToken: string }) => {
      revoked.push(session.refreshToken);
      if (session.refreshToken === 'refresh-ok') return true;
      if (session.refreshToken === 'refresh-boom') throw new Error('x down');
      return false;
    },
    deleteRow: async (id) => {
      deleted.push(id);
      const index = rows.findIndex((row) => row.id === id);
      assert.ok(index >= 0);
      rows.splice(index, 1);
    },
  });
  assert.deepEqual(revoked, ['refresh-ok', 'refresh-no', 'refresh-boom']);
  assert.deepEqual(deleted, ['ok']);
  assert.deepEqual(rows.map((row) => ({ id: row.id, payload: row.payload, expiresAt: row.expiresAt })), [
    { id: 'no', payload: 'sealed-no', expiresAt: 0 },
    { id: 'boom', payload: 'sealed-boom', expiresAt: 0 },
    { id: 'closed', payload: 'sealed-closed', expiresAt: 0 },
    { id: 'empty', payload: '', expiresAt: 0 },
    { id: 'live', payload: 'sealed-live', expiresAt: 50 },
  ]);
});
