import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { finishExchangedGrant } from './callback-grant.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('a grant obtained from X is stored, revoked, or recorded for retry after a later failure', async () => {
  const session = { accessToken: 'access', refreshToken: 'refresh' };

  const stored = await finishExchangedGrant({
    session,
    finish: async () => 'stored',
    revoke: async () => {
      throw new Error('revoke');
    },
    recordPending: async () => {
      throw new Error('record');
    },
  });
  assert.equal(stored, 'stored');

  const revoked: string[] = [];
  const rejectedRevoked = await finishExchangedGrant({
    session,
    finish: async () => 'rejected',
    revoke: async (current) => {
      revoked.push(current.refreshToken ?? '');
      return true;
    },
    recordPending: async () => {
      throw new Error('record');
    },
  });
  assert.equal(rejectedRevoked, 'rejected');
  assert.deepEqual(revoked, ['refresh']);

  const pending: string[] = [];
  const rejectedKept = await finishExchangedGrant({
    session,
    finish: async () => 'rejected',
    revoke: async () => false,
    recordPending: async (current) => {
      pending.push(current.refreshToken ?? '');
    },
  });
  assert.equal(rejectedKept, 'rejected');
  assert.deepEqual(pending, ['refresh']);

  const failedKept: string[] = [];
  const failed = await finishExchangedGrant({
    session,
    finish: async () => {
      throw new Error('profile');
    },
    revoke: async () => {
      throw new Error('x down');
    },
    recordPending: async (current) => {
      failedKept.push(current.refreshToken ?? '');
    },
  });
  assert.equal(failed, 'failed');
  assert.deepEqual(failedKept, ['refresh']);

  const route = readFileSync(join(root, 'app/api/auth/x/callback/route.ts'), 'utf8');
  const getter = route.slice(route.indexOf('export async function GET'));
  assert.ok(getter.indexOf('exchangeAuthorizationCode') < getter.indexOf('finishExchangedGrant'));
  assert.match(getter, /finishExchangedGrant\(/);
  assert.match(getter, /recordPendingGrant\(/);
  assert.match(getter, /revokeXSession/);
});
