import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_JEV_TOPICS, JEV_ENDPOINT, JEV_INTENTS, JEV_STALE_TTL_MS, JevError, acceptedLabel, buildRequest, fingerprint, labelPlan, labelPost, mapLimit, normalizeTopics, parseSignals, topicsKey,
} from './jev.ts';

const postedAt = '2024-06-01T00:00:00.000Z';
const evaluatedOn = '2026-10-13T00:00:00.000Z';
const dates = { createdAt: postedAt, evaluatedAt: evaluatedOn };

const ok = (choice: string, confidence = 0.9) => Response.json({ model: 'jev-1.13.0',
  answers: { topic: { type: 'choice', choice, confidence, probabilities: { [choice]: confidence } } } });

test('builds a single Choice request with the topic rubric and bounded state', () => {
  const body = buildRequest('x'.repeat(10_000), 'alice', DEFAULT_JEV_TOPICS, postedAt, evaluatedOn);
  assert.equal(body.model, 'jev-latest');
  assert.equal(body.questions.topic.type, 'choice');
  assert.deepEqual(Object.keys(body.questions.topic.criteria), Object.keys(DEFAULT_JEV_TOPICS));
  assert.equal(body.state.author, '@alice');
  assert.equal(body.state.post.length, 4000);
  assert.equal(body.state.posted_at, postedAt);
  assert.equal(body.state.evaluated_on, evaluatedOn);
});

test('sends bearer auth to the documented endpoint and parses the answer', async () => {
  let seen: { url: string; auth: string | null } | undefined;
  const answer = await labelPost({ apiKey: 'k-test', text: 'new CVE', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates,
    fetchImpl: async (url, init) => { seen = { url, auth: new Headers(init.headers).get('authorization') }; return ok('security'); } });
  assert.deepEqual(seen, { url: JEV_ENDPOINT, auth: 'Bearer k-test' });
  assert.deepEqual(answer, { label: 'security', confidence: 0.9, probabilities: { security: 0.9 }, model: 'jev-1.13.0', intent: null, stale: null });
});

test('retries 429 honoring retry-after, then gives up on persistent or client errors', async () => {
  let calls = 0;
  const answer = await labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates, baseDelayMs: 1,
    fetchImpl: async () => (++calls < 3 ? new Response('', { status: 429, headers: { 'retry-after': '0.001' } }) : ok('code')) });
  assert.equal(answer.label, 'code');
  assert.equal(calls, 3);
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates, baseDelayMs: 1, retries: 1,
    fetchImpl: async () => new Response('', { status: 429 }) }), (e: unknown) => e instanceof JevError && e.status === 429);
  calls = 0;
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates,
    fetchImpl: async () => { calls++; return new Response('', { status: 401 }); } }), (e: unknown) => e instanceof JevError && e.status === 401);
  assert.equal(calls, 1, '401 is not retried');
});

test('rejects answers outside the topic list', async () => {
  await assert.rejects(labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates, fetchImpl: async () => ok('weather') }));
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
  const body = buildRequest('t', 'a', DEFAULT_JEV_TOPICS, postedAt, evaluatedOn);
  assert.deepEqual(Object.keys(body.questions), ['topic', 'intent', 'freshness']);
  assert.deepEqual(Object.keys(body.questions.intent.criteria), ['try', 'read', 'reference', 'inspiration']);
  assert.deepEqual(Object.keys(body.questions.freshness.criteria), ['actionable', 'stale']);
  assert.match(body.questions.freshness.instructions, /`posted_at`/);
  assert.match(body.questions.freshness.instructions, /`evaluated_on`/);
  assert.equal(body.state.posted_at, postedAt);
  assert.equal(body.state.evaluated_on, evaluatedOn);
  let calls = 0;
  const answer = await labelPost({ apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, ...dates,
    fetchImpl: async () => { calls++; return okAll('try', 0.7, 'stale', 0.9); } });
  assert.equal(calls, 1);
  assert.deepEqual(answer.intent, { value: 'try', confidence: 0.7 });
  assert.deepEqual(answer.stale, { value: true, confidence: 0.9 });
});

