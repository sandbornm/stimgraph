import assert from 'node:assert/strict';
import test from 'node:test';
import { withOwnerWork } from './owner-work.ts';
import { revokeAndDeleteOwner, type RevocableSession } from './owner-revoke-delete.ts';
import { resolveStoredXSession } from './x-session-resolve.ts';

type Session = RevocableSession & { expiresAt: number };

test('a refresh waits until owner deletion finishes and then sees the row gone', async () => {
  const ownerId = 'owner-delete-race';
  let row: { ownerId: string; payload: string; expiresAt: number } | null = {
    ownerId,
    payload: 'sealed-old',
    expiresAt: 1,
  };
  let releaseDelete!: () => void;
  const holdDelete = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deleteEntered!: () => void;
  const deleteIsInside = new Promise<void>((resolve) => {
    deleteEntered = resolve;
  });
  let rotations = 0;
  let waiting!: () => void;
  const refreshIsWaiting = new Promise<void>((resolve) => {
    waiting = resolve;
  });

  const deletion = revokeAndDeleteOwner({
    ownerId,
    current: { accessToken: 'access-old', refreshToken: 'refresh-old' },
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => {
      deleteEntered();
      await holdDelete;
      return row ? [row.payload] : [];
    },
    openPayload: async () => ({ accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt: 1_000 }),
    revoke: async () => true,
    deleteData: async () => {
      row = null;
    },
  });
  await deleteIsInside;

  const refreshed = resolveStoredXSession<Session>({
    id: 'sid-delete-race',
    lockHeld: false,
    now: 50_000,
    keyUsable: true,
    load: async () => row,
    open: async () => ({
      session: { accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt: 1_000 },
      needsReseal: false,
    }),
    withLock: (id, action) => {
      const result = withOwnerWork(id, action);
      waiting();
      return result;
    },
    migrate: async () => {
      throw new Error('migrate');
    },
    refresh: async () => {
      rotations += 1;
      throw new Error('refresh');
    },
  });
  await refreshIsWaiting;
  assert.equal(rotations, 0);
  assert.ok(row);
  releaseDelete();
  const [outcome, resolved] = await Promise.all([deletion, refreshed]);
  assert.equal(resolved, null);
  assert.equal(rotations, 0);
  assert.equal(outcome.deleted, true);
  assert.equal(row, null);
});

test('revocation uses the token persisted by a refresh that finished before deletion', async () => {
  const ownerId = 'owner-refresh-then-delete';
  const store = new Map<string, Session>([
    ['sealed-old', { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: 1_000 }],
  ]);
  let payload = 'sealed-old';
  const resolved = await resolveStoredXSession<Session>({
    id: 'sid-refresh-then-delete',
    lockHeld: false,
    now: 50_000,
    keyUsable: true,
    load: async () => ({ ownerId, payload, expiresAt: 9_000_000 }),
    open: async (sealed) => {
      const session = store.get(sealed);
      return session ? { session, needsReseal: false } : null;
    },
    withLock: withOwnerWork,
    migrate: async () => {},
    refresh: async (_session, id) => {
      const next = { accessToken: 'access-2', refreshToken: 'refresh-2', expiresAt: 9_000_000 };
      store.set('sealed-new', next);
      payload = 'sealed-new';
      return { session: next, renewedCookie: id };
    },
  });
  assert.equal(resolved?.session.refreshToken, 'refresh-2');

  const revoked: Session[] = [];
  let deletedPayload = '';
  const outcome = await revokeAndDeleteOwner({
    ownerId,
    current: { accessToken: 'access-1', refreshToken: 'refresh-1' },
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => [payload],
    openPayload: async (sealed) => store.get(sealed) ?? null,
    revoke: async (session) => {
      revoked.push(session);
      return true;
    },
    deleteData: async () => {
      deletedPayload = payload;
      payload = '';
    },
  });
  assert.deepEqual(revoked.map((session) => session.refreshToken), ['refresh-2']);
  assert.equal(deletedPayload, 'sealed-new');
  assert.deepEqual(outcome, { deleted: true, revoked: true });
});

test('a locked refresh does not take the owner lock again', async () => {
  let loads = 0;
  const resolved = await resolveStoredXSession<Session>({
    id: 'sid-locked',
    lockHeld: true,
    now: 50_000,
    keyUsable: true,
    load: async () => {
      loads += 1;
      return { ownerId: 'owner-locked', payload: 'sealed', expiresAt: 1 };
    },
    open: async () => ({
      session: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_000 },
      needsReseal: false,
    }),
    withLock: async () => {
      throw new Error('nested lock');
    },
    migrate: async () => {},
    refresh: async (session) => ({ session: { ...session, accessToken: 'access-new', expiresAt: 90_000 } }),
  });
  assert.equal(loads, 2);
  assert.equal(resolved?.session.accessToken, 'access-new');
});

test('a fresh token does not take the owner lock', async () => {
  const resolved = await resolveStoredXSession<Session>({
    id: 'sid-fresh',
    lockHeld: false,
    now: 1_000,
    keyUsable: true,
    load: async () => ({ ownerId: 'owner-fresh', payload: 'sealed', expiresAt: 1 }),
    open: async () => ({
      session: { accessToken: 'access', refreshToken: 'refresh', expiresAt: 1_000 + 120_000 },
      needsReseal: false,
    }),
    withLock: async () => {
      throw new Error('locked');
    },
    migrate: async () => {
      throw new Error('migrate');
    },
    refresh: async () => {
      throw new Error('refresh');
    },
  });
  assert.equal(resolved?.session.accessToken, 'access');
});

test('owner deletion refuses without force and proceeds with force', async () => {
  async function run(force: boolean) {
    let deleted = false;
    const revoked: string[] = [];
    const outcome = await revokeAndDeleteOwner({
      ownerId: `owner-force-${force}`,
      current: { accessToken: 'access', refreshToken: 'refresh' },
      force,
      withLock: withOwnerWork,
      loadPayloads: async () => ['sealed'],
      openPayload: async () => ({ accessToken: 'access', refreshToken: 'refresh' }),
      revoke: async (session) => {
        revoked.push(session.refreshToken ?? '');
        return false;
      },
      deleteData: async () => {
        deleted = true;
      },
    });
    return { outcome, deleted, revoked };
  }

  const refused = await run(false);
  assert.equal(refused.deleted, false);
  assert.deepEqual(refused.revoked, ['refresh']);
  assert.deepEqual(refused.outcome, {
    deleted: false,
    revoked: false,
    retryable: true,
    error: 'X did not confirm that access was revoked. Nothing was deleted; try again.',
  });

  const forced = await run(true);
  assert.equal(forced.deleted, true);
  assert.deepEqual(forced.outcome, { deleted: true, revoked: false });
});
