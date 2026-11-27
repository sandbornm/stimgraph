import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { disconnectPresentedSession } from './disconnect-session.ts';
import { withOwnerWork } from './owner-work.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('disconnect revokes the presented row under the owner lock, including an expired row', async () => {
  const rows = new Map<string, { ownerId: string; payload: string; expiresAt: number }>([
    ['opaque-expired', { ownerId: 'owner-disconnect', payload: 'sealed-stale', expiresAt: 1 }],
  ]);
  const sessions = new Map([
    ['sealed-stale', { accessToken: 'access-stale', refreshToken: 'refresh-stale' }],
    ['sealed-fresh', { accessToken: 'access-expired', refreshToken: 'refresh-expired' }],
    ['sealed-closed', null],
  ]);
  const opened: string[] = [];
  const revoked: string[] = [];
  const deleted: string[] = [];
  let loads = 0;
  const outcome = await disconnectPresentedSession({
    cookieValue: 'opaque-expired',
    withLock: withOwnerWork,
    loadRow: async (id) => {
      loads += 1;
      const row = rows.get(id);
      if (!row || row.expiresAt > 10) return null;
      if (loads === 1) return { ownerId: row.ownerId, payload: 'sealed-stale' };
      return { ownerId: row.ownerId, payload: 'sealed-fresh' };
    },
    openPayload: async (payload) => {
      opened.push(payload);
      return sessions.get(payload) ?? null;
    },
    revoke: async (session) => {
      revoked.push(session.refreshToken ?? '');
      return true;
    },
    deleteRow: async (id) => {
      deleted.push(id);
      rows.delete(id);
    },
  });
  assert.deepEqual(outcome, { revoked: true });
  assert.deepEqual(opened, ['sealed-fresh']);
  assert.deepEqual(revoked, ['refresh-expired']);
  assert.deepEqual(deleted, ['opaque-expired']);
  assert.equal(rows.has('opaque-expired'), false);
  assert.ok(loads >= 2);

  rows.set('opaque-expired', { ownerId: 'owner-disconnect', payload: 'sealed-fresh', expiresAt: 1 });
  const failed = await disconnectPresentedSession({
    cookieValue: 'opaque-expired',
    withLock: withOwnerWork,
    loadRow: async (id) => {
      const row = rows.get(id);
      return row ? { ownerId: row.ownerId, payload: row.payload } : null;
    },
    openPayload: async (payload) => sessions.get(payload) ?? null,
    revoke: async () => false,
    deleteRow: async (id) => {
      rows.delete(id);
    },
  });
  assert.deepEqual(failed, { revoked: false });
  assert.equal(rows.has('opaque-expired'), false);

  rows.set('opaque-expired', { ownerId: 'owner-disconnect', payload: 'sealed-fresh', expiresAt: 1 });
  const thrown = await disconnectPresentedSession({
    cookieValue: 'opaque-expired',
    withLock: withOwnerWork,
    loadRow: async (id) => {
      const row = rows.get(id);
      return row ? { ownerId: row.ownerId, payload: row.payload } : null;
    },
    openPayload: async (payload) => sessions.get(payload) ?? null,
    revoke: async () => {
      throw new Error('network');
    },
    deleteRow: async (id) => {
      rows.delete(id);
    },
  });
  assert.deepEqual(thrown, { revoked: false });
  assert.equal(rows.has('opaque-expired'), false);

  rows.set('opaque-closed', { ownerId: 'owner-disconnect', payload: 'sealed-closed', expiresAt: 1 });
  const closed = await disconnectPresentedSession({
    cookieValue: 'opaque-closed',
    withLock: withOwnerWork,
    loadRow: async (id) => {
      const row = rows.get(id);
      return row ? { ownerId: row.ownerId, payload: row.payload } : null;
    },
    openPayload: async () => {
      throw new Error('unreadable');
    },
    revoke: async () => {
      throw new Error('revoked closed');
    },
    deleteRow: async (id) => {
      rows.delete(id);
    },
  });
  assert.deepEqual(closed, { revoked: false });
  assert.equal(rows.has('opaque-closed'), false);

  let dottedLoads = 0;
  const dotted = await disconnectPresentedSession({
    cookieValue: 'legacy.dotted.cookie',
    withLock: async () => {
      throw new Error('locked');
    },
    loadRow: async () => {
      dottedLoads += 1;
      return { ownerId: 'owner-disconnect', payload: 'sealed-fresh' };
    },
    openPayload: async () => {
      throw new Error('opened');
    },
    revoke: async () => {
      throw new Error('revoked');
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
  });
  assert.equal(dottedLoads, 0);
  assert.deepEqual(dotted, { revoked: false });

  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  const body = storage.slice(storage.indexOf('export async function loadXSessionPayload'), storage.indexOf('export async function loadXSessionRecord'));
  assert.match(body, /SELECT payload, owner_id FROM x_sessions WHERE id = \?/);
  assert.doesNotMatch(body, /expires_at/);
  assert.doesNotMatch(body, /DELETE/);
  const route = readFileSync(join(root, 'app/api/auth/x/disconnect/route.ts'), 'utf8');
  const callAt = route.indexOf('disconnectPresentedSession(');
  const clearAt = route.indexOf('clearSessionCookie(', callAt);
  assert.ok(callAt >= 0 && clearAt > callAt);
  assert.match(route, /loadXSessionPayload/);
  assert.match(route, /deleteXSessionRecord/);
  assert.match(route, /revokeXSession/);
  assert.match(route, /withOwnerWork/);
  assert.match(route, /\{ disconnected: true \}/);
});
