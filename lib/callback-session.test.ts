import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { storeCallbackSession, type CallbackToken } from './callback-session.ts';
import { ownerDeletedSince, recordOwnerDeleted, type OwnerDeletionDb } from './owner-deletions.ts';
import { withOwnerWork } from './owner-work.ts';
import { deleteUnconfiguredAccount, revokeAndDeleteOwner } from './owner-revoke-delete.ts';
import { OWNER_SCOPED_TABLES } from './owner-tables.ts';

const ignoreDeleted = async () => {};

function deletionDb() {
  const database = new DatabaseSync(':memory:');
  database.exec('CREATE TABLE deleted_owners (owner_id TEXT PRIMARY KEY NOT NULL, deleted_at INTEGER NOT NULL)');
  const db: OwnerDeletionDb = {
    async run(sql, params) {
      database.prepare(sql).run(...params);
    },
    async first(sql, params) {
      const row = database.prepare(sql).get(...params);
      return (row as Record<string, unknown> | undefined) ?? null;
    },
  };
  return {
    recordOwnerDeleted: (ownerId: string, at: number) => recordOwnerDeleted(db, ownerId, at),
    ownerDeletedSince: (ownerId: string, since: number) => ownerDeletedSince(db, ownerId, since),
  };
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function emptyStore() {
  return new Map(OWNER_SCOPED_TABLES.map((entry) => [entry.table, [] as string[]]));
}

function occupied(store: Map<string, string[]>) {
  return OWNER_SCOPED_TABLES.map((entry) => entry.table).filter((table) => (store.get(table) ?? []).length > 0);
}

function wipe(store: Map<string, string[]>) {
  for (const entry of OWNER_SCOPED_TABLES) store.set(entry.table, []);
}

test('a callback write either lands before delete loads payloads or after delete finishes', async () => {
  const beforeOwner = 'callback-before-delete';
  const before = emptyStore();
  before.set('x_sessions', ['refresh-old']);
  before.set('accounts', ['old-account']);
  before.set('bookmarks', ['old-bookmark-text']);
  const beforeRevoked: string[] = [];
  await withOwnerWork(beforeOwner, async () => {
    before.set('x_sessions', ['refresh-new']);
  });
  const beforeOutcome = await revokeAndDeleteOwner({
    ownerId: beforeOwner,
    current: { accessToken: 'refresh-old', refreshToken: 'refresh-old' },
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => before.get('x_sessions') ?? [],
    openPayload: async (payload) => ({ accessToken: payload, refreshToken: payload }),
    revoke: async (session) => {
      beforeRevoked.push(session.refreshToken ?? '');
      return true;
    },
    deleteData: async () => {
      wipe(before);
    },
    recordOwnerDeleted: ignoreDeleted,
  });
  assert.deepEqual(beforeRevoked, ['refresh-new']);
  assert.deepEqual(beforeOutcome, { deleted: true, revoked: true });
  assert.deepEqual(occupied(before), []);
  assert.equal((before.get('bookmarks') ?? []).includes('old-bookmark-text'), false);

  const afterOwner = 'callback-after-delete';
  const afterTomb = deletionDb();
  const after = emptyStore();
  after.set('x_sessions', ['refresh-old']);
  after.set('accounts', ['old-account']);
  after.set('bookmarks', ['old-bookmark-text']);
  const afterRevoked: string[] = [];
  const newRevoked: string[] = [];
  const log: string[] = [];
  const pendingCreatedAt = Date.now();
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const deletion = revokeAndDeleteOwner({
    ownerId: afterOwner,
    current: { accessToken: 'refresh-old', refreshToken: 'refresh-old' },
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => {
      log.push('load');
      entered();
      await hold;
      return after.get('x_sessions') ?? [];
    },
    openPayload: async (payload) => ({ accessToken: payload, refreshToken: payload }),
    revoke: async (session) => {
      log.push('revoke');
      afterRevoked.push(session.refreshToken ?? '');
      return true;
    },
    deleteData: async () => {
      log.push('delete');
      wipe(after);
    },
    recordOwnerDeleted: afterTomb.recordOwnerDeleted,
  });
  await inside;
  const callback = withOwnerWork(afterOwner, async () => {
    log.push('callback');
    return storeCallbackSession({
      ownerId: afterOwner,
      pendingCreatedAt,
      session: { accessToken: 'refresh-new', refreshToken: 'refresh-new' },
      sessionId: 'sid-new',
      payload: 'refresh-new',
      expiresAt: 9_000,
      ownerDeletedSince: afterTomb.ownerDeletedSince,
      loadRows: async () => (after.get('x_sessions') ?? []).map((payload) => ({ id: payload, payload })),
      openPayload: async (payload) => ({ accessToken: payload, refreshToken: payload }),
      insert: async () => {
        after.set('x_sessions', ['refresh-new']);
        return true;
      },
      deleteRow: async () => {
        throw new Error('deleted');
      },
      expireRow: async () => {
        throw new Error('expired');
      },
      revoke: async (session) => {
        newRevoked.push(session.refreshToken ?? '');
        return true;
      },
    });
  });
  await Promise.resolve();
  assert.deepEqual(log, ['load']);
  assert.deepEqual(after.get('x_sessions'), ['refresh-old']);
  assert.deepEqual(after.get('bookmarks'), ['old-bookmark-text']);
  release();
  const [outcome, stored] = await Promise.all([deletion, callback]);
  assert.deepEqual(outcome, { deleted: true, revoked: true });
  assert.equal(stored, 'rejected');
  assert.deepEqual(log, ['load', 'revoke', 'delete', 'callback']);
  assert.deepEqual(afterRevoked, ['refresh-old']);
  assert.deepEqual(newRevoked, ['refresh-new']);
  assert.deepEqual(occupied(after), []);
  assert.deepEqual(after.get('x_sessions'), []);
  assert.deepEqual(after.get('accounts'), []);
  assert.deepEqual(after.get('bookmarks'), []);

  const callbackSource = readFileSync(join(root, 'app/api/auth/x/callback/route.ts'), 'utf8');
  const exchangeAt = callbackSource.indexOf('exchangeAuthorizationCode(');
  const finishAt = callbackSource.indexOf('finishExchangedGrant(');
  const profileAt = callbackSource.indexOf('fetchXProfile(');
  const sealAt = callbackSource.indexOf('sealXSession(');
  const lockAt = callbackSource.indexOf('withOwnerWork(');
  const insertAt = callbackSource.indexOf('insertXSessionRecord', lockAt);
  assert.ok(exchangeAt >= 0 && exchangeAt < finishAt && finishAt < profileAt && profileAt < sealAt && sealAt < lockAt && lockAt < insertAt);
  const finish = callbackSource.slice(finishAt, callbackSource.indexOf("if (outcome === 'stored'"));
  assert.match(finish, /storeCallbackSession\(/);
  assert.match(finish, /loadOwnerXSessionRows/);
  assert.match(finish, /insertXSessionRecord/);
  assert.match(finish, /deleteXSessionRecord/);
  assert.match(finish, /expireXSessionRecord/);
  assert.match(finish, /recordPendingGrant/);
  assert.equal(finish.includes('replaceXSessionRecord'), false);
  assert.equal(finish.includes('loadOwnerXSessionPayloads'), false);
  assert.match(finish, /ownerDeletedSince/);
  assert.equal(finish.includes('exchangeAuthorizationCode'), false);
  assert.match(callbackSource, /auth=failed|homeRedirect\(request, 'failed'/);
  const locked = callbackSource.slice(lockAt, callbackSource.indexOf('revoke: revokeXSession'));
  assert.equal(locked.includes('exchangeAuthorizationCode'), false);
  assert.equal(locked.includes('fetchXProfile'), false);
  assert.equal(locked.includes('sealXSession'), false);
  const revokeSource = readFileSync(join(root, 'lib/owner-revoke-delete.ts'), 'utf8');
  const section = revokeSource.indexOf('return input.withLock(');
  const loadAt = revokeSource.indexOf('input.loadPayloads(');
  const revokeAt = revokeSource.indexOf('input.revoke(');
  const recordAt = revokeSource.indexOf('input.recordOwnerDeleted(');
  const deleteAt = revokeSource.indexOf('input.deleteData(');
  assert.ok(section >= 0 && section < loadAt && loadAt < revokeAt && revokeAt < recordAt && recordAt < deleteAt);
  const unconfiguredDelete = revokeSource.slice(revokeSource.indexOf('export async function deleteUnconfiguredAccount'));
  const unconfiguredRecordAt = unconfiguredDelete.indexOf('input.recordOwnerDeleted(');
  const unconfiguredDeleteAt = unconfiguredDelete.indexOf('input.deleteData(');
  assert.ok(unconfiguredRecordAt >= 0 && unconfiguredRecordAt < unconfiguredDeleteAt);
  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  const take = storage.slice(storage.indexOf('export async function takeOauthPending'), storage.indexOf('export async function insertXSessionRecord'));
  assert.match(take, /createdAt: row\.created_at/);
  assert.equal(storage.includes('replaceXSessionRecord'), false);
  const insertBody = storage.slice(storage.indexOf('export async function insertXSessionRecord'), storage.indexOf('export async function recordPendingGrant'));
  assert.match(insertBody, /INSERT_SESSION_IF_LIVE_SQL/);
  const liveSql = readFileSync(join(root, 'lib/owner-live-sql.ts'), 'utf8');
  assert.match(liveSql, /INSERT INTO x_sessions/);
  assert.match(liveSql, /deleted_at >= \?/);
  assert.doesNotMatch(insertBody, /DELETE/);
  const loadRowsBody = storage.slice(storage.indexOf('export async function loadOwnerXSessionRows'), storage.indexOf('export async function ownerHasSession'));
  assert.match(loadRowsBody, /SELECT id, payload FROM x_sessions WHERE owner_id = \?/);
  const sessionSource = readFileSync(join(root, 'lib/callback-session.ts'), 'utf8');
  const deletedCheck = sessionSource.indexOf('input.ownerDeletedSince(');
  const rowsAt = sessionSource.indexOf('input.loadRows(');
  const sessionInsertAt = sessionSource.indexOf('input.insert(');
  const sessionRevokeAt = sessionSource.indexOf('input.revoke(', sessionInsertAt);
  const sessionDeleteAt = sessionSource.indexOf('input.deleteRow(', sessionInsertAt);
  assert.ok(deletedCheck >= 0 && deletedCheck < rowsAt && rowsAt < sessionInsertAt && sessionInsertAt < sessionRevokeAt && sessionInsertAt < sessionDeleteAt);
});

test('a sign-in started after the delete is stored normally', async () => {
  const ownerId = 'callback-signin-after-delete';
  const tomb = deletionDb();
  const rows: string[] = [];
  await revokeAndDeleteOwner({
    ownerId,
    current: null,
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => [],
    openPayload: async () => null,
    revoke: async () => true,
    deleteData: async () => {},
    recordOwnerDeleted: tomb.recordOwnerDeleted,
  });
  const outcome = await storeCallbackSession({
    ownerId,
    pendingCreatedAt: Date.now() + 60_000,
    session: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    sessionId: 'sid-after',
    payload: 'sealed-new',
    expiresAt: 9_000,
    ownerDeletedSince: tomb.ownerDeletedSince,
    loadRows: async () => [],
    openPayload: async () => null,
    insert: async (_id, _owner, payload) => {
      rows.push(payload);
      return true;
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
    expireRow: async () => {
      throw new Error('expired');
    },
    revoke: async () => {
      throw new Error('new grant revoked');
    },
  });
  assert.equal(outcome, 'stored');
  assert.deepEqual(rows, ['sealed-new']);
});

test('a deletion at the pending row time revokes the new grant and stores nothing', async () => {
  const ownerId = 'callback-deleted-at-pending';
  const tomb = deletionDb();
  await tomb.recordOwnerDeleted(ownerId, 80);
  const outcome = await storeCallbackSession({
    ownerId,
    pendingCreatedAt: 80,
    session: { accessToken: 'access-eq', refreshToken: 'refresh-eq' },
    sessionId: 'sid-eq',
    payload: 'sealed-eq',
    expiresAt: 90,
    ownerDeletedSince: tomb.ownerDeletedSince,
    loadRows: async () => {
      throw new Error('loaded');
    },
    openPayload: async () => {
      throw new Error('opened');
    },
    insert: async () => {
      throw new Error('inserted');
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
    expireRow: async () => {
      throw new Error('expired');
    },
    revoke: async (session) => {
      assert.equal(session.refreshToken, 'refresh-eq');
      return false;
    },
  });
  assert.equal(outcome, 'rejected');
});

test('an unconfigured delete blocks a sign-in that started earlier', async () => {
  const ownerId = 'callback-unconfigured-delete';
  const tomb = deletionDb();
  const pendingCreatedAt = Date.now();
  const rows: string[] = [];
  const revoked: string[] = [];
  await deleteUnconfiguredAccount({
    clientCredentials: false,
    cookieValue: 'opaque-session',
    ownerIdFromRow: ownerId,
    force: false,
    withLock: withOwnerWork,
    loadPayloads: async () => [],
    openPayload: async () => null,
    revoke: async () => true,
    deleteData: async () => {},
    recordOwnerDeleted: tomb.recordOwnerDeleted,
  });
  const outcome = await storeCallbackSession({
    ownerId,
    pendingCreatedAt,
    session: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    sessionId: 'sid-unconfigured',
    payload: 'sealed-new',
    expiresAt: 9_000,
    ownerDeletedSince: tomb.ownerDeletedSince,
    loadRows: async () => rows.map((payload) => ({ id: payload, payload })),
    openPayload: async () => null,
    insert: async (_id, _owner, payload) => {
      rows.push(payload);
      return true;
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
    expireRow: async () => {
      throw new Error('expired');
    },
    revoke: async (session) => {
      revoked.push(session.refreshToken ?? '');
      throw new Error('revoke down');
    },
  });
  assert.equal(outcome, 'rejected');
  assert.deepEqual(rows, []);
  assert.deepEqual(revoked, ['refresh-new']);
});

test('a previous row is removed only after X confirms revocation', async () => {
  const rows: { id: string; payload: string; expiresAt: number }[] = [
    { id: 'row-revoked', payload: 'sealed-old', expiresAt: 40 },
    { id: 'row-revoke-false', payload: 'sealed-false', expiresAt: 40 },
    { id: 'row-revoke-throws', payload: 'sealed-throws', expiresAt: 40 },
    { id: 'row-closed', payload: 'sealed-closed', expiresAt: 40 },
    { id: 'row-unopenable', payload: 'sealed-unopenable', expiresAt: 40 },
    { id: 'row-same-refresh', payload: 'sealed-same-refresh', expiresAt: 40 },
    { id: 'row-same-access', payload: 'sealed-same-access', expiresAt: 40 },
  ];
  const opened: Record<string, CallbackToken | null> = {
    'sealed-old': { accessToken: 'access-old', refreshToken: 'refresh-old' },
    'sealed-false': { accessToken: 'access-false', refreshToken: 'refresh-false' },
    'sealed-throws': { accessToken: 'access-throws', refreshToken: 'refresh-throws' },
    'sealed-closed': null,
    'sealed-same-refresh': { accessToken: 'access-other', refreshToken: 'refresh-new' },
    'sealed-same-access': { accessToken: 'access-new', refreshToken: 'refresh-other' },
  };
  let stored = false;
  const revoked: string[] = [];
  const outcome = await storeCallbackSession({
    ownerId: 'callback-confirm-revoke',
    pendingCreatedAt: 10,
    session: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    sessionId: 'sid-new',
    payload: 'sealed-new',
    expiresAt: 50,
    ownerDeletedSince: () => false,
    loadRows: async () => rows.map((row) => ({ id: row.id, payload: row.payload })),
    openPayload: async (payload) => {
      if (payload === 'sealed-unopenable') throw new Error('sealed');
      return opened[payload] ?? null;
    },
    insert: async (id, ownerId, payload, expiresAt) => {
      assert.equal(stored, false);
      assert.equal(ownerId, 'callback-confirm-revoke');
      assert.deepEqual(rows.map((row) => row.id), [
        'row-revoked',
        'row-revoke-false',
        'row-revoke-throws',
        'row-closed',
        'row-unopenable',
        'row-same-refresh',
        'row-same-access',
      ]);
      rows.push({ id, payload, expiresAt });
      stored = true;
      return true;
    },
    deleteRow: async (id) => {
      assert.equal(stored, true);
      const index = rows.findIndex((row) => row.id === id);
      assert.ok(index >= 0);
      rows.splice(index, 1);
    },
    expireRow: async (id) => {
      assert.equal(stored, true);
      const row = rows.find((item) => item.id === id);
      assert.ok(row);
      assert.notEqual(id, 'sid-new');
      row.expiresAt = 0;
    },
    revoke: async (session) => {
      assert.equal(stored, true);
      revoked.push(session.refreshToken ?? '');
      if (session.refreshToken === 'refresh-false') return false;
      if (session.refreshToken === 'refresh-throws') throw new Error('x down');
      return true;
    },
  });
  assert.equal(outcome, 'stored');
  assert.deepEqual(revoked, ['refresh-old', 'refresh-false', 'refresh-throws']);
  assert.deepEqual(rows, [
    { id: 'row-revoke-false', payload: 'sealed-false', expiresAt: 0 },
    { id: 'row-revoke-throws', payload: 'sealed-throws', expiresAt: 0 },
    { id: 'row-closed', payload: 'sealed-closed', expiresAt: 0 },
    { id: 'row-unopenable', payload: 'sealed-unopenable', expiresAt: 0 },
    { id: 'sid-new', payload: 'sealed-new', expiresAt: 50 },
  ]);
});

test('a session insert that is rejected by the delete tombstone stores nothing', async () => {
  const expired: string[] = [];
  const outcome = await storeCallbackSession({
    ownerId: 'owner-tombstone-insert',
    pendingCreatedAt: 10,
    session: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    sessionId: 'sid-new',
    payload: 'sealed-new',
    expiresAt: 50,
    ownerDeletedSince: () => false,
    loadRows: async () => [{ id: 'row-old', payload: 'sealed-old' }],
    openPayload: async () => ({ accessToken: 'access-old', refreshToken: 'refresh-old' }),
    insert: async () => false,
    deleteRow: async () => {
      throw new Error('deleted');
    },
    expireRow: async (id) => {
      expired.push(id);
    },
    revoke: async () => {
      throw new Error('revoked');
    },
  });
  assert.equal(outcome, 'rejected');
  assert.deepEqual(expired, []);
});
