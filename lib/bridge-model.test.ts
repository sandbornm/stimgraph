import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExploreIndex, type ExploreNode } from './explore-model.ts';
import { bridgeIsAvailable, bridgePromptContext, findConceptBridges, parseBridgeInterpretation } from './bridge-model.ts';
import type { GraphEdge } from './graph-model.ts';
import { interpretConceptBridge } from './xai-bridge.ts';

const node = (id: string, kind: ExploreNode['kind'] = 'topic'): ExploreNode => ({ id, kind, label: id, note: 'A saved note about interfaces, @example and https://example.com.', evidence: '', size: 1 });
const edge = (from: string, to: string, kind: GraphEdge['kind'] = 'evidence'): GraphEdge => ({ from, to, kind, weight: 1 });
const nodes = ['A', 'B', 'C', 'D', 'isolated'].map((id) => node(id)).concat(['ab', 'bc', 'ad', 'dc'].map((id) => node(id, 'source')), [node('author', 'person'), node('scout', 'scout')]);
const edges = [edge('A', 'ab'), edge('ab', 'B'), edge('B', 'bc'), edge('bc', 'C'), edge('A', 'ad'), edge('ad', 'D'), edge('D', 'dc'), edge('dc', 'C'), edge('A', 'author'), edge('author', 'C'), edge('A', 'C', 'affinity'), edge('A', 'scout'), edge('scout', 'C')];
const index = buildExploreIndex(nodes, edges);
const routes = findConceptBridges(index, 'A', 'C');
const context = bridgePromptContext(index, 'A', 'C', routes);
const answer = {
  routeRef: 'r1', explanation: 'The saved material connects these concepts.',
  hops: context.routes[0].hops.map((hop) => ({ from: hop.from, to: hop.to, explanation: 'The shared bookmark discusses both labels.' })),
  suggestedConcepts: [], nextQuestion: 'Where do these ideas diverge?',
};

