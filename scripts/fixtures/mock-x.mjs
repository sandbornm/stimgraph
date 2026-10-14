// Preload for the isolated Node production test only. Never enabled by launchd.
import { readFileSync } from 'node:fs';
if (process.env.X_CLIENT_ID !== 'stimgraph-local-test' || !process.env.STIMGRAPH_TEST_SCENARIO) {
  throw new Error('Mock provider requires the isolated test environment.');
}
const original = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.hostname === 'api.x.com') {
    const scenario = JSON.parse(readFileSync(process.env.STIMGRAPH_TEST_SCENARIO, 'utf8'));
    if (url.pathname === '/2/oauth2/token') return Response.json({ access_token: 'inert-refreshed', refresh_token: 'inert-rotated', expires_in: 7200 });
    if (scenario.failure) return Response.json({}, { status: scenario.failure, headers: { 'Retry-After': '900' } });
    const size = Number(url.searchParams.get('max_results'));
    const offset = Number(url.searchParams.get('pagination_token') ?? 0);
    return Response.json({ data: Array.from({ length: Math.max(0, Math.min(size, scenario.count - offset)) }, (_, i) => ({
      id: String(scenario.count - offset - i), text: `Synthetic bookmark ${scenario.count - offset - i}`, author_id: 'fixture-author', created_at: '2020-01-01T00:00:00Z',
    })), includes: { users: [{ id: 'fixture-author', username: 'fixture', name: 'Fixture' }] },
    meta: { next_token: offset + size < scenario.count ? String(offset + size) : undefined } });
  }
  if (url.hostname === 'api.typesafe.ai') {
    // Synthetic Jev: even post ids -> "code" (confident), odd -> "other" (low confidence).
    const body = JSON.parse(init.body);
    const id = Number(String(body.state.post).match(/(\d+)$/)?.[1] ?? 0);
    const choice = id % 2 === 0 ? 'code' : 'other';
    return Response.json({ model: 'jev-test', answers: { topic: { type: 'choice', choice, confidence: choice === 'code' ? 0.9 : 0.3,
      probabilities: { [choice]: 1 } } }, usage: { input_tokens: 100, output_tokens: 10 } });
  }
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('Test blocked an unexpected network destination.');
  return original(input, init);
};
