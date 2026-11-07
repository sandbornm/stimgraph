// Ambiguous tailnet owner must fail closed on every read path.
// Account A has a bookmark. An unexpired session belongs to B, who has no account row.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const dir = mkdtempSync(resolve(tmpdir(), 'stimgraph-owner-ambiguity-'));
const path = resolve(dir, 'test.sqlite');
const db = new DatabaseSync(path);
for (const file of readdirSync('drizzle').filter((file) => file.endsWith('.sql')).sort()) {
  db.exec(readFileSync(resolve('drizzle', file), 'utf8'));
}
const now = Date.now();
const privateText = 'private-bookmark-of-account-a';
db.prepare(`INSERT INTO accounts (id, username, name, profile_image_url, connected_at, updated_at)
  VALUES ('owner-a', 'owner_a', 'Owner A', NULL, ?, ?)`).run(now, now);
db.prepare(`INSERT INTO bookmarks (
  owner_id, post_id, author_id, author_username, author_name, author_profile_image_url,
  text, created_at, language, entities_json, metrics_json, synced_at
) VALUES ('owner-a', 'post-a', 'author-a', 'author_a', 'Author A', NULL, ?, NULL, NULL, '{}', '{}', ?)`).run(privateText, now);
db.prepare(`INSERT INTO x_sessions (id, owner_id, payload, expires_at, created_at, updated_at)
  VALUES ('session-b', 'owner-b', 'not-a-cookie', ?, ?, ?)`).run(now + 86400_000, now, now);
db.close();

const origin = 'https://fixture.example.ts.net';
const headers = {
  Host: 'fixture.example.ts.net',
  'X-Forwarded-Host': 'fixture.example.ts.net',
  'Tailscale-User-Login': 'owner@example.invalid',
  'X-Forwarded-Proto': 'https',
};
let child;
let output = '';
const request = (urlPath) => fetch(`http://127.0.0.1:3014${urlPath}`, { headers });

async function waitFor(check) {
  for (let i = 0; i < 100; i++) {
    try { if (await check()) return; } catch { /* Waiting for startup. */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error(`Owner ambiguity test timed out: ${output}`);
}

child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', '3014'], {
  env: {
    PATH: process.env.PATH,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    X_CLIENT_ID: 'stimgraph-inert-test',
    X_CLIENT_SECRET: 'stimgraph-inert-test-secret',
    XAI_API_KEY: '',
    X_REDIRECT_URI: `${origin}/api/auth/x/callback`,
    STIMGRAPH_TAILNET: 'true',
    STIMGRAPH_TAILNET_LOGIN: 'owner@example.invalid',
    STIMGRAPH_PUBLIC_ORIGIN: origin,
    STIMGRAPH_DATABASE: path,
    STIMGRAPH_BACKGROUND_POLL: 'false',
    STIMGRAPH_CREDENTIAL_SOURCE: 'none',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += chunk; });
child.stderr.on('data', (chunk) => { output += chunk; });

try {
  await waitFor(async () => (await request('/api/health')).status === 200);
  const outsider = await fetch('http://127.0.0.1:3014/api/activity', {
    headers: { ...headers, 'Tailscale-User-Login': 'other@example.invalid' },
  });
  assert.equal(outsider.status, 403, await outsider.text());
  const activity = await request('/api/activity');
  const activityBody = await activity.text();
  const agent = await request('/api/agent/bookmarks');
  const agentBody = await agent.text();
  assert.equal(activity.status, 401, activityBody);
  assert.equal(agent.status, 401, agentBody);
  assert.doesNotMatch(activityBody, /private-bookmark-of-account-a/);
  assert.doesNotMatch(agentBody, /private-bookmark-of-account-a/);
  console.log('Ambiguous tailnet owner denied on /api/activity and /api/agent/bookmarks. No live provider calls.');
} finally {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await once(child, 'exit');
  }
}
