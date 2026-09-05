// Requires the test-only fixture route in a secret-free preview on port 3012.
import assert from 'node:assert/strict';
import { webcrypto, randomUUID } from 'node:crypto';

const origin = 'http://127.0.0.1:3012';
const runId = randomUUID();
async function fixtureCookie(owner) {
  const digest = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode('stimgraph:x-session:v1:stimgraph-inert-test-secret'));
  const key = await webcrypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt']);
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const payload = new TextEncoder().encode(JSON.stringify({ accessToken: 'inert-fixture-no-network', expiresAt: Date.now() + 3600_000,
    profile: { id: owner, name: 'Research test', username: 'research_test' } }));
  const encrypted = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, payload);
  return `stim_x_session=${Buffer.from(iv).toString('base64url')}.${Buffer.from(encrypted).toString('base64url')}`;
}
const ownerA = `research-test-a-${runId}`, ownerB = `research-test-b-${runId}`;
const cookieA = await fixtureCookie(ownerA), cookieB = await fixtureCookie(ownerB);
const request = (path, cookie, options = {}) => fetch(`${origin}${path}`, { ...options, headers: { ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
const post = (cookie, body, headers = {}) => request('/api/research', cookie, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const fixture = (cookie, action) => request('/api/test-research', cookie, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
for (const [owner, cookie] of [[ownerA, cookieA], [ownerB, cookieB]]) {
  assert.equal((await (await request('/api/auth/x/status', cookie)).json()).profile?.id, owner, 'Use only the isolated preview with inert credentials.');
}
try {
  const seededA = await fixture(cookieA, 'seed');
  assert.equal(seededA.status, 200, 'Install scripts/fixtures/research-route.ts in the isolated preview only.');
  const { ids } = await seededA.json();
  const { ids: foreignIds } = await (await fixture(cookieB, 'seed')).json();
  const card = { lens: 'method_transfer', reach: 'close', question: 'Can local proofs help under memory limits?', method: 'Local proofs', problem: 'Memory limits',
    connection: 'A candidate transfer', firstTest: 'A toy comparison', assumptions: [], counterexamples: [], searchQuery: 'local proofs memory', notes: '', nearby: null,
    sources: [{ id: ids[0], label: 'Client label ignored', role: 'method', quote: 'A small proof checks each transformation.', reason: 'Method', intent: 'method' },
      { id: ids[1], label: 'Client label ignored', role: 'problem', quote: 'Memory limits make validation costly.', reason: 'Problem', intent: 'disagree' }] };
  assert.equal((await request('/api/research')).status, 401);
  assert.equal((await post(undefined, { action: 'save', card })).status, 401);
  assert.equal((await post(cookieA, { action: 'save', card }, { Origin: 'https://example.invalid' })).status, 403);
  assert.equal((await post(cookieA, { action: 'generate', sourceIds: ids, lens: 'method_transfer', reach: 'close' })).status, 400);
  assert.equal((await post(cookieA, { action: 'generate', consent: true, sourceIds: foreignIds, lens: 'method_transfer', reach: 'close' })).status, 404);
  assert.equal((await post(cookieA, { action: 'generate', consent: true, sourceIds: ids, lens: 'method_transfer', reach: 'close' })).status, 503, 'No live Grok key may be configured in this preview.');
  assert.equal((await post(cookieA, { action: 'save', card: { ...card, sources: [{ ...card.sources[0], id: foreignIds[0] }, card.sources[1]] } })).status, 404);
  assert.equal((await post(cookieA, { action: 'save', card: { ...card, sources: [{ ...card.sources[0], quote: 'An invented quote' }, card.sources[1]] } })).status, 400);
  const saved = await post(cookieA, { action: 'save', card, ownerId: ownerB });
  assert.equal(saved.status, 201);
  assert.match(saved.headers.get('cache-control'), /private, no-store/);
  const { card: version1 } = await saved.json();
  assert.notEqual(version1.sources[0].label, 'Client label ignored');
  assert.equal('ownerId' in version1, false);
  assert.equal(version1.sources[1].intent, 'disagree');
  assert.deepEqual((await (await request('/api/research', cookieB)).json()).cards, []);
  assert.equal((await request(`/api/research?id=${version1.id}`, cookieB, { method: 'DELETE' })).status, 404);
  const nearby = { provider: 'Crossref', query: 'original query', checkedAt: Date.now(), works: [] };
  const { card: version2 } = await (await post(cookieA, { action: 'save', card: { ...card, notes: 'A second version', nearby } })).json();
  assert.notEqual(version2.id, version1.id);
  const loaded = (await (await request('/api/research', cookieA)).json()).cards;
  assert.equal(loaded.length, 2);
  assert.equal(loaded.find((item) => item.id === version1.id).notes, '');
  assert.deepEqual(loaded.find((item) => item.id === version2.id).nearby, nearby);
  assert.equal((await request(`/api/research?id=${version1.id}`, cookieA, { method: 'DELETE' })).status, 200);
  const quotas = await (await fixture(cookieA, 'quotas')).json();
  for (const kind of ['generate', 'nearby']) assert.deepEqual(quotas[kind], { burst: 1, daily: false, otherKind: true });
  assert.equal((await post(cookieA, { action: 'nearby', consent: true, query: 'test' })).status, 429);
  await fixture(cookieA, 'fill-cards');
  const cap = await Promise.all([post(cookieA, { action: 'save', card }), post(cookieA, { action: 'save', card })]);
  assert.deepEqual(cap.map((response) => response.status).sort(), [201, 409]);
  assert.match(await (await request('/')).text(), /Research bench/);
  assert.equal((await request('/api/data', cookieA, { method: 'DELETE' })).status, 200);
  assert.deepEqual(await (await fixture(cookieA, 'counts')).json(), { cards: 0, requests: 0 });
  console.log('Research API passed: source ownership, quotation checks, persistence, versions, isolation, quotas, record cap, deletion, and page rendering. No live provider calls.');
} finally {
  await request('/api/data', cookieA, { method: 'DELETE' });
  await request('/api/data', cookieB, { method: 'DELETE' });
}
