import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionCookieAttributes } from './session-cookie.ts';

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
