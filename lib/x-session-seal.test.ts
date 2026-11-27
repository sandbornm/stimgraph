import assert from 'node:assert/strict';
import test from 'node:test';
import { openXSession, sealXSession, X_SESSION_SEAL_VERSION } from './x-session-seal.ts';

let pending = Promise.resolve();
function serial(name: string, fn: () => Promise<void>) {
  const gate = pending;
  let release = () => {};
  pending = new Promise((resolve) => { release = resolve; });
  test(name, async () => {
    await gate;
    try {
      await fn();
    } finally {
      release();
    }
  });
}

const session = {
  accessToken: 'inert-access-token',
  refreshToken: 'inert-refresh-token',
  expiresAt: 1_700_000_000_000,
  profile: { id: 'owner-inert', username: 'inert_user', name: 'Inert' },
};

function keyMaterial() {
  return crypto.getRandomValues(new Uint8Array(32));
}

async function withEnv<T>(values: Record<string, string | undefined>, run: () => Promise<T>) {
  const names = ['STIMGRAPH_TOKEN_KEY', 'X_CLIENT_SECRET'];
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  try {
    return await run();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

function flip(value: string) {
  const next = value[0] === 'A' ? 'B' : 'A';
  return `${next}${value.slice(1)}`;
}

async function sealLegacy(secret: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`stimgraph:x-session:v1:${secret}`));
  const key = await crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(JSON.stringify(session)),
  );
  const part = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
  return `${part(iv)}.${part(new Uint8Array(ciphertext))}`;
}

serial('v2 seal round trips with base64 and base64url keys and rejects tampering or the wrong key', async () => {
  const raw = keyMaterial();
  const standard = Buffer.from(raw).toString('base64');
  const url = Buffer.from(raw).toString('base64url');
  await withEnv({ STIMGRAPH_TOKEN_KEY: standard, X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    const sealed = await sealXSession(session);
    assert.ok(sealed.startsWith(`${X_SESSION_SEAL_VERSION}.`));
    assert.equal((await openXSession(sealed))?.needsReseal, false);
    assert.deepEqual((await openXSession(sealed))?.session, session);
  });
  await withEnv({ STIMGRAPH_TOKEN_KEY: url, X_CLIENT_SECRET: 'different-inert-secret' }, async () => {
    const sealed = await sealXSession(session);
    const opened = await openXSession(sealed);
    assert.equal(opened?.needsReseal, false);
    assert.deepEqual(opened?.session, session);
    const [version, iv, ciphertext] = sealed.split('.');
    assert.equal(await openXSession(`${flip(version)}.${iv}.${ciphertext}`), null);
    assert.equal(await openXSession(`${version}.${flip(iv)}.${ciphertext}`), null);
    assert.equal(await openXSession(`${version}.${iv}.${flip(ciphertext)}`), null);
    assert.equal(await openXSession(sealed.slice(version.length + 1)), null);
  });
  const sealed = await withEnv({ STIMGRAPH_TOKEN_KEY: standard }, async () => sealXSession(session));
  await withEnv({ STIMGRAPH_TOKEN_KEY: Buffer.from(keyMaterial()).toString('base64url'), X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    assert.equal(await openXSession(sealed), null);
  });
});

serial('a legacy payload still opens and is flagged for re-seal', async () => {
  const legacy = await sealLegacy('inert-legacy-secret');
  const tokenKey = Buffer.from(keyMaterial()).toString('base64url');
  await withEnv({ STIMGRAPH_TOKEN_KEY: tokenKey, X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    const opened = await openXSession(legacy);
    assert.equal(opened?.needsReseal, true);
    assert.deepEqual(opened?.session, session);
  });
  await withEnv({ STIMGRAPH_TOKEN_KEY: tokenKey, X_CLIENT_SECRET: 'other-inert-secret' }, async () => {
    assert.equal(await openXSession(legacy), null);
  });
  await withEnv({ X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    const opened = await openXSession(legacy);
    assert.equal(opened?.needsReseal, true);
    assert.equal(opened?.session.accessToken, session.accessToken);
    await assert.rejects(() => sealXSession(session), /STIMGRAPH_TOKEN_KEY/);
  });
});

serial('sealing throws when STIMGRAPH_TOKEN_KEY is missing or the wrong length', async () => {
  await withEnv({ X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    await assert.rejects(() => sealXSession(session), /Missing required server configuration: STIMGRAPH_TOKEN_KEY/);
  });
  await withEnv({ STIMGRAPH_TOKEN_KEY: 'abcd', X_CLIENT_SECRET: 'inert-legacy-secret' }, async () => {
    await assert.rejects(() => sealXSession(session), /32 bytes/);
  });
});
