import assert from 'node:assert/strict';
import test from 'node:test';
import { searchNearbyWork } from './nearby-work.ts';
import { generateResearchCard } from './xai-research.ts';

test('Crossref receives only a bibliographic query and returns bounded normalized metadata', async () => {
  const result = await searchNearbyWork('small proofs memory', async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, 'https://api.crossref.org');
    assert.equal(url.searchParams.get('query.bibliographic'), 'small proofs memory');
    assert.equal(url.searchParams.get('rows'), '5');
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    return Response.json({ message: { items: [
      { DOI: '10.1234/test', title: ['<i>Small proofs</i>'], author: [null, { given: 'A', family: 'Author' }], published: { 'date-parts': [[2025, 1]] } },
      { DOI: 'https://bad.example', title: ['Invalid DOI'] }, { DOI: '10.1234/empty', title: ['<i></i>'] }, null,
    ] } });
  });
  assert.equal(result.provider, 'Crossref');
  assert.equal(result.query, 'small proofs memory');
  assert.equal(result.works.length, 1);
  assert.deepEqual(result.works[0], { doi: '10.1234/test', title: 'Small proofs', authors: 'A Author', year: 2025 });
  assert.ok(result.checkedAt > 0);
});

test('empty metadata is a completed empty search; provider errors are not search results', async () => {
  assert.deepEqual((await searchNearbyWork('obscure', async () => Response.json({ message: { items: [] } }))).works, []);
  await assert.rejects(searchNearbyWork('obscure', async () => new Response('', { status: 429 })), /No literature check was completed/);
  await assert.rejects(searchNearbyWork('obscure', async () => Response.json({ message: {} })), /unreadable results/);
});

test('Grok receives opaque references and annotations, no identity or search tools, and store false', async () => {
  const sources = [
    { id: 'bookmark:private-a', label: 'Private author A', excerpt: 'Local proof checks each step.' },
    { id: 'bookmark:private-b', label: 'Private author B', excerpt: 'Memory limits affect validation.' },
  ];
  const result = await generateResearchCard(sources, { 'bookmark:private-a': 'disagree' }, 'method_transfer', 'far', {
    apiKey: 'inert-provider-test-key', fetcher: async (input, init) => {
      assert.equal(input, 'https://api.x.ai/v1/responses');
      const raw = String(init?.body);
      const request = JSON.parse(raw);
      assert.equal(request.store, false);
      assert.equal(request.tools, undefined);
      assert.equal(raw.includes('private-a'), false);
      assert.equal(raw.includes('Private author'), false);
      const inputData = JSON.parse(request.input[1].content);
      assert.equal(inputData.sources[0].ref, 's1');
      assert.equal(inputData.sources[0].whySaved, 'I disagree');
      return Response.json({ output_text: JSON.stringify({ question: 'Can local proofs reduce memory?', method: 'Local proofs', problem: 'Limited memory', connection: 'Try local checking', firstTest: 'A toy comparison', assumptions: ['Checks compose'], counterexamples: ['Global constraints'], searchQuery: 'local proof memory', sources: [
        { ref: 's1', role: 'method', quote: sources[0].excerpt, reason: 'Checking method' }, { ref: 's2', role: 'problem', quote: sources[1].excerpt, reason: 'Memory constraint' },
      ] }) });
    },
  });
  assert.equal(result.card.sources[0].intent, 'disagree');
  assert.equal(result.card.nearby, null);
  assert.equal(result.zeroDataRetention, false);
});

test('Grok responses without verifiable evidence fail closed', async () => {
  const sources = [{ id: 'bookmark:a', label: 'A', excerpt: 'A saved source excerpt.' }, { id: 'bookmark:b', label: 'B', excerpt: 'Another saved source excerpt.' }];
  await assert.rejects(generateResearchCard(sources, {}, 'tension', 'close', { apiKey: 'inert-provider-test-key', fetcher: async () => Response.json({ output_text: '{"question":"Novel idea","sources":[]}' }) }), /could not be verified/);
});
