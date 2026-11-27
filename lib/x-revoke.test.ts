import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { accountDeletionDecision, REVOKE_UNCONFIRMED_ERROR } from './delete-account.ts';
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

test('a call is revoked only for a confirming 2xx JSON body or HTTP 400 invalid_token', () => {
  assert.equal(classifyRevocation(401, ''), 'failed');
  assert.equal(classifyRevocation(401, JSON.stringify({ error: 'invalid_token' })), 'failed');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_request' })), 'failed');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'unsupported_token_type' })), 'failed');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_grant' })), 'failed');
  assert.equal(classifyRevocation(400, ''), 'failed');
  assert.equal(classifyRevocation(200, JSON.stringify({ revoked: false })), 'failed');
  assert.equal(classifyRevocation(200, ''), 'failed');
  assert.equal(classifyRevocation(200, 'not-json'), 'failed');
  assert.equal(classifyRevocation(200, '<html>proxy</html>'), 'failed');
  assert.equal(classifyRevocation(429, JSON.stringify({ error: 'rate_limit' })), 'failed');
  assert.equal(classifyRevocation(503, JSON.stringify({})), 'failed');
  assert.equal(classifyRevocation(400, JSON.stringify({ error: 'invalid_token' })), 'revoked');
  assert.equal(classifyRevocation(200, JSON.stringify({})), 'revoked');
  assert.equal(classifyRevocation(200, JSON.stringify({ revoked: true })), 'revoked');
  assert.equal(classifyRevocation(201, JSON.stringify({ scope: 'tweet.read' })), 'revoked');
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
    assert.equal(await revoke(async () => jsonResponse(200, {})), 'revoked');
    assert.equal(await revoke(async () => jsonResponse(200, { revoked: false })), 'failed');
    assert.equal(await revoke(async () => jsonResponse(400, { error: 'invalid_token' })), 'revoked');
    assert.equal(await revoke(async () => jsonResponse(400, { error: 'invalid_request' })), 'failed');
    assert.equal(await revoke(async () => new Response('', { status: 401 })), 'failed');
    assert.equal(await revoke(async () => new Response('', { status: 400 })), 'failed');
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

test('a session stays unrevoked when refresh is confirmed and the access call is an empty 401', async () => {
  const calls: string[] = [];
  const fetchImpl: typeof fetch = async (_input, init) => {
    const hint = new URLSearchParams(String(init?.body ?? '')).get('token_type_hint') ?? '';
    calls.push(hint);
    if (hint === 'refresh_token') return jsonResponse(200, {});
    return new Response('', { status: 401 });
  };
  assert.equal(await revokeTokenPair({
    accessToken: 'inert-access',
    refreshToken: 'inert-refresh',
    authorization: 'Basic inert',
    fetchImpl,
  }), false);
  assert.deepEqual(calls, ['refresh_token', 'access_token']);
});

test('a failed revocation is retryable and force is the only way to delete', async () => {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const hint = new URLSearchParams(String(init?.body ?? '')).get('token_type_hint') ?? '';
    if (hint === 'refresh_token') return jsonResponse(200, { revoked: false });
    return jsonResponse(400, { error: 'invalid_token' });
  };
  const allRevoked = await revokeTokenPair({
    accessToken: 'inert-access',
    refreshToken: 'inert-refresh',
    authorization: 'Basic inert',
    fetchImpl,
  });
  assert.equal(allRevoked, false);
  assert.deepEqual(accountDeletionDecision({ allRevoked, force: false }), {
    delete: false,
    status: 502,
    error: REVOKE_UNCONFIRMED_ERROR,
    revoked: false,
    retryable: true,
  });
  assert.deepEqual(accountDeletionDecision({ allRevoked, force: true }), { delete: true, revoked: false });
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  const route = readFileSync(join(root, 'app/api/data/route.ts'), 'utf8');
  const send = page.indexOf('const sendDelete');
  const refused = page.indexOf('response.status === 502');
  const forced = page.indexOf('sendDelete(true)');
  const alert = page.indexOf('payload?.revoked === false');
  assert.ok(send >= 0 && send < refused && refused < forced && forced < alert);
  const configured = route.slice(route.indexOf('const active = await getActiveXSession'));
  const passed = configured.indexOf('force,');
  const retryable = configured.indexOf('retryable: true');
  const deleted = configured.indexOf('deleted: true');
  assert.ok(passed >= 0 && passed < retryable && retryable < deleted);
  const mock = readFileSync(join(root, 'scripts/fixtures/mock-x.mjs'), 'utf8');
  const revoke = mock.slice(mock.indexOf("pathname === '/2/oauth2/revoke'"), mock.indexOf("pathname === '/2/oauth2/token'"));
  const failureAt = revoke.indexOf('scenario.revokeFailure');
  const invalidAt = revoke.indexOf("error: 'invalid_token'");
  assert.ok(failureAt !== -1 && invalidAt > failureAt);
  assert.match(revoke, /hint === 'access_token' && refreshTokenRevoked/);
  assert.match(revoke, /status: 400/);
  assert.match(revoke, /return Response\.json\(\{ revoked: true \}\)/);
});
