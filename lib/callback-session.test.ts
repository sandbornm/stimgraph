import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { withOwnerWork } from './owner-work.ts';
import { revokeAndDeleteOwner } from './owner-revoke-delete.ts';
import { OWNER_SCOPED_TABLES } from './owner-tables.ts';

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
  });
  assert.deepEqual(beforeRevoked, ['refresh-new']);
  assert.deepEqual(beforeOutcome, { deleted: true, revoked: true });
  assert.deepEqual(occupied(before), []);
  assert.equal((before.get('bookmarks') ?? []).includes('old-bookmark-text'), false);

  const afterOwner = 'callback-after-delete';
  const after = emptyStore();
  after.set('x_sessions', ['refresh-old']);
  after.set('accounts', ['old-account']);
  after.set('bookmarks', ['old-bookmark-text']);
  const afterRevoked: string[] = [];
  const log: string[] = [];
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
  });
  await inside;
  const callback = withOwnerWork(afterOwner, async () => {
    log.push('callback');
    after.set('x_sessions', ['refresh-new']);
  });
  await Promise.resolve();
  assert.deepEqual(log, ['load']);
  assert.deepEqual(after.get('x_sessions'), ['refresh-old']);
  assert.deepEqual(after.get('bookmarks'), ['old-bookmark-text']);
  release();
  const [outcome] = await Promise.all([deletion, callback]);
  assert.deepEqual(outcome, { deleted: true, revoked: true });
  assert.deepEqual(log, ['load', 'revoke', 'delete', 'callback']);
  assert.deepEqual(afterRevoked, ['refresh-old']);
  assert.deepEqual(occupied(after), ['x_sessions']);
  assert.deepEqual(after.get('x_sessions'), ['refresh-new']);
  assert.deepEqual(after.get('accounts'), []);
  assert.deepEqual(after.get('bookmarks'), []);

  const callbackSource = readFileSync(join(root, 'app/api/auth/x/callback/route.ts'), 'utf8');
  const exchangeAt = callbackSource.indexOf('exchangeAuthorizationCode(');
  const profileAt = callbackSource.indexOf('fetchXProfile(');
  const sealAt = callbackSource.indexOf('sealXSession(');
  const lockAt = callbackSource.indexOf('withOwnerWork(');
  const replaceAt = callbackSource.indexOf('replaceXSessionRecord(');
  assert.ok(exchangeAt >= 0 && exchangeAt < profileAt && profileAt < sealAt && sealAt < lockAt && lockAt < replaceAt);
  const locked = callbackSource.slice(lockAt, callbackSource.indexOf('return connectedPage'));
  assert.match(locked, /replaceXSessionRecord\(/);
  assert.equal(locked.includes('exchangeAuthorizationCode'), false);
  assert.equal(locked.includes('fetchXProfile'), false);
  assert.equal(locked.includes('sealXSession'), false);
  const revokeSource = readFileSync(join(root, 'lib/owner-revoke-delete.ts'), 'utf8');
  const section = revokeSource.indexOf('return input.withLock(');
  const loadAt = revokeSource.indexOf('input.loadPayloads(');
  const revokeAt = revokeSource.indexOf('input.revoke(');
  const deleteAt = revokeSource.indexOf('input.deleteData(');
  assert.ok(section >= 0 && section < loadAt && loadAt < revokeAt && revokeAt < deleteAt);
});
