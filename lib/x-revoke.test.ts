import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyRevocation, requestTokenRevocation, revokeTokenPair } from './x-revoke.ts';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function revoke(fetchImpl: typeof fetch) {
  return requestTokenRevocation({
    token: 'inert-token',
    tokenTypeHint: 'refresh_token',
    authorization: 'Basic inert',
    fetchImpl,
  });
}

test('a 2xx JSON body is revoked, including revoked false, and a dead token status is revoked', () => {
  assert.equal(classifyRevocation(200, JSON.stringify({ revoked: true })), 'revoked');
  assert.equal(classifyRevocation(200, JSON.stringify({ revoked: false })), 'revoked');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_token' })), 'revoked');
  assert.equal(classifyRevocation(401, ''), 'revoked');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_request' })), 'revoked');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_grant' })), 'revoked');
});

test('non-JSON success, 429, 5xx, and a thrown fetch are failures and nothing is logged', async () => {
  const logged: string[] = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const previous = originals.map((name) => console[name]);
  for (const name of originals) {
    console[name] = ((...args: unknown[]) => {
      logged.push(args.map((part) => String(part)).join(' '));
    }) as typeof console.log;
  }
  try {
    assert.equal(await revoke(async () => jsonResponse(200, { revoked: true })), 'revoked');
    assert.equal(await revoke(async () => jsonResponse(200, { revoked: false })), 'revoked');
    assert.equal(await revoke(async () => jsonResponse(400, { error: 'invalid_token' })), 'revoked');
    assert.equal(await revoke(async () => new Response('', { status: 401 })), 'revoked');
    assert.equal(await revoke(async () => new Response('<html>proxy</html>', { status: 200 })), 'failed');
    assert.equal(await revoke(async () => new Response('not-json', { status: 200 })), 'failed');
    assert.equal(await revoke(async () => jsonResponse(503, {})), 'failed');
    assert.equal(await revoke(async () => jsonResponse(429, { error: 'rate_limit' })), 'failed');
    assert.equal(await revoke(async () => { throw new Error('network timeout'); }), 'failed');
  } finally {
    originals.forEach((name, index) => {
      console[name] = previous[index] as typeof console.log;
    });
  }
  assert.deepEqual(logged, []);
});

test('a session is revoked when the refresh call succeeds and the access token is already invalid', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const hint = new URLSearchParams(String(init?.body ?? '')).get('token_type_hint') ?? '';
    calls.push(hint);
    if (hint === 'refresh_token') return jsonResponse(200, { revoked: true });
    return jsonResponse(400, { error: 'invalid_token' });
  };
  assert.equal(await revokeTokenPair({
    accessToken: 'inert-access',
    refreshToken: 'inert-refresh',
    authorization: 'Basic inert',
    fetchImpl,
  }), true);
  assert.deepEqual(calls, ['refresh_token', 'access_token']);
});

test('a session is not revoked when the refresh call fails', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const hint = new URLSearchParams(String(init?.body ?? '')).get('token_type_hint') ?? '';
    calls.push(hint);
    if (hint === 'refresh_token') return jsonResponse(503, {});
    return jsonResponse(200, { revoked: true });
  };
  assert.equal(await revokeTokenPair({
    accessToken: 'inert-access',
    refreshToken: 'inert-refresh',
    authorization: 'Basic inert',
    fetchImpl,
  }), false);
  assert.deepEqual(calls, ['refresh_token', 'access_token']);
});