test('freshness can be asked alone and still sees both dates', async () => {
  const body = buildRequest('t', 'a', DEFAULT_JEV_TOPICS, null, evaluatedOn, ['freshness']);
  assert.deepEqual(Object.keys(body.questions), ['freshness']);
  assert.equal(body.state.posted_at, null);
  assert.equal(body.state.evaluated_on, evaluatedOn);
  let sent;
  const answer = await labelPost({
    apiKey: 'k', text: 't', author: 'a', topics: DEFAULT_JEV_TOPICS, createdAt: null, evaluatedAt: evaluatedOn, questions: ['freshness'],
    fetchImpl: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ model: 'jev-1.13.0', answers: {
        freshness: { type: 'choice', choice: 'actionable', confidence: 0.7, probabilities: {} },
      } });
    },
  });
  assert.deepEqual(Object.keys(sent.questions), ['freshness']);
  assert.equal(sent.state.posted_at, null);
  assert.equal(sent.state.evaluated_on, evaluatedOn);
  assert.deepEqual(answer.stale, { value: false, confidence: 0.7 });
  assert.equal(answer.label, '');
});

test('a current topic and intent stay put; freshness is due only when missing or older than 7 days', () => {
  const now = Date.parse(evaluatedOn);
  const current = { textHash: 't', topicsHash: 'topics', signalsAt: 1, staleEvaluatedAt: now - 6 * 86_400_000 };
  assert.equal(JEV_STALE_TTL_MS, 7 * 86_400_000);
  assert.equal(labelPlan(current, 't', 'topics', now), 'skip');
  assert.equal(labelPlan({ ...current, staleEvaluatedAt: now - JEV_STALE_TTL_MS }, 't', 'topics', now), 'skip');
  assert.equal(labelPlan({ ...current, staleEvaluatedAt: now - JEV_STALE_TTL_MS - 1 }, 't', 'topics', now), 'freshness');
  assert.equal(labelPlan({ ...current, staleEvaluatedAt: null }, 't', 'topics', now), 'freshness');
  assert.equal(labelPlan({ ...current, textHash: 'old' }, 't', 'topics', now), 'full');
  assert.equal(labelPlan({ ...current, topicsHash: 'old' }, 't', 'topics', now), 'full');
  assert.equal(labelPlan({ ...current, signalsAt: null, staleEvaluatedAt: null }, 't', 'topics', now), 'full');
  assert.equal(labelPlan({ textHash: null, topicsHash: null, signalsAt: null, staleEvaluatedAt: null }, 't', 'topics', now), 'full');
});

test('stale_evaluated_at migration adds a nullable column and is safe to reapply in ensureSchema', () => {
  const db = new DatabaseSync(':memory:');
  const execFile = (name) => {
    for (const part of readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').split('--> statement-breakpoint')) {
      const sql = part.trim();
      if (sql) db.exec(sql);
    }
  };
  execFile('0006_jev_labels.sql');
  execFile('0007_jev_intent_stale.sql');
  execFile('0008_jev_stale_evaluated_at.sql');
  const names = db.prepare('PRAGMA table_info(jev_labels)').all().map((column) => column.name);
  assert.ok(names.includes('stale_evaluated_at'));
  assert.throws(() => execFile('0008_jev_stale_evaluated_at.sql'), /duplicate column/i);
  db.close();
});

test('intent and stale below 0.5 confidence or invalid are null', () => {
  assert.deepEqual(parseSignals({ intent: { choice: 'read', confidence: 0.49 }, freshness: { choice: 'actionable', confidence: 0.5 } }),
    { intent: null, stale: { value: false, confidence: 0.5 } });
  assert.deepEqual(parseSignals({ intent: { choice: 'weather', confidence: 1 }, freshness: { choice: 'maybe', confidence: 1 } }), { intent: null, stale: null });
  assert.deepEqual(parseSignals(undefined), { intent: null, stale: null });
  assert.equal(Object.keys(JEV_INTENTS).length, 4);
});
