import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { webcrypto } from 'node:crypto';

const counter = resolve(process.env.BENCH_COUNTER ?? 'scripts/fixtures/count-sql.mjs');
const runs = Number(process.env.BENCH_RUNS ?? 40);
const count = Number(process.env.BENCH_BOOKMARKS ?? 600);
const dir = mkdtempSync(resolve(tmpdir(), 'stimgraph-bench-'));
const path = resolve(dir, 'bench.sqlite');
const scenario = resolve(dir, 'scenario.json');
writeFileSync(scenario, JSON.stringify({ count }));
const db = new DatabaseSync(path);
for (const file of readdirSync('drizzle').filter((file) => file.endsWith('.sql')).sort()) db.exec(readFileSync(resolve('drizzle', file), 'utf8'));
const rawKey = new Uint8Array(32);
const key = await webcrypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
const iv = webcrypto.getRandomValues(new Uint8Array(12));
const ciphertext = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode('v2.stimgraph:x-session') }, key, new TextEncoder().encode(JSON.stringify({
  accessToken: 'inert-access', refreshToken: 'inert-refresh', expiresAt: Date.now() + 86400_000 * 30,
  profile: { id: 'bench-owner', username: 'bench_owner', name: 'Bench' },
})));
db.prepare('INSERT INTO x_sessions VALUES (?, ?, ?, ?, ?, ?)').run('bench-session', 'bench-owner',
  `v2.${Buffer.from(iv).toString('base64url')}.${Buffer.from(ciphertext).toString('base64url')}`, Date.now() + 86400_000 * 30, Date.now(), Date.now());
const origin = 'https://bench.example.ts.net';
const headers = { Host: 'bench.example.ts.net', 'Tailscale-User-Login': 'owner@example.invalid', 'X-Forwarded-Proto': 'https',
  Cookie: '__Host-stim_x_session=bench-session; stim_x_session=bench-session' };
const counterPort = 3019;
let child;
let output = '';
const request = (p, options = {}) => fetch(`http://127.0.0.1:3022${p}`, { ...options, headers: { ...headers, ...(options.headers ?? {}) } });
async function waitFor(check, tries = 600) {
  for (let i = 0; i < tries; i++) {
    try { if (await check()) return; } catch { }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`bench timed out: ${output.slice(-2000)}`);
}
child = spawn(process.execPath, ['--import', resolve('scripts/fixtures/mock-x.mjs'), '--import', counter, 'node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3022'], {
  env: { PATH: process.env.PATH, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
    X_CLIENT_ID: 'stimgraph-local-test', X_CLIENT_SECRET: 'stimgraph-inert-test-secret', STIMGRAPH_TOKEN_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', XAI_API_KEY: '', TYPESAFE_API_KEY: 'inert-typesafe-test',
    X_REDIRECT_URI: `${origin}/api/auth/x/callback`, STIMGRAPH_TAILNET: 'true',
    STIMGRAPH_TAILNET_LOGIN: 'owner@example.invalid', STIMGRAPH_PUBLIC_ORIGIN: origin,
    STIMGRAPH_DATABASE: path, STIMGRAPH_BACKGROUND_POLL: 'true', STIMGRAPH_CREDENTIAL_SOURCE: 'none', STIMGRAPH_TEST_SCENARIO: scenario,
    STIMGRAPH_BENCH_COUNTER_PORT: String(counterPort) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });
const counterGet = async (p) => (await (await fetch(`http://127.0.0.1:${counterPort}${p}`)).json()).prepare;
const routes = [
  ['status', '/api/auth/x/status'],
  ['health', '/api/health'],
  ['activity1', '/api/activity?limit=1'],
  ['activity60', '/api/activity?limit=60'],
  ['graph', '/api/graph'],
  ['graphWide', '/api/graph?scope=wide'],
  ['agentBookmarks', '/api/agent/bookmarks'],
  ['agentTopics', '/api/agent/topics'],
  ['jev', '/api/jev'],
  ['page', '/'],
];
try {
  await waitFor(async () => (await request('/api/health')).status === 200);
  await waitFor(() => db.prepare('SELECT backfill_completed_at AS t FROM bookmark_sync_state').get()?.t > 1);
  await waitFor(() => db.prepare("SELECT status FROM bookmark_sync_state").get()?.status === 'ok');
  await waitFor(() => db.prepare('SELECT COUNT(*) AS n FROM jev_labels').get().n >= Math.min(200, db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n));
  await new Promise((done) => setTimeout(done, 1500));
  const extra = Number(process.env.BENCH_EXTRA_COPIES ?? 0);
  if (extra > 0) {
    const columns = db.prepare('PRAGMA table_info(bookmarks)').all().map((c) => c.name);
    const select = columns.map((c) => c === 'post_id' ? "post_id || '-c' || ?" : c).join(', ');
    const tcols = db.prepare('PRAGMA table_info(bookmark_topics)').all().map((c) => c.name);
    const tselect = tcols.map((c) => c === 'post_id' ? "post_id || '-c' || ?" : c).join(', ');
    for (let n = 1; n <= extra; n++) {
      db.prepare(`INSERT INTO bookmarks (${columns.join(', ')}) SELECT ${select} FROM bookmarks WHERE post_id NOT LIKE '%-c%'`).run(n);
      db.prepare(`INSERT INTO bookmark_topics (${tcols.join(', ')}) SELECT ${tselect} FROM bookmark_topics WHERE post_id NOT LIKE '%-c%'`).run(n);
    }
  }
  const rows = db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n;
  const results = {};
  for (const [name, p] of routes) {
    for (let i = 0; i < 5; i++) await (await request(p)).arrayBuffer();
    await fetch(`http://127.0.0.1:${counterPort}/reset-timing`);
    const times = [];
    const queries = [];
    let bytes = 0;
    let status = 0;
    for (let i = 0; i < runs; i++) {
      await counterGet('/reset');
      const start = performance.now();
      const response = await request(p);
      const body = await response.arrayBuffer();
      times.push(performance.now() - start);
      queries.push(await counterGet('/'));
      bytes = body.byteLength;
      status = response.status;
    }
    times.sort((a, b) => a - b);
    queries.sort((a, b) => a - b);
    results[name] = { status, p50ms: +times[Math.floor(runs / 2)].toFixed(2), p95ms: +times[Math.floor(runs * 0.95)].toFixed(2),
      sqlPrepares: queries[Math.floor(runs / 2)], bytes };
    if (process.env.BENCH_TOP) results[name].top = (await (await fetch(`http://127.0.0.1:${counterPort}/top`)).json()).slice(0, 5);
  }
  console.log(JSON.stringify({ bookmarks: rows, runs, results }, null, 1));
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await once(child, 'exit'); }
  db.close();
}
