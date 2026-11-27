import assert from 'node:assert/strict';
import test from 'node:test';
import { requestTokenRevocation, revocationConfirmed } from './x-revoke.ts';

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('a token is revoked only on a 2xx response whose body does not say revoked false', () => {
  assert.equal(revocationConfirmed(401, {}), false);
  assert.equal(revocationConfirmed(500, { revoked: true }), false);
  assert.equal(revocationConfirmed(200, { revoked: false }), false);
  assert.equal(revocationConfirmed(200, { revoked: false, error: 'nope' }), false);
  assert.equal(revocationConfirmed(200, { revoked: true }), true);
  assert.equal(revocationConfirmed(204, null), true);
  assert.equal(revocationConfirmed(200, {}), true);
  assert.equal(revocationConfirmed(200, { revoked: 'false' }), true);
});

test('non-2xx, revoked false, and a thrown fetch are failures, and 2xx is success', async () => {
  const call = (fetchImpl: typeof fetch) => requestTokenRevocation({
    token: 'inert-token',
    tokenTypeHint: 'refresh_token',
    authorization: 'Basic inert',
    fetchImpl,
  });
  const logged: string[] = [];
  const originals = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const previous = originals.map((name) => console[name]);
  for (const name of originals) {
    console[name] = ((...args: unknown[]) => {
      logged.push(args.map((part) => String(part)).join(' '));
    }) as typeof console.log;
  }
  try {
    assert.equal(await call(async () => jsonResponse(400, { error: 'invalid_request', token: 'inert-token' })), false);
    assert.equal(await call(async () => jsonResponse(200, { revoked: false, token: 'inert-token' })), false);
    assert.equal(await call(async () => { throw new Error('network timeout'); }), false);
    assert.equal(await call(async () => jsonResponse(200, { revoked: true })), true);
    assert.equal(await call(async () => new Response('', { status: 200 })), true);
    assert.equal(await call(async () => new Response('not-json', { status: 200 })), true);
  } finally {
    originals.forEach((name, index) => {
      console[name] = previous[index] as typeof console.log;
    });
  }
  assert.deepEqual(logged, []);
});
