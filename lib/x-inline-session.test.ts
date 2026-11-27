import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { renewedSessionCookieWrites } from './session-cookie.ts';
import { resolvePresentedXSession } from './x-session-resolve.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function functionBody(source: string, name: string) {
  const match = source.match(new RegExp(`(?:export )?async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, name);
  return match[0];
}

test('a dotted session cookie is not a session and touches no storage', async () => {
  const calls: string[] = [];
  const boom = (name: string) => async () => {
    calls.push(name);
    throw new Error(name);
  };
  for (const cookie of ['iv.ciphertext', 'v2.iv.ciphertext', '.']) {
    const result = await resolvePresentedXSession({
      cookie,
      keyUsable: true,
      loadStored: boom('load'),
      openInline: boom('open'),
      persistInline: boom('persist'),
      refreshInline: boom('refresh'),
    });
    assert.equal(result, null, cookie);
  }
  const withoutKey = await resolvePresentedXSession({
    cookie: 'opaque-id',
    keyUsable: false,
    loadStored: boom('load'),
    openInline: boom('open'),
    persistInline: boom('persist'),
    refreshInline: boom('refresh'),
  });
  assert.equal(withoutKey, null);
  assert.equal(await resolvePresentedXSession({
    cookie: undefined,
    keyUsable: true,
    loadStored: boom('load'),
  }), null);
  assert.deepEqual(calls, []);
});

test('an opaque session id still loads the stored session and does not open the cookie', async () => {
  const calls: string[] = [];
  const stored = { session: { accessToken: 'inert-access' }, renewedCookie: 'fixture-session' };
  const boom = (name: string) => async () => {
    calls.push(name);
    throw new Error(name);
  };
  const result = await resolvePresentedXSession({
    cookie: 'fixture-session',
    keyUsable: true,
    loadStored: async (id) => {
      calls.push(`load:${id}`);
      return stored;
    },
    openInline: boom('open'),
    persistInline: boom('persist'),
    refreshInline: boom('refresh'),
  });
  assert.equal(result, stored);
  assert.deepEqual(calls, ['load:fixture-session']);
});

test('a dotted presented cookie expires both session cookie names and an opaque id still renews', () => {
  assert.deepEqual(renewedSessionCookieWrites({
    secure: true,
    maxAge: 100,
    presentedValue: 'iv.ciphertext',
    renewedValue: 'iv.ciphertext',
    legacyAccepted: true,
    legacyValue: 'iv.ciphertext',
  }), [
    { name: 'stim_x_session', value: '', maxAge: 0, secure: true },
    { name: '__Host-stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  assert.deepEqual(renewedSessionCookieWrites({
    secure: false,
    maxAge: 100,
    presentedValue: 'v2.iv.ciphertext',
  }), [
    { name: 'stim_x_session', value: '', maxAge: 0, secure: false },
    { name: '__Host-stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  assert.deepEqual(renewedSessionCookieWrites({
    secure: true,
    maxAge: 100,
    presentedValue: 'fixture-session',
    renewedValue: 'fixture-session',
  }), [
    { name: '__Host-stim_x_session', value: 'fixture-session', maxAge: 100, secure: true },
  ]);
  assert.deepEqual(renewedSessionCookieWrites({
    secure: false,
    maxAge: 100,
    presentedValue: 'fixture-session',
    renewedValue: 'fixture-session',
    legacyAccepted: true,
    legacyValue: 'fixture-session',
  }), [
    { name: 'stim_x_session', value: 'fixture-session', maxAge: 100, secure: false },
  ]);
});

test('status clears a dotted cookie, and no cookie path can insert a session row', () => {
  const server = readFileSync(join(root, 'lib/x-auth-server.ts'), 'utf8');
  const active = functionBody(server, 'getActiveXSession');
  assert.match(active, /resolvePresentedXSession/);
  assert.match(active, /getStoredXSession\(id\)/);
  assert.doesNotMatch(active, /openXSession|persistSession|replaceXSessionRecord|refreshStoredSession|sealXSession|includes\('\.'\)/);
  const persist = functionBody(server, 'persistSession');
  assert.match(persist, /async function persistSession\(session: XSession, sessionId: string\)/);
  assert.match(persist, /saveXSessionRecord\(sessionId,/);
  assert.doesNotMatch(persist, /replaceXSessionRecord|randomBase64Url|sessionId\?:/);
  assert.equal(server.includes('replaceXSessionRecord'), false);
  assert.equal(server.includes('randomBase64Url'), false);
  assert.match(server, /presentedValue: read\.value/);
  const status = readFileSync(join(root, 'app/api/auth/x/status/route.ts'), 'utf8');
  assert.match(status, /presented\?\.includes\('\.'\)/);
  assert.match(status, /withRenewedSession\(response, request, active\?\.renewedCookie\)/);
  assert.equal(status.includes('if (!active) return NextResponse.json'), false);
  const owner = readFileSync(join(root, 'lib/owner-request.ts'), 'utf8');
  assert.match(owner, /if \(cookie && !cookie\.includes\('\.'\)\)/);
  const disconnect = readFileSync(join(root, 'app/api/auth/x/disconnect/route.ts'), 'utf8');
  assert.match(disconnect, /disconnectPresentedSession\(/);
  assert.match(disconnect, /clearSessionCookie/);
  assert.equal(disconnect.includes('deleteXSessionRecord(cookie)'), false);
  const helper = readFileSync(join(root, 'lib/disconnect-session.ts'), 'utf8');
  assert.match(helper, /includes\('\.'\)/);
  const lockAt = helper.indexOf('input.withLock(');
  const openAt = helper.indexOf('input.openPayload(', lockAt);
  const revokeAt = helper.indexOf('input.revoke(', lockAt);
  const deleteAt = helper.indexOf('input.deleteRow(', lockAt);
  assert.ok(lockAt >= 0 && lockAt < openAt && openAt < revokeAt && revokeAt < deleteAt);
  const data = readFileSync(join(root, 'app/api/data/route.ts'), 'utf8');
  assert.match(data, /cookieValue && !cookieValue\.includes\('\.'\)/);
});
