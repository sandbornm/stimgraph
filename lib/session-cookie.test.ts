import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  readSessionCookie,
  readStateCookie,
  sessionCookieAttributes,
  sessionCookieName,
  sessionCookieSecure,
  sessionCookieWrites,
  stateCookieClearWrites,
  stateCookieName,
  stateCookieSet,
} from './session-cookie.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function jar(values: Record<string, string | undefined>) {
  return {
    get(name: string) {
      const value = values[name];
      return value === undefined ? undefined : { value };
    },
  };
}

function expectSecure(origin: string, secure: boolean) {
  const attributes = sessionCookieAttributes(origin, 60);
  assert.equal(attributes.httpOnly, true, origin);
  assert.equal(attributes.sameSite, 'lax', origin);
  assert.equal(attributes.path, '/', origin);
  assert.equal(attributes.secure, secure, origin);
}

test('session cookies are Secure except plain http on loopback', () => {
  expectSecure('https://example.com', true);
  expectSecure('https://localhost', true);
  expectSecure('https://127.0.0.1:3001', true);
  expectSecure('https://[::1]', true);
  expectSecure('http://example.com', true);
  expectSecure('http://stimgraph.example:3001', true);
  expectSecure('http://localhost', false);
  expectSecure('http://localhost:3001', false);
  expectSecure('http://127.0.0.1', false);
  expectSecure('http://127.0.0.1:3012', false);
  expectSecure('http://[::1]', false);
  expectSecure('http://[::1]:3012', false);
  expectSecure('not a url', true);
});

test('secure cookies use the __Host- prefix with Path=/ and no Domain', () => {
  for (const origin of ['https://example.com', 'https://localhost', 'https://127.0.0.1:3001', 'https://[::1]', 'http://example.com', 'http://stimgraph.example:3001']) {
    assert.equal(sessionCookieSecure(origin), true, origin);
    assert.equal(sessionCookieName(true), '__Host-stim_x_session', origin);
    assert.equal(stateCookieName(true), '__Host-stim_x_oauth_state', origin);
    const attributes = sessionCookieAttributes(origin, 600);
    assert.equal(attributes.secure, true, origin);
    assert.equal(attributes.path, '/', origin);
    assert.equal(attributes.httpOnly, true, origin);
    assert.equal(attributes.sameSite, 'lax', origin);
    assert.equal(Object.hasOwn(attributes, 'domain'), false, origin);
  }
  assert.deepEqual(stateCookieSet(true), { name: '__Host-stim_x_oauth_state', maxAge: 600, secure: true });
});

test('plain http loopback keeps unprefixed session and state cookie names', () => {
  for (const origin of ['http://localhost', 'http://localhost:3001', 'http://127.0.0.1', 'http://127.0.0.1:3012', 'http://[::1]', 'http://[::1]:3012']) {
    assert.equal(sessionCookieSecure(origin), false, origin);
    assert.equal(sessionCookieName(false), 'stim_x_session', origin);
    assert.equal(stateCookieName(false), 'stim_x_oauth_state', origin);
    const attributes = sessionCookieAttributes(origin, 600);
    assert.equal(attributes.secure, false, origin);
    assert.equal(attributes.path, '/', origin);
    assert.equal(Object.hasOwn(attributes, 'domain'), false, origin);
  }
  assert.deepEqual(stateCookieSet(false), { name: 'stim_x_oauth_state', maxAge: 600, secure: false });
});

test('session cookie reads prefer the __Host- name and flag a legacy cookie', () => {
  assert.deepEqual(readSessionCookie(jar({
    '__Host-stim_x_session': 'current',
    stim_x_session: 'legacy',
  })), { value: 'current', legacy: false });
  assert.deepEqual(readSessionCookie(jar({ stim_x_session: 'legacy' })), { value: 'legacy', legacy: true });
  assert.deepEqual(readSessionCookie(jar({})), { value: undefined, legacy: false });
  assert.equal(readStateCookie(jar({
    '__Host-stim_x_oauth_state': 'current',
    stim_x_oauth_state: 'legacy',
  })), 'current');
  assert.equal(readStateCookie(jar({ stim_x_oauth_state: 'legacy' })), 'legacy');
  assert.equal(readStateCookie(jar({})), undefined);
});

test('a legacy session cookie is reissued under __Host- and the old name expires', () => {
  assert.deepEqual(sessionCookieWrites({
    secure: true,
    maxAge: 100,
    legacyAccepted: true,
    legacyValue: 'old-id',
    clear: false,
  }), [
    { name: '__Host-stim_x_session', value: 'old-id', maxAge: 100, secure: true },
    { name: 'stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  assert.deepEqual(sessionCookieWrites({
    secure: true,
    maxAge: 100,
    renewedValue: 'new-id',
    legacyAccepted: true,
    legacyValue: 'old-id',
    clear: false,
  })[0], { name: '__Host-stim_x_session', value: 'new-id', maxAge: 100, secure: true });
  assert.deepEqual(sessionCookieWrites({
    secure: false,
    maxAge: 100,
    renewedValue: 'id',
    legacyAccepted: true,
    legacyValue: 'id',
    clear: false,
  }), [
    { name: 'stim_x_session', value: 'id', maxAge: 100, secure: false },
  ]);
  assert.deepEqual(sessionCookieWrites({ secure: false, maxAge: 100, clear: true }), [
    { name: 'stim_x_session', value: '', maxAge: 0, secure: false },
    { name: '__Host-stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  for (const write of stateCookieClearWrites(true)) assert.equal(Object.hasOwn(write, 'domain'), false);
  assert.deepEqual(stateCookieClearWrites(false), [
    { name: 'stim_x_oauth_state', value: '', maxAge: 0, secure: false },
    { name: '__Host-stim_x_oauth_state', value: '', maxAge: 0, secure: true },
  ]);
});

test('session and state cookies are read and cleared through the shared helpers', () => {
  const callback = readFileSync(join(root, 'app/api/auth/x/callback/route.ts'), 'utf8');
  const getter = callback.slice(callback.indexOf('export async function GET'));
  assert.equal(getter.includes('return NextResponse'), false);
  assert.match(callback, /clearOauthStateCookie/);
  assert.match(callback, /readStateCookie/);
  const start = readFileSync(join(root, 'app/api/auth/x/start/route.ts'), 'utf8');
  assert.match(start, /assignStateCookie/);
  assert.equal(start.includes('X_STATE_COOKIE'), false);
  const disconnect = readFileSync(join(root, 'app/api/auth/x/disconnect/route.ts'), 'utf8');
  assert.match(disconnect, /readSessionCookie/);
  const owner = readFileSync(join(root, 'lib/owner-request.ts'), 'utf8');
  assert.match(owner, /readSessionCookie/);
  assert.equal(owner.includes('X_SESSION_COOKIE'), false);
  const server = readFileSync(join(root, 'lib/x-auth-server.ts'), 'utf8');
  assert.match(server, /readSessionCookie/);
});
