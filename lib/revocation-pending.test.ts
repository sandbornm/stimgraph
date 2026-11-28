import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { presentedRevocationPending } from './revocation-pending.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('revocation stays pending only while an expired presented row still has a payload', () => {
  const now = 10;
  assert.equal(presentedRevocationPending({
    connected: false,
    row: { payload: 'sealed-expired', expiresAt: 0 },
    now,
  }), true);
  assert.equal(presentedRevocationPending({
    connected: false,
    row: { payload: 'sealed-expired', expiresAt: now },
    now,
  }), true);
  assert.equal(presentedRevocationPending({
    connected: true,
    row: { payload: 'sealed-expired', expiresAt: 0 },
    now,
  }), false);
  assert.equal(presentedRevocationPending({ connected: false, row: null, now }), false);
  assert.equal(presentedRevocationPending({
    connected: false,
    row: { payload: '', expiresAt: 0 },
    now,
  }), false);
  assert.equal(presentedRevocationPending({
    connected: false,
    row: { payload: 'sealed-live', expiresAt: now + 1 },
    now,
  }), false);

  const status = readFileSync(join(root, 'app/api/auth/x/status/route.ts'), 'utf8');
  assert.match(status, /readSessionCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/);
  assert.match(status, /presentedRevocationPending\(/);
  assert.match(status, /revocationPending: true/);
  assert.equal(status.includes('stim_x_session'), false);
  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const disconnect = page.slice(page.indexOf('const disconnect = async'), page.indexOf('const deleteAccount = async'));
  assert.match(disconnect, /payload\?\.revoked === false/);
  assert.match(disconnect, /revocationPending: true/);
  assert.match(page, /connection\.revocationPending \? \(/);
  assert.match(page, />Retry</);
  assert.match(page, /X did not confirm revoking access/);
  assert.match(page, /Stimgraph will keep trying/);
  assert.match(page, /Security and account access > Apps and sessions/);
});
