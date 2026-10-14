import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_JEV_TOPICS, JEV_ENDPOINT, JEV_INTENTS, JevError, acceptedLabel, buildRequest, fingerprint, labelPost, mapLimit, normalizeTopics, parseSignals, topicsKey,
} from './jev.ts';

const ok = (choice: string, confidence = 0.9) => Response.json({ model: 'jev-1.13.0',
  answers: { topic: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } } });

test('builds a single Choice request with the topic rubric and bounded state', () => {
  const body = buildRequest('x'.repeat(10_000), 'alice', DEFAULT_JEV_TOPICS);
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.questions.topic.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.topic.criteria), Object.keys(DEFAULT_JEV_TOPICS));
  assert.equal(body.state.author, '@alice');
  assert.equal(body.state.post.length, 4000);
});

test('sends bearer auth to the documented endpoint and parses the answer', async () => {
  let seen: { url: string; auth: string | null } | undefined;
  const answer = await labelPost({ apiKey: 'k-test', text: 'new CVE', author: 'a', topics: DEFAULT_JEV_TOPICS,
    fetchImpl: async (url, init) => { seen = { url, auth: new Headers(init.headers).get('authorization') }; return ok('security'); } });
  assert.deepEqual(seen, { url: JEV_ENDPOINT, auth: 'Bearer k-test' });
  assert.deepEqual(answer, { label: 'security', confidence: 0.9, probabilities: { security: 0.9 }, model: 'jev-1.13.0', intent: null, stale: null });
});

test('retries 429 honoring retry-after, then gives up on persistent or client errors', async () => {
  let calls = 0;
  const answer = await labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, baseDelayMs: 1,
    fetchImpl: async () => (++calls < 3 ? new Response('', { status: 429, headers: { 'retry-after': '0.001' } }) : ok('code')) });
  assert.equal(answer.label, 'code');
  assert.equal(calls, 3);
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, baseDelayMs: 1, retries: 1,
    fetchImpl: async () => new Response('', { status: 429 }) }), (e: unknown) => e instanceof JevError && e.status === 429);
  calls = 0;
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS,
    fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } }), (e: unknown) => e instanceof JevError && e.status === 401);
  assert.equal(calls, 1, '401 is not retried');
});

test('rejects answers outside the topic list', async () => {
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, fetchImpl: async () => ok('weather') }));
});

test('low confidence and "other" fall back to keyword topics', () => {
  assert.equal(acceptedLabel({ label: 'agents', confidence: 0.5 }), 'agents');
  assert.equal(acceptedLabel({ label: 'agents', confidence: 0.49 }), null);
  assert.equal(acceptedLabel({ label: 'other', confidence: 1 }), null);
});

test('topic lists are normalized, always include other, and are bounded', () => {
  assert.deepEqual(normalizeTopics({ ' AI Agents ': 'agents', Design: 7 }), { 'ai-agents': 'agents', design: '', other: DEFAULT_JEV_TOPICS.other });
  assert.throws(() => normalizeTopics([]));
  assert.throws(() => normalizeTopics({ other: 'x' }));
  assert.throws(() => normalizeTopics(Object.fromEntries(Array.from({ length: 256 }, (_, i) => [`t${i}`, '']))));
});

test('fingerprints are stable and topic order does not matter', async () => {
  assert.equal(await fingerprint('a'), await fingerprint('a'));
  assert.notEqual(await fingerprint('a'), await fingerprint('b'));
  assert.equal(topicsKey({ a: '1', b: '2' }), topicsKey({ b: '2', a: '1' }));
});

test('mapLimit bounds concurrency and collects failures', async () => {
  let running = 0; let peak = 0;
  const results = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9], 4, async (n) => {
    running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--;
    if (n === 5) throw new Error('boom'); return n * 2;
  });
  assert.equal(peak, 4);
  assert.equal(results.length, 9);
  assert.equal(results.filter((r) => r.error).length, 1);
});

const okAll = (intent: string, ic: number, freshness: string, fc: number) => Response.json({ model: 'jev-1.13.0', answers: {
  topic: { type: 'choice', choice: 'code', confidence: 0.8, probabilities: {} },
  intent: { type: 'choice', choice: intent, confidence: ic, probabilities: {} },
  freshness: { type: 'choice', choice: freshness, confidence: fc, probabilities: {} },
} });

test('asks topic, why-saved intent and freshness in one request', async () => {
  const body = buildRequest('t', 'a', DEFAULT_JEV_TOPICS);
  assert.deepEqual(Object.keys(body.questions), ['topic', 'intent', 'freshness']);
  assert.deepEqual(Object.keys(body.questions.intent.criteria), ['try', 'read', 'reference', 'inspiration']);
  assert.deepEqual(Object.keys(body.questions.freshness.criteria), ['actionable', 'stale']);
  let calls = 0;
  const answer = await labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS,
    fetchImpl: async () => { calls++; return okAll('try', 0.7, 'stale', 0.9); } });
  assert.equal(calls, 1);
  assert.deepEqual(answer.intent, { value: 'try', confidence: 0.7 });
  assert.deepEqual(answer.stale, { value: true, confidence: 0.9 });
});

test('intent and stale below 0.5 confidence or invalid are null', () => {
  assert.deepEqual(parseSignals({ intent: { choice: 'read', confidence: 0.49 }, freshness: { choice: 'actionable', confidence: 0.5 } }),
    { intent: null, stale: { value: false, confidence: 0.5 } });
  assert.deepEqual(parseSignals({ intent: { choice: 'weather', confidence: 1 }, freshness: { choice: 'maybe', confidence: 1 } }), { intent: null, stale: null });
  assert.deepEqual(parseSignals(undefined), { intent: null, stale: null });
  assert.equal(Object.keys(JEV_INTENTS).length, 4);
});
