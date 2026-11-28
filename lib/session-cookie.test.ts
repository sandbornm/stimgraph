import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  cookieParentDomain,
  cookieWriteOptions,
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

test('https reads only __Host- cookies and http loopback reads only unprefixed names', () => {
  const both = jar({
    '__Host-stim_x_session': 'current',
    stim_x_session: 'legacy',
    '__Host-stim_x_oauth_state': 'state-current',
    stim_x_oauth_state: 'state-legacy',
  });
  assert.equal(readSessionCookie(jar({ stim_x_session: 'legacy' }), true), undefined);
  assert.equal(readStateCookie(jar({ stim_x_oauth_state: 'legacy' }), true), undefined);
  assert.equal(readSessionCookie(both, true), 'current');
  assert.equal(readStateCookie(both, true), 'state-current');
  assert.equal(readSessionCookie(jar({ '__Host-stim_x_session': 'current' }), false), undefined);
  assert.equal(readStateCookie(jar({ '__Host-stim_x_oauth_state': 'state-current' }), false), undefined);
  assert.equal(readSessionCookie(both, false), 'legacy');
  assert.equal(readStateCookie(both, false), 'state-legacy');
  assert.equal(readSessionCookie(jar({}), true), undefined);
  assert.equal(readStateCookie(jar({}), false), undefined);
});

test('http loopback writes the unprefixed name and https writes only __Host-', () => {
  assert.deepEqual(sessionCookieWrites({
    secure: false,
    maxAge: 100,
    renewedValue: 'id',
    clear: false,
  }), [
    { name: 'stim_x_session', value: 'id', maxAge: 100, secure: false },
  ]);
  assert.deepEqual(sessionCookieWrites({
    secure: true,
    maxAge: 100,
    renewedValue: 'id',
    clear: false,
  }), [
    { name: '__Host-stim_x_session', value: 'id', maxAge: 100, secure: true },
  ]);
  assert.deepEqual(sessionCookieWrites({ secure: true, maxAge: 100, clear: false }), []);
  assert.equal(readFileSync(join(root, 'lib/session-cookie.ts'), 'utf8').includes('legacyAccepted'), false);
  assert.equal(readFileSync(join(root, 'lib/x-auth-server.ts'), 'utf8').includes('legacyAccepted'), false);
});

test('clear writes on a tailnet host expire the parent domain for unprefixed names only', () => {
  const host = 'stimgraph.mytailnet.ts.net';
  const session = sessionCookieWrites({ secure: true, maxAge: 100, clear: true, hostname: host });
  const state = stateCookieClearWrites(true, host);
  assert.deepEqual(session, [
    { name: 'stim_x_session', value: '', maxAge: 0, secure: true },
    { name: 'stim_x_session', value: '', maxAge: 0, secure: true, domain: 'mytailnet.ts.net' },
    { name: '__Host-stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  assert.deepEqual(state, [
    { name: 'stim_x_oauth_state', value: '', maxAge: 0, secure: true },
    { name: 'stim_x_oauth_state', value: '', maxAge: 0, secure: true, domain: 'mytailnet.ts.net' },
    { name: '__Host-stim_x_oauth_state', value: '', maxAge: 0, secure: true },
  ]);
  for (const write of [...session, ...state, ...sessionCookieWrites({
    secure: true,
    maxAge: 100,
    renewedValue: 'id',
    clear: false,
  })]) {
    if (write.name.startsWith('__Host-')) assert.equal(Object.hasOwn(write, 'domain'), false, write.name);
  }
  assert.deepEqual(sessionCookieWrites({ secure: false, maxAge: 100, clear: true, hostname: 'localhost' }), [
    { name: 'stim_x_session', value: '', maxAge: 0, secure: false },
    { name: '__Host-stim_x_session', value: '', maxAge: 0, secure: true },
  ]);
  assert.deepEqual(stateCookieClearWrites(false), [
    { name: 'stim_x_oauth_state', value: '', maxAge: 0, secure: false },
    { name: '__Host-stim_x_oauth_state', value: '', maxAge: 0, secure: true },
  ]);
  for (const write of stateCookieClearWrites(true)) assert.equal(Object.hasOwn(write, 'domain'), false);
  assert.equal(Object.hasOwn(cookieWriteOptions({
    name: '__Host-stim_x_session',
    value: '',
    maxAge: 0,
    secure: true,
    domain: 'mytailnet.ts.net',
  }), 'domain'), false);
  assert.deepEqual(cookieWriteOptions({
    name: 'stim_x_session',
    value: '',
    maxAge: 0,
    secure: true,
    domain: 'mytailnet.ts.net',
  }), { secure: true, maxAge: 0, domain: 'mytailnet.ts.net' });
  assert.equal(Object.hasOwn(cookieWriteOptions({
    name: 'stim_x_session',
    value: 'id',
    maxAge: 100,
    secure: false,
  }), 'domain'), false);
});

test('cookieParentDomain returns a parent only for a multi-label hostname', () => {
  assert.equal(cookieParentDomain('localhost'), undefined);
  assert.equal(cookieParentDomain('LOCALHOST'), undefined);
  assert.equal(cookieParentDomain('127.0.0.1'), undefined);
  assert.equal(cookieParentDomain('192.168.0.1'), undefined);
  assert.equal(cookieParentDomain('::1'), undefined);
  assert.equal(cookieParentDomain('[::1]'), undefined);
  assert.equal(cookieParentDomain('2001:db8::1'), undefined);
  assert.equal(cookieParentDomain('example.com'), undefined);
  assert.equal(cookieParentDomain('stimgraph.example'), undefined);
  assert.equal(cookieParentDomain('a.b.c'), 'b.c');
  assert.equal(cookieParentDomain('stimgraph.mytailnet.ts.net'), 'mytailnet.ts.net');
  assert.equal(cookieParentDomain('Stimgraph.MyTailnet.ts.net'), 'mytailnet.ts.net');
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
  assert.equal(server.match(/readSessionCookie\(request\.cookies, options\.secure\)/g)?.length, 2);
  assert.match(server, /cookieWriteOptions\(write\)/);
  assert.equal(server.includes('domain: write.domain'), false);
  assert.match(server, /hostname: hostnameFromOrigin\(requestOrigin\(request\)\)/);
  assert.match(server, /stateCookieClearWrites\(\s*options\.secure,\s*hostnameFromOrigin\(requestOrigin\(request\)\),?\s*\)/);
  const reads = [
    ['app/api/auth/x/callback/route.ts', /readStateCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/g, 1],
    ['app/api/auth/x/disconnect/route.ts', /readSessionCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/g, 1],
    ['app/api/auth/x/status/route.ts', /readSessionCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/g, 1],
    ['app/api/data/route.ts', /readSessionCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/g, 2],
    ['lib/owner-request.ts', /readSessionCookie\(request\.cookies, sessionCookieSecure\(requestOrigin\(request\)\)\)/g, 1],
  ] as const;
  for (const [file, pattern, count] of reads) {
    assert.equal(readFileSync(join(root, file), 'utf8').match(pattern)?.length, count, file);
  }
});
