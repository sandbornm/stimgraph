import assert from 'node:assert/strict';
import test from 'node:test';
import { xAuthConfigured } from './x-auth-config.ts';
import { resolveStoredXSession } from './x-session-resolve.ts';
import { tokenKeyUsable } from './x-session-seal.ts';

const validKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function read(values: Record<string, string | undefined>) {
  return (name: string) => values[name];
}

test('a token key is usable only when it is present and decodes to 32 bytes', () => {
  assert.equal(tokenKeyUsable(read({})), false);
  assert.equal(tokenKeyUsable(read({ STIMGRAPH_TOKEN_KEY: '' })), false);
  assert.equal(tokenKeyUsable(read({ STIMGRAPH_TOKEN_KEY: 'abcd' })), false);
  assert.equal(tokenKeyUsable(read({ STIMGRAPH_TOKEN_KEY: 'not a key' })), false);
  assert.equal(tokenKeyUsable(read({ STIMGRAPH_TOKEN_KEY: validKey })), true);
});

test('x auth is not configured when the token key is missing or invalid', () => {
  const configured = {
    X_CLIENT_ID: 'stimgraph-inert-test',
    X_CLIENT_SECRET: 'stimgraph-inert-test-secret',
    X_REDIRECT_URI: 'http://127.0.0.1:3012/api/auth/x/callback',
    STIMGRAPH_TOKEN_KEY: validKey,
  };
  assert.equal(xAuthConfigured(read(configured)), true);
  assert.equal(xAuthConfigured(read({ ...configured, STIMGRAPH_TOKEN_KEY: undefined })), false);
  assert.equal(xAuthConfigured(read({ ...configured, STIMGRAPH_TOKEN_KEY: 'abcd' })), false);
});

test('a session read with a missing or invalid key returns null and does not touch the row', async () => {
  const untouched = async () => {
    throw new Error('stored session was touched');
  };
  const result = await resolveStoredXSession({
    id: 'sid',
    lockHeld: false,
    now: 0,
    keyUsable: false,
    load: untouched,
    open: untouched,
    withLock: untouched,
    migrate: untouched,
    refresh: untouched,
  });
  assert.equal(result, null);
});
