import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { storeCallbackSession } from './callback-session.ts';
import { ACCOUNT_DELETED_ERROR, withLiveOwner } from './live-owner.ts';
import { ownerDeletedSince, ownerIsLive, recordOwnerDeleted, type OwnerDeletionDb } from './owner-deletions.ts';
import { withOwnerWork } from './owner-work.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function openDb() {
  const database = new DatabaseSync(':memory:');
  database.exec(`CREATE TABLE deleted_owners (
    owner_id TEXT PRIMARY KEY NOT NULL,
    deleted_at INTEGER NOT NULL
  )`);
  database.exec(`CREATE TABLE x_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`);
  return database;
}

function adapter(database: DatabaseSync): OwnerDeletionDb {
  return {
    async run(sql, params) {
      database.prepare(sql).run(...params);
    },
    async first(sql, params) {
      const row = database.prepare(sql).get(...params);
      return (row as Record<string, unknown> | undefined) ?? null;
    },
  };
}

function insertSession(database: DatabaseSync, ownerId: string, id: string, createdAt: number) {
  database.prepare('INSERT INTO x_sessions (id, owner_id, created_at) VALUES (?, ?, ?)').run(id, ownerId, createdAt);
}

test('a tombstone is visible to a fresh helper and keeps the later timestamp', async () => {
  const database = openDb();
  await recordOwnerDeleted(adapter(database), 'owner-fresh', 50);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-fresh', 50), true);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-fresh', 51), false);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-other', 0), false);
  await recordOwnerDeleted(adapter(database), 'owner-fresh', 20);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-fresh', 50), true);
  await recordOwnerDeleted(adapter(database), 'owner-fresh', 80);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-fresh', 80), true);
  assert.equal(await ownerDeletedSince(adapter(database), 'owner-fresh', 81), false);
  assert.equal(readFileSync(join(root, 'lib/owner-deletions.ts'), 'utf8').includes('new Map'), false);
});

test('withLiveOwner refuses a tombstone at or after session creation and allows a later session', async () => {
  const database = openDb();
  insertSession(database, 'owner-equal', 'old-equal', 100);
  await recordOwnerDeleted(adapter(database), 'owner-equal', 100);
  const equal = await withLiveOwner('owner-equal', async () => 'wrote', {
    withLock: withOwnerWork,
    isLive: (ownerId) => ownerIsLive(adapter(database), ownerId),
  });
  assert.deepEqual(equal, { live: false, error: ACCOUNT_DELETED_ERROR });

  insertSession(database, 'owner-after', 'old-after', 100);
  await recordOwnerDeleted(adapter(database), 'owner-after', 150);
  const after = await withLiveOwner('owner-after', async () => 'wrote', {
    withLock: withOwnerWork,
    isLive: (ownerId) => ownerIsLive(adapter(database), ownerId),
  });
  assert.deepEqual(after, { live: false, error: ACCOUNT_DELETED_ERROR });

  insertSession(database, 'owner-after', 'new-after', 151);
  const renewed = await withLiveOwner('owner-after', async () => 'wrote', {
    withLock: withOwnerWork,
    isLive: (ownerId) => ownerIsLive(adapter(database), ownerId),
  });
  assert.deepEqual(renewed, { live: true, value: 'wrote' });

  insertSession(database, 'owner-plain', 'plain', 10);
  const plain = await withLiveOwner('owner-plain', async () => 'wrote', {
    withLock: withOwnerWork,
    isLive: (ownerId) => ownerIsLive(adapter(database), ownerId),
  });
  assert.deepEqual(plain, { live: true, value: 'wrote' });
});

test('a callback pending from before the delete is rejected from the stored tombstone', async () => {
  const database = openDb();
  await recordOwnerDeleted(adapter(database), 'owner-callback', 80);
  let inserted = false;
  const rejected = await storeCallbackSession({
    ownerId: 'owner-callback',
    pendingCreatedAt: 70,
    session: { accessToken: 'access-old', refreshToken: 'refresh-old' },
    sessionId: 'sid-old',
    payload: 'sealed-old',
    expiresAt: 90,
    ownerDeletedSince: (ownerId, since) => ownerDeletedSince(adapter(database), ownerId, since),
    loadRows: async () => {
      throw new Error('loaded');
    },
    openPayload: async () => {
      throw new Error('opened');
    },
    insert: async () => {
      inserted = true;
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
    revoke: async (session) => {
      assert.equal(session.refreshToken, 'refresh-old');
      return true;
    },
  });
  assert.equal(rejected, 'rejected');
  assert.equal(inserted, false);

  const stored = await storeCallbackSession({
    ownerId: 'owner-callback',
    pendingCreatedAt: 81,
    session: { accessToken: 'access-new', refreshToken: 'refresh-new' },
    sessionId: 'sid-new',
    payload: 'sealed-new',
    expiresAt: 120,
    ownerDeletedSince: (ownerId, since) => ownerDeletedSince(adapter(database), ownerId, since),
    loadRows: async () => [],
    openPayload: async () => null,
    insert: async () => {
      inserted = true;
    },
    deleteRow: async () => {
      throw new Error('deleted');
    },
    revoke: async () => {
      throw new Error('revoked new');
    },
  });
  assert.equal(stored, 'stored');
  assert.equal(inserted, true);
});

test('deleted owners are stored in D1 and kept out of account deletion', () => {
  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  assert.match(storage, /CREATE TABLE IF NOT EXISTS deleted_owners/);
  assert.match(storage, /export async function recordOwnerDeleted\(ownerId: string, at: number\)/);
  assert.match(storage, /export async function ownerDeletedSince\(ownerId: string, since: number\)/);
  assert.match(storage, /export async function ownerIsLive\(ownerId: string\)/);
  assert.match(storage, /writeOwnerDeleted\(ownerDeletionDb\(\), ownerId, at\)/);
  assert.match(storage, /return deletedSince\(ownerDeletionDb\(\), ownerId, since\)/);
  assert.match(storage, /return liveOwner\(ownerDeletionDb\(\), ownerId\)/);
  const migration = readFileSync(join(root, 'drizzle/0008_deleted_owners.sql'), 'utf8');
  assert.match(migration, /CREATE TABLE deleted_owners \(owner_id TEXT PRIMARY KEY NOT NULL, deleted_at INTEGER NOT NULL\)/);
  const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.find((entry) => entry.idx === 8)?.tag, '0008_deleted_owners');
  const callback = readFileSync(join(root, 'app/api/auth/x/callback/route.ts'), 'utf8');
  assert.match(callback, /ownerDeletedSince,/);
  assert.equal(callback.includes('owner-deletions'), false);
  const bind = readFileSync(join(root, 'lib/live-owner-bind.ts'), 'utf8');
  assert.match(bind, /isLive: ownerIsLive/);
  assert.equal(bind.includes('ownerHasSession'), false);
  assert.match(bind, /export function withLiveOwner<T>\(ownerId: string, write: \(\) => Promise<T>\)/);
  const route = readFileSync(join(root, 'app/api/data/route.ts'), 'utf8');
  assert.equal(route.split('recordOwnerDeleted,').length - 1, 2);
  const revoke = readFileSync(join(root, 'lib/owner-revoke-delete.ts'), 'utf8');
  assert.match(revoke, /await input\.deleteData\(input\.ownerId\);\s*await input\.recordOwnerDeleted\(input\.ownerId, Date\.now\(\)\)/);
  assert.match(revoke, /await input\.deleteData\(decision\.ownerId\);\s*await input\.recordOwnerDeleted\(decision\.ownerId, Date\.now\(\)\)/);
});
