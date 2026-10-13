import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const dir = mkdtempSync(resolve(tmpdir(), 'stimgraph-local-test-'));
const path = resolve(dir, 'test.sqlite');
const scenario = resolve(dir, 'scenario.json');
writeFileSync(scenario, JSON.stringify({ count: 125 }));
const db = new DatabaseSync(path);
for (const file of readdirSync('drizzle').filter((file) => file.endsWith('.sql')).sort()) db.exec(readFileSync(resolve('drizzle', file), 'utf8'));
const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('stimgraph:x-session:v1:stimgraph-inert-test-secret'));
const key = await webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify({
  accessToken: 'inert-access', refreshToken: 'inert-refresh', expiresAt: 1,
  profile: { id: 'fixture-owner', username: 'fixture_owner', name: 'Fixture' },
})));
db.prepare('INSERT INTO x_sessions VALUES (?, ?, ?, ?, ?, ?)').run('fixture-session', 'fixture-owner',
  `${Buffer.from(iv).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`, Date.now() + 86400_000, Date.now(), Date.now());
// Simulate an install whose one-time backfill already ran, so the regular capped poll and catch-up are exercised.
db.prepare('INSERT INTO bookmark_sync_state(owner_id, backfill_completed_at) VALUES (?, ?)').run('fixture-owner', 1);
const origin = 'https://fixture.example.ts.net';
const headers = { Host: 'fixture.example.ts.net', 'Tailscale-User-Login': 'owner@example.invalid', 'X-Forwarded-Proto': 'https' };
let child;
let output = '';
const request = (path, extra = {}, options = {}) => fetch(`http://127.0.0.1:3012${path}`, { ...options, headers: { ...headers, ...extra } });
async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    try { if (await check()) return; } catch { /* Waiting for startup. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Local production test timed out: ${output}`);
}
async function start() {
  child = spawn(process.execPath, ['--import', resolve('scripts/fixtures/mock-x.mjs'), 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3012'], {
    env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
      X_CLIENT_ID: 'stimgraph-local-test', X_CLIENT_SECRET: 'stimgraph-inert-test-secret', XAI_API_KEY: '',
      X_REDIRECT_URI: `${origin}/api/auth/x/callback`, STIMGRAPH_TAILNET: 'true',
      STIMGRAPH_TAILNET_LOGIN: 'owner@example.invalid', STIMGRAPH_PUBLIC_ORIGIN: origin,
      STIMGRAPH_DATABASE: path, STIMGRAPH_BACKGROUND_POLL: 'true', STIMGRAPH_CREDENTIAL_SOURCE: 'none', STIMGRAPH_TEST_SCENARIO: scenario },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  await waitFor(async () => (await request('/api/health')).status === 200);
}
async function stop() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}
try {
  await start();
  await waitFor(() => db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n === 100
    && db.prepare('SELECT status FROM bookmark_sync_state').get()?.status === 'ok');
  const first = await (await request('/api/activity?limit=60')).json();
  assert.equal(first.events.length, 60);
  assert.equal(first.sync.catchingUp, 1);
  assert(Math.abs(first.sync.nextPollAt - first.sync.lastSucceededAt - 21_600_000) < 2000);
  assert.equal((await (await request('/api/health')).json()).pollIntervalHours, 6);
  assert.equal((await request('/api/activity', { 'Tailscale-User-Login': 'other@example.invalid' })).status, 403);
  assert.equal((await request('/api/activity?limit=501')).status, 400);
  const auth = await request('/api/auth/x/start', {}, { redirect: 'manual' });
  assert.equal(auth.status, 307);
  assert.match(auth.headers.get('set-cookie'), /Secure/i);
  assert.equal(new URL(auth.headers.get('location')).searchParams.get('redirect_uri'), `${origin}/api/auth/x/callback`);
  const page = await request('/');
  assert.equal(page.status, 200);
  const html = await page.text();
  const asset = html.match(/src="([^\"]+\.js[^\"]*)"/)?.[1];
  assert(asset);
  assert.equal((await request(asset)).status, 200);
  await stop();
  db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await start();
  await waitFor(() => db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n === 125);
  const rest = await (await request(`/api/activity?after=${first.nextCursor}`)).json();
  assert.equal(rest.events.length, 65);
  assert.equal(rest.sync.catchingUp, 0);
  assert.equal(new Set([...first.events, ...rest.events].map((event) => event.postId)).size, 125);
  // One-time backfill: pages past overlap, keeps the same 125 posts, and records completion.
  await stop();
  db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0, backfill_completed_at = NULL').run();
  await start();
  await waitFor(() => db.prepare('SELECT backfill_completed_at AS t FROM bookmark_sync_state').get()?.t > 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n, 125);
  assert.match(output, /bookmark backfill completed: 125 fetched in 2 X calls/);
  const cookie = { Cookie: 'stim_x_session=fixture-session', Origin: origin };
  assert.equal((await request('/api/data', { ...cookie, Origin: 'https://untrusted.invalid' }, { method: 'DELETE' })).status, 403);
  assert.equal((await request('/api/data', cookie, { method: 'DELETE' })).status, 200);
  for (const table of ['bookmarks', 'bookmark_observations', 'bookmark_sync_state', 'x_sessions', 'accounts']) {
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0);
  }
  assert.equal((await request('/api/activity')).status, 401);
  console.log('Node production integration passed: automatic polling with no browser, SQLite persistence, token refresh, cursor recovery after restart, one-time backfill, private HTTPS cookie/origin handling, assets, and complete deletion. No live provider calls.');
} finally { await stop(); db.close(); }
