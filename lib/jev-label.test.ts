import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { labelRouteBookmarks } from './jev-label.ts';
import { ACCOUNT_DELETED_ERROR, withLiveOwner } from './live-owner.ts';
import { withOwnerWork } from './owner-work.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('route labeling checks the owner before TypeSafe and still guards the write', async () => {
  const skipped: string[] = [];
  const dead = await labelRouteBookmarks('owner-jev-dead', {
    hasSession: async () => {
      skipped.push('session');
      return false;
    },
    prepare: async () => {
      skipped.push('typesafe');
      return 'bookmark text';
    },
    write: async () => {
      skipped.push('write');
      return { live: true as const, value: 'stored' };
    },
  });
  assert.deepEqual(dead, { live: false, error: ACCOUNT_DELETED_ERROR });
  assert.deepEqual(skipped, ['session']);

  const liveCalls: string[] = [];
  const live = await labelRouteBookmarks('owner-jev-live', {
    hasSession: async () => {
      liveCalls.push('session');
      return true;
    },
    prepare: async () => {
      liveCalls.push('typesafe');
      return 'bookmark text';
    },
    write: (prepared) => withLiveOwner('owner-jev-live', async () => {
      liveCalls.push('write');
      return prepared;
    }, {
      withLock: async (ownerId, action) => {
        liveCalls.push('guard');
        return withOwnerWork(ownerId, action);
      },
      hasSession: async () => {
        liveCalls.push('guard-check');
        return true;
      },
    }),
  });
  assert.deepEqual(live, { live: true, value: 'bookmark text' });
  assert.deepEqual(liveCalls, ['session', 'typesafe', 'guard', 'guard-check', 'write']);

  let sessions = 1;
  const raced: string[] = [];
  const lost = await labelRouteBookmarks('owner-jev-raced', {
    hasSession: async () => {
      raced.push('session');
      return sessions > 0;
    },
    prepare: async () => {
      raced.push('typesafe');
      sessions = 0;
      return 'bookmark text';
    },
    write: (prepared) => withLiveOwner('owner-jev-raced', async () => {
      raced.push('write');
      return prepared;
    }, {
      withLock: withOwnerWork,
      hasSession: async () => sessions > 0,
    }),
  });
  assert.deepEqual(lost, { live: false, error: ACCOUNT_DELETED_ERROR });
  assert.deepEqual(raced, ['session', 'typesafe']);

  const route = readFileSync(join(root, 'app/api/jev/route.ts'), 'utf8');
  const post = route.slice(route.indexOf('export async function POST'));
  assert.ok(post.indexOf('ownerHasSession') < post.indexOf('prepareJevLabels('));
  assert.ok(post.indexOf('prepareJevLabels(') < post.indexOf('withLiveOwner('));
  const sync = readFileSync(join(root, 'lib/jev-sync.ts'), 'utf8');
  const body = sync.slice(sync.indexOf('export async function labelAfterSync'));
  assert.ok(body.indexOf('ownerHasSession') < body.indexOf('prepareJevLabels('));
  assert.ok(body.indexOf('prepareJevLabels(') < body.indexOf('withLiveOwner('));
  const poller = readFileSync(join(root, 'lib/background-sync.ts'), 'utf8');
  assert.equal(poller.includes('labelRouteBookmarks'), false);
  assert.equal(poller.includes('ownerHasSession'), false);
  assert.match(poller, /labelPendingBookmarks\(/);
});
