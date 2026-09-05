import assert from 'node:assert/strict';
import test from 'node:test';
import { buildExploreIndex, type ExploreNode } from './explore-model.ts';
import { blankResearchCard, parseGeneratedResearch, parseResearchDraft, researchExcerpt, researchMarkdown, suggestResearchSources, type ResearchSource } from './research-model.ts';

const sources: ResearchSource[] = [
  { id: 'bookmark:a', label: 'A method', excerpt: 'A small proof checks every transformation in the pipeline.' },
  { id: 'bookmark:b', label: 'A problem', excerpt: 'Memory limits make full validation costly for small devices.' },
];
const generated = {
  question: 'Can small proofs reduce the cost of checking transformations?', method: 'Check each transformation.', problem: 'Limited memory.',
  connection: 'Try carrying a local proof through a toy pipeline.', firstTest: 'Compare peak memory on a tiny synthetic example.',
  assumptions: ['Local checks compose.'], counterexamples: ['Global constraints break composition.'], searchQuery: 'proof carrying transformations bounded memory',
  sources: [{ ref: 's1', role: 'method', quote: 'A small proof checks every transformation', reason: 'Supplies a checking method.' },
    { ref: 's2', role: 'problem', quote: 'Memory limits make full validation costly', reason: 'Names the constraint.' }],
};

test('generated cards bind citations to supplied sources and retain disagreement', () => {
  const card = parseGeneratedResearch(generated, sources, { 'bookmark:a': 'disagree' }, 'method_transfer', 'far');
  assert.ok(card);
  assert.equal(card.sources[0].id, 'bookmark:a');
  assert.equal(card.sources[0].intent, 'disagree');
  assert.equal(card.nearby, null);
  assert.equal(card.reach, 'far');
  assert.equal('ref' in card.sources[0], false);
});

test('generated cards reject invented references, quotations, duplicates, and unsupported source roles', () => {
  for (const patch of [{ ref: 's999' }, { quote: 'An invented claim not in the source' }, { quote: 'proof' }, { role: 'proven' }]) {
    assert.equal(parseGeneratedResearch({ ...generated, sources: [{ ...generated.sources[0], ...patch }, generated.sources[1]] }, sources, {}, 'method_transfer', 'close'), null);
  }
  assert.equal(parseGeneratedResearch({ ...generated, sources: [generated.sources[0], generated.sources[0]] }, sources, {}, 'method_transfer', 'close'), null);
  assert.ok(parseGeneratedResearch({ ...generated, sources: [{ ...generated.sources[0], quote: 'A small proof\nchecks every transformation' }, generated.sources[1]] }, sources, {}, 'method_transfer', 'close'));
});

test('manual cards require a question and bounded bookmark evidence but allow honest empty fields', () => {
  const blank = blankResearchCard(sources, {}, 'tension', 'close');
  assert.equal(parseResearchDraft(blank), null);
  const valid = { ...blank, question: 'What differs between these claims?' };
  assert.ok(parseResearchDraft(valid));
  for (const patch of [{ sources: [blank.sources[0]] }, { question: 'q'.repeat(501) }, { assumptions: Array(6).fill('A') }, { notes: 'n'.repeat(3001) }, { lens: '__proto__' }]) {
    assert.equal(parseResearchDraft({ ...valid, ...patch }), null);
  }
  assert.equal(parseResearchDraft({ ...valid, sources: [{ ...blank.sources[0], id: 'person:someone' }, blank.sources[1]] }), null);
});

test('nearby-work snapshots preserve the actual query and reject unsafe or invalid records', () => {
  const valid = { ...blankResearchCard(sources, {}, 'shared_problem', 'close'), question: 'A question', searchQuery: 'edited query',
    nearby: { provider: 'Crossref', query: 'original query', checkedAt: 1770000000000, works: [{ doi: '10.1234/abc', title: 'A paper', authors: 'A. Author', year: 2025 }] } };
  assert.equal(parseResearchDraft(valid)?.nearby?.query, 'original query');
  for (const checkedAt of [NaN, Infinity, -1, 1e20]) assert.equal(parseResearchDraft({ ...valid, nearby: { ...valid.nearby, checkedAt } }), null);
  assert.equal(parseResearchDraft({ ...valid, nearby: { ...valid.nearby, works: [{ ...valid.nearby.works[0], doi: 'javascript:alert(1)' }] } }), null);
});

test('source suggestions rank topic overlap and exclude people, scouts, and following shortcuts', () => {
  const node = (id: string, kind: ExploreNode['kind']): ExploreNode => ({ id, kind, label: id, note: '', evidence: '', size: 1 });
  const index = buildExploreIndex([node('bookmark:a', 'source'), node('bookmark:b', 'source'), node('bookmark:c', 'source'), node('topic:a', 'topic'), node('person:a', 'person'), node('scout:a', 'scout')], [
    { from: 'bookmark:a', to: 'topic:a', kind: 'evidence', weight: 1 }, { from: 'bookmark:b', to: 'topic:a', kind: 'evidence', weight: 1 },
    { from: 'bookmark:c', to: 'topic:a', kind: 'affinity', weight: 100 }, { from: 'scout:a', to: 'topic:a', kind: 'evidence', weight: 100 },
  ]);
  assert.deepEqual(suggestResearchSources(index, 'bookmark:a', 'close'), ['bookmark:a', 'bookmark:b', 'bookmark:c']);
  assert.deepEqual(suggestResearchSources(index, 'bookmark:a', 'far'), ['bookmark:a', 'bookmark:c', 'bookmark:b']);
});

test('excerpts redact links and handles and exports keep evidence separate from a novelty claim', () => {
  const excerpt = researchExcerpt('@someone See https://example.com/private for a method. ' + 'a'.repeat(900));
  assert.equal(excerpt.length, 800);
  assert.equal(excerpt.includes('@someone'), false);
  assert.equal(excerpt.includes('example.com'), false);
  const card = parseGeneratedResearch(generated, sources, {}, 'method_transfer', 'close')!;
  const output = researchMarkdown({ ...card, question: '<script> [fake](javascript:test)' });
  assert.match(output, /\\<script\\>/);
  assert.match(output, /Smallest investigation/);
  assert.match(output, /Not checked/);
  assert.match(output, /not a claim of novelty/);
  assert.match(output, /A small proof checks every transformation/);
  const linked = researchMarkdown({ ...card, sources: [{ ...card.sources[0], id: 'bookmark:12345' }, card.sources[1]] });
  assert.match(linked, /https:\/\/x.com\/i\/status\/12345/);
});
