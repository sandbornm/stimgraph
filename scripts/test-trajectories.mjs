import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3012';
const testSecret = 'stimgraph-inert-test-secret';
const runId = randomUUID();

async function fixtureCookie(owner) {
  const material = new TextEncoder().encode(`stimgraph:x-session:v1:${testSecret}`);
  const digest = await webcrypto.subtle.digest('SHA-256', material);
  const key = await webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({
    accessToken: 'inert-fixture-no-network', expiresAt: Date.now() + 3600_000,
    profile: { id: owner, name: 'Trajectory test', username: 'trajectory_test' },
  }));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return `stim_x_session=${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}

const ownerA = `trajectory-test-a-${runId}`;
const ownerB = `trajectory-test-b-${runId}`;
const cookieA = await fixtureCookie(ownerA);
const cookieB = await fixtureCookie(ownerB);
const request = (path, cookie, options = {}) => fetch(`${origin}${path}`, {
  ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
});
const post = (cookie, body, extraHeaders) => request('/api/trajectories', cookie, {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...extraHeaders }, body: JSON.stringify(body),
});
const draft = {
  name: 'Embedded → firmware', question: 'What connects these ideas?', ownerId: ownerB,
  steps: [
    { id: 'topic:embedded', label: 'Embedded', kind: 'topic', via: null },
    { id: 'bookmark:fixture', label: 'A saved firmware note', kind: 'source', via: { kind: 'evidence', reason: 'A bookmark on this topic' } },
  ],
};

for (const [owner, cookie] of [[ownerA, cookieA], [ownerB, cookieB]]) {
  const response = await request('/api/auth/x/status', cookie);
  const status = await response.json();
  assert.equal(status.profile?.id, owner, 'Use an isolated preview with the inert test secret.');
}

try {
  assert.equal((await request('/api/trajectories')).status, 401);
  assert.equal((await post(undefined, draft)).status, 401);
  const response = await post(cookieA, draft);
  assert.equal(response.status, 201);
  assert.match(response.headers.get('cache-control'), /private, no-store/);
  const { trajectory } = await response.json();
  assert.equal(trajectory.name, draft.name);
  assert.equal('ownerId' in trajectory, false);
  const listA = await (await request('/api/trajectories', cookieA)).json();
  assert.equal(listA.trajectories.length, 1);
  assert.deepEqual(listA.trajectories[0].steps, draft.steps);
  const listB = await (await request('/api/trajectories', cookieB)).json();
  assert.deepEqual(listB.trajectories, []);
  assert.equal((await request(`/api/trajectories?id=${trajectory.id}`, cookieB, { method: 'DELETE' })).status, 404);
  assert.equal((await post(cookieA, draft, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post(cookieA, { ...draft, steps: [draft.steps[0], draft.steps[0]] })).status, 400);
  const { trajectory: version2 } = await (await post(cookieA, { ...draft, question: 'A second version' })).json();
  assert.notEqual(version2.id, trajectory.id);
  assert.equal((await request(`/api/trajectories?id=${trajectory.id}`, cookieA, { method: 'DELETE' })).status, 200);
  const remaining = await (await request('/api/trajectories', cookieA)).json();
  assert.deepEqual(remaining.trajectories.map((item) => item.id), [version2.id]);
  const page = await request('/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /CONCEPT TRAJECTORY/);
  assert.equal((await request('/api/data', cookieA, { method: 'DELETE' })).status, 200);
  const afterDelete = await (await request('/api/trajectories', cookieA)).json();
  assert.deepEqual(afterDelete.trajectories, []);
  console.log('Trajectory API passed: persistence, account isolation, validation, private caching, separate versions, deletion, and page rendering.');
} finally {
  await request('/api/data', cookieA, { method: 'DELETE' });
  await request('/api/data', cookieB, { method: 'DELETE' });
}
