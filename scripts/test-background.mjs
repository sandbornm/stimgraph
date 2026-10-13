// Run against an isolated production build. All X requests are intercepted.
import assert from 'node:assert/strict';
import { Miniflare, Response as MFResponse, Log, LogLevel } from 'miniflare';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';
import { builtWorkerOptions } from './worker-options.mjs';

const state = mkdtempSync(resolve(tmpdir(), 'stimgraph-background-test-'));
const origin = 'https://fixture.example.ts.net';
const login = 'owner@example.invalid';
let calls = 0;
let tokenCalls = 0;
let failure = 0;
let count = 125;
let tokenFailure = false;
const requestHeaders = { 'Tailscale-User-Login': login };
const options = {
  host: '127.0.0.1', port: 0, log: new Log(LogLevel.ERROR),
  workers: [{ name: 'stimgraph', ...builtWorkerOptions(process.cwd()),
    bindings: { X_CLIENT_ID: 'stimgraph-inert-test', X_CLIENT_SECRET: 'stimgraph-inert-test-secret',
      X_REDIRECT_URI: `${origin}/api/auth/x/callback`, STIMGRAPH_TAILNET: 'true',
      STIMGRAPH_PUBLIC_ORIGIN: origin, STIMGRAPH_TAILNET_LOGIN: login, STIMGRAPH_BACKGROUND_POLL: 'true' },
    d1Databases: { DB: 'background-test' },
    outboundService: async (request) => {
      const url = new URL(request.url);
      assert.equal(url.hostname, 'api.x.com', 'Unexpected network destination');
      if (url.pathname === '/2/oauth2/token') {
        tokenCalls++;
        if (tokenFailure) return MFResponse.json({ error: 'server_error' }, { status: 503 });
        await new Promise((done) => setTimeout(done, 50));
        return MFResponse.json({ access_token: 'inert-refreshed', refresh_token: 'inert-rotated', expires_in: 7200 });
      }
      calls++;
      if (failure) return MFResponse.json({}, { status: failure, headers: { 'Retry-After': '900' } });
      assert.equal(url.pathname, '/2/users/fixture-owner/bookmarks');
      const offset = Number(url.searchParams.get('pagination_token') ?? 0);
      const size = Number(url.searchParams.get('max_results'));
      const data = Array.from({ length: Math.max(0, Math.min(size, count - offset)) }, (_, index) => ({
        id: String(count - offset - index), text: `Synthetic bookmark ${count - offset - index}`, author_id: 'fixture-author',
        created_at: '2020-01-01T00:00:00Z',
      }));
      return MFResponse.json({ data, includes: { users: [{ id: 'fixture-author', username: 'fixture', name: 'Fixture' }] },
        meta: { next_token: offset + size < count ? String(offset + size) : undefined } });
    },
  }], d1Persist: resolve(state, 'd1'),
};
let mf = new Miniflare(options);
async function seal(expiresAt) {
  const material = new TextEncoder().encode('stimgraph:x-session:v1:stimgraph-inert-test-secret');
  const digest = await webcrypto.subtle.digest('SHA-256', material);
  const key = await webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({ accessToken: 'inert-access', refreshToken: 'inert-refresh', expiresAt,
    profile: { id: 'fixture-owner', username: 'fixture_owner', name: 'Fixture' } }));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return `${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}
const request = (path, headers = requestHeaders, init = {}) => mf.dispatchFetch(`${origin}${path}`, { ...init, headers });
try {
  await mf.ready;
  const denied = await request('/api/health', {});
  assert.equal(denied.status, 403, await denied.text());
  assert.equal((await request('/api/activity', { 'Tailscale-User-Login': 'other@example.invalid' })).status, 403);
  assert.equal((await request('/api/activity')).status, 401);
  assert.equal((await request('/api/health')).status, 200);
  let db = await mf.getD1Database('DB', 'stimgraph');
  const payload = await seal(Date.now() + 3600_000);
  await db.prepare(`INSERT INTO x_sessions(id, owner_id, payload, expires_at, created_at, updated_at)
    VALUES ('fixture-session', 'fixture-owner', ?, ?, ?, ?)`)
    .bind(payload, Date.now() + 86400_000, Date.now(), Date.now()).run();
  let worker = await mf.getWorker('stimgraph');
  await Promise.all([worker.scheduled(), worker.scheduled()]);
  assert.equal(calls, 5, 'Concurrent scheduler ticks share a durable lease');
  let response = await request('/api/activity?limit=60');
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const first = await response.json();
  assert.equal(first.events.length, 60);
  assert.equal(first.hasMore, true);
  assert.equal(first.sync.catchingUp, 1);
  assert(first.events.every((event) => event.firstObservedAt > Date.parse(event.postCreatedAt)));
  await worker.scheduled();
  assert.equal(calls, 5, 'No extra X reads before next poll');
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await mf.dispose();
  mf = new Miniflare(options);
  await mf.ready;
  db = await mf.getD1Database('DB', 'stimgraph');
  worker = await mf.getWorker('stimgraph');
  await worker.scheduled();
  assert.equal(calls, 7, 'Catch-up resumes from the saved cursor after restart');
  const rest = await (await request(`/api/activity?after=${first.nextCursor}`)).json();
  assert.equal(rest.events.length, 65);
  assert.equal(new Set([...first.events, ...rest.events].map((event) => event.postId)).size, 125);
  assert.equal(rest.sync.catchingUp, 0);
  count++;
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await worker.scheduled();
  const newEvents = await (await request(`/api/activity?after=${rest.nextCursor}`)).json();
  assert.equal(newEvents.events.length, 1, 'Only the new bookmark creates an event');
  assert.equal(calls, 8, 'Stop after overlap with already observed bookmarks');
  assert.equal((await request('/api/activity?limit=501')).status, 400);
  failure = 429;
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await worker.scheduled();
  const limited = await db.prepare('SELECT * FROM bookmark_sync_state').first();
  assert.equal(limited.status, 'x_429');
  assert(limited.next_poll_at >= Date.now() + 890_000);
  failure = 0;
  tokenFailure = true;
  await db.prepare('UPDATE x_sessions SET payload = ?').bind(await seal(1)).run();
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await worker.scheduled();
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM x_sessions').first()).n, 1, 'Transient token errors preserve the connection');
  tokenFailure = false;
  tokenCalls = 0;
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  const authenticated = { ...requestHeaders, Cookie: 'stim_x_session=fixture-session' };
  await Promise.all([worker.scheduled(), request('/api/auth/x/status', authenticated)]);
  assert.equal(tokenCalls, 1, 'Browser and scheduler rotate a token only once');
  const xBeforeRead = calls;
  await request('/api/activity');
  assert.equal(calls, xBeforeRead, 'Agent reads do not call X');
  assert.equal((await request('/api/auth/x/disconnect', { ...authenticated, Origin: 'https://other.invalid' }, { method: 'POST' })).status, 403);
  await request('/api/auth/x/disconnect', authenticated, { method: 'POST' });
  await db.prepare('UPDATE bookmark_sync_state SET next_poll_at = 0').run();
  await worker.scheduled();
  assert.equal(calls, xBeforeRead, 'Disconnect stops subsequent polls');
  assert.equal((await request('/')).status, 200);
  console.log('Background integration passed: access control, durable pagination, restart, deduplication, rate limits, refresh rotation, private agent feed, disconnect, and production page. No live X calls.');
} finally {
  await mf.dispose();
}