describe('concept bridges', () => {
  it('finds distinct concept routes with an actual saved-post witness for each hop', () => {
    assert.equal(routes.length, 2);
    assert.deepEqual(routes[0].conceptIds, ['A', 'B', 'C']);
    assert.deepEqual(routes[0].nodeIds, ['A', 'ab', 'B', 'bc', 'C']);
    assert.deepEqual(routes[1].conceptIds, ['A', 'D', 'C']);
    for (const route of routes) { assert.ok(bridgeIsAvailable(index, route)); assert.equal(new Set(route.nodeIds).size, route.nodeIds.length); }
  });
  it('does not treat authors, scouts, or affinity-only links as bookmarked concept bridges', () => {
    const weak = buildExploreIndex(nodes, edges.filter((edge) => !['ab', 'bc', 'ad', 'dc'].includes(edge.from) && !['ab', 'bc', 'ad', 'dc'].includes(edge.to)));
    assert.deepEqual(findConceptBridges(weak, 'A', 'C'), []);
    assert.deepEqual(findConceptBridges(index, 'A', 'A'), []);
    assert.deepEqual(findConceptBridges(index, 'author', 'C'), []);
    assert.deepEqual(findConceptBridges(index, 'A', 'isolated'), []);
  });
  it('handles reversed routes, graph updates, and a maximum of six concept hops', () => {
    assert.deepEqual(findConceptBridges(index, 'C', 'A')[0].nodeIds, ['C', 'bc', 'B', 'ab', 'A']);
    const missing = buildExploreIndex(nodes.filter((node) => node.id !== 'bc'), edges);
    assert.equal(bridgeIsAvailable(missing, routes[0]), false);
    const chainNodes = Array.from({ length: 8 }, (_, i) => node(`t${i}`)).concat(Array.from({ length: 7 }, (_, i) => node(`p${i}`, 'source')));
    const chainEdges = Array.from({ length: 7 }, (_, i) => [edge(`t${i}`, `p${i}`), edge(`p${i}`, `t${i + 1}`)]).flat();
    const chain = buildExploreIndex(chainNodes, chainEdges);
    assert.equal(findConceptBridges(chain, 't0', 't6').length, 1);
    assert.equal(findConceptBridges(chain, 't0', 't7').length, 0);
  });
  it('bounds excerpts and replaces source IDs, handles, and URLs with references', () => {
    const body = JSON.stringify(context);
    assert.equal(body.includes('@example'), false);
    assert.equal(body.includes('https://example.com'), false);
    assert.ok(context.posts.every((post) => post.excerpt.length <= 400));
    assert.ok(context.routes.every((route) => route.hops.every((hop) => hop.posts.length > 0)));
    assert.ok(context.posts.length <= 24);
  });
  it('rejects invented routes and changed endpoints in a Grok answer', () => {
    assert.equal(parseBridgeInterpretation(answer, routes, context)?.routeId, routes[0].id);
    assert.equal(parseBridgeInterpretation({ ...answer, routeRef: 'invented' }, routes, context), null);
    assert.equal(parseBridgeInterpretation({ ...answer, hops: [] }, routes, context), null);
    assert.equal(parseBridgeInterpretation({ ...answer, hops: [{ ...answer.hops[0], from: 'wrong' }, answer.hops[1]] }, routes, context), null);
    assert.equal(parseBridgeInterpretation({ ...answer, suggestedConcepts: ['invented intermediate'] }, routes, context), null);
  });
  it('keeps suggestions for disconnected concepts separate from graph routes', () => {
    const disconnected = bridgePromptContext(index, 'A', 'isolated', []);
    const suggestion = { ...answer, routeRef: null, hops: [], suggestedConcepts: ['A possible intermediate concept'] };
    assert.equal(parseBridgeInterpretation(suggestion, [], disconnected)?.routeId, null);
    assert.equal(parseBridgeInterpretation({ ...suggestion, routeRef: 'r1' }, [], disconnected), null);
    assert.equal(parseBridgeInterpretation({ ...suggestion, hops: answer.hops }, [], disconnected), null);
    assert.deepEqual(findConceptBridges(index, 'A', 'isolated'), []);
  });
});

describe('Grok bridge requests', () => {
  it('uses one bounded request without tools, stored responses, or account identity', async () => {
    let calls = 0;
    const fetcher: typeof fetch = async (url, init) => {
      calls += 1;
      assert.equal(url, 'https://api.x.ai/v1/responses');
      const body = JSON.parse(String(init?.body));
      assert.equal(body.store, false);
      assert.equal(body.tools, undefined);
      assert.equal(body.max_output_tokens, 2400);
      const input = JSON.parse(body.input[1].content);
      assert.equal(input.ownerId, undefined);
      assert.equal(input.accessToken, undefined);
      return new Response(JSON.stringify({ output_text: JSON.stringify(answer) }), { headers: { 'x-zero-data-retention': 'true' } });
    };
    const result = await interpretConceptBridge(index, 'A', 'C', routes, { apiKey: 'inert-test-key', fetcher });
    assert.equal(calls, 1);
    assert.equal(result.zeroDataRetention, true);
    assert.equal(result.interpretation.routeId, routes[0].id);
  });
  it('handles structured output inside message content and rejects malformed responses', async () => {
    const fetcher: typeof fetch = async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }));
    assert.ok((await interpretConceptBridge(index, 'A', 'C', routes, { apiKey: 'inert-test-key', fetcher })).interpretation);
    for (const payload of [{ output_text: 'not JSON' }, { output_text: JSON.stringify({ ...answer, routeRef: 'made-up' }) }, {}]) {
      await assert.rejects(interpretConceptBridge(index, 'A', 'C', routes, { apiKey: 'inert-test-key', fetcher: async () => new Response(JSON.stringify(payload)) }));
    }
    await assert.rejects(interpretConceptBridge(index, 'A', 'C', routes, { apiKey: 'inert-test-key', fetcher: async () => new Response('private provider error', { status: 429 }) }), /Grok could not complete/);
  });
});
