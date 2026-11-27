import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { ACCOUNT_DELETED_ERROR, withLiveOwner } from './live-owner.ts';
import { withOwnerWork } from './owner-work.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const OWNER_WRITERS = [
  'storeBookmarks',
  'storeFollows',
  'storeAiTopics',
  'storeScouts',
  'storeFeed',
  'saveShare',
  'saveTrajectory',
  'deleteTrajectory',
  'saveResearchCard',
  'deleteResearchCard',
  'reserveResearchRequest',
  'reserveBridgeRequest',
  'saveJevTopics',
  'applyJevLabels',
  'labelPendingBookmarks',
];

const ALLOWLIST = ['lib/background-sync.ts'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === 'dist') continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(path);
  }
  return out;
}

function skipString(source: string, index: number) {
  const quote = source[index];
  let cursor = index + 1;
  while (cursor < source.length) {
    if (source[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (source[cursor] === quote) return cursor;
    cursor += 1;
  }
  return source.length - 1;
}

function enclosedByCall(source: string, callName: string, index: number) {
  const needle = `${callName}(`;
  let from = 0;
  while (from < index) {
    const at = source.indexOf(needle, from);
    if (at < 0 || at >= index) return false;
    let depth = 1;
    let cursor = at + needle.length;
    let closed = false;
    while (cursor < index) {
      const ch = source[cursor];
      if (ch === "'" || ch === '"' || ch === '`') {
        cursor = skipString(source, cursor) + 1;
        continue;
      }
      if (ch === '(') depth += 1;
      else if (ch === ')') {
        depth -= 1;
        if (depth === 0) {
          closed = true;
          break;
        }
      }
      cursor += 1;
    }
    if (!closed && depth > 0) return true;
    from = at + needle.length;
  }
  return false;
}

function writerCalls(source: string) {
  const calls: { name: string; index: number }[] = [];
  for (const name of OWNER_WRITERS) {
    for (const match of source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      const index = match.index ?? 0;
      const lineStart = source.lastIndexOf('\n', index) + 1;
      if (/\bfunction\s+$/.test(source.slice(lineStart, index))) continue;
      calls.push({ name, index });
    }
  }
  return calls;
}

test('a write queued while deletion holds the lock is skipped once the session is gone', async () => {
  const ownerId = 'owner-queued-during-delete';
  let sessions = 1;
  const rows = ['kept'];
  const log: string[] = [];
  let release!: () => void;
  const hold = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const deletion = withOwnerWork(ownerId, async () => {
    log.push('delete-enter');
    entered();
    await hold;
    sessions = 0;
    rows.length = 0;
    log.push('delete-exit');
  });
  await inside;
  const write = withLiveOwner(ownerId, async () => {
    log.push('write');
    rows.push('bookmark');
    return 'stored';
  }, {
    withLock: withOwnerWork,
    hasSession: async () => {
      log.push('check');
      return sessions > 0;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(log, ['delete-enter']);
  assert.deepEqual(rows, ['kept']);
  release();
  const outcome = await write;
  await deletion;
  assert.deepEqual(outcome, { live: false, error: ACCOUNT_DELETED_ERROR });
  assert.deepEqual(rows, []);
  assert.deepEqual(log, ['delete-enter', 'delete-exit', 'check']);
});

test('a write that commits before deletion is removed with the account', async () => {
  const ownerId = 'owner-write-then-delete';
  let sessions = 1;
  const rows: string[] = [];
  const outcome = await withLiveOwner(ownerId, async () => {
    rows.push('bookmark');
    return 'stored';
  }, {
    withLock: withOwnerWork,
    hasSession: async () => sessions > 0,
  });
  assert.deepEqual(outcome, { live: true, value: 'stored' });
  assert.deepEqual(rows, ['bookmark']);
  await withOwnerWork(ownerId, async () => {
    sessions = 0;
    rows.length = 0;
  });
  assert.equal(sessions, 0);
  assert.deepEqual(rows, []);
  const later = await withLiveOwner(ownerId, async () => {
    rows.push('again');
    return 'again';
  }, {
    withLock: withOwnerWork,
    hasSession: async () => sessions > 0,
  });
  assert.deepEqual(later, { live: false, error: ACCOUNT_DELETED_ERROR });
  assert.deepEqual(rows, []);
});

test('route owner writes go through withLiveOwner and the poller is the allowlisted exception', () => {
  assert.deepEqual(ALLOWLIST, ['lib/background-sync.ts']);
  const files = [...walk(join(root, 'app')), ...walk(join(root, 'lib'))];
  const unguarded: string[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const rel = relative(root, file);
    const source = readFileSync(file, 'utf8');
    const calls = writerCalls(source);
    if (calls.length === 0) continue;
    seen.add(rel);
    if (ALLOWLIST.includes(rel)) continue;
    for (const call of calls) {
      if (!enclosedByCall(source, 'withLiveOwner', call.index)) {
        const line = source.slice(0, call.index).split('\n').length;
        unguarded.push(`${rel}:${line} ${call.name}`);
      }
    }
  }
  assert.deepEqual(unguarded, []);
  for (const rel of ALLOWLIST) assert.ok(seen.has(rel), rel);
  const poller = readFileSync(join(root, 'lib/background-sync.ts'), 'utf8');
  assert.equal(poller.includes('withLiveOwner'), false);
  assert.match(poller, /storeBookmarks\(/);
  assert.match(poller, /labelPendingBookmarks\(/);
  assert.equal(poller.includes('labelAfterSync'), false);
  const sync = readFileSync(join(root, 'app/api/bookmarks/sync/route.ts'), 'utf8');
  for (const name of ['fetchXBookmarks', 'iterateXBookmarks', 'fetchXFollowing']) {
    const at = sync.indexOf(`${name}(`);
    assert.ok(at >= 0, name);
    assert.equal(enclosedByCall(sync, 'withLiveOwner', at), false, name);
  }
  const jev = readFileSync(join(root, 'lib/jev-sync.ts'), 'utf8');
  const prepareAt = jev.indexOf('prepareJevLabels(');
  const applyAt = jev.indexOf('applyJevLabels(');
  assert.ok(prepareAt >= 0 && applyAt > prepareAt);
  assert.equal(enclosedByCall(jev, 'withLiveOwner', prepareAt), false);
  assert.equal(enclosedByCall(jev, 'withLiveOwner', applyAt), true);
});
