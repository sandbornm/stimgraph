import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildExploreIndex, connectionReason, exploreArrowAction, exploreConnections, exploreForwardConnections, explorePreview, exploreStarts,
  pruneExploreTrail, reconcileExploreOrder, visitExploreTrail, type ExploreNode,
} from './explore-model.ts';
import type { GraphEdge } from './graph-model.ts';

const node = (id: string, kind: ExploreNode['kind'] = 'topic'): ExploreNode => ({
  id, kind, label: id, note: '', evidence: '', size: 10,
});
const edge = (from: string, to: string, kind: GraphEdge['kind'] = 'evidence', weight = .8): GraphEdge => ({ from, to, kind, weight });
const nodes = [node('embedded'), node('firmware'), node('compilers'), node('binary-analysis'), node('bookmark:1', 'source'), node('author', 'person'), node('suggestion', 'scout')];
const edges = [edge('bookmark:1', 'embedded'), edge('bookmark:1', 'firmware'), edge('bookmark:1', 'author'), edge('firmware', 'compilers', 'affinity'), edge('compilers', 'binary-analysis', 'affinity'), edge('suggestion', 'firmware')];

describe('exploration branches', () => {
  it('ends a bookmark-author branch instead of offering an endless return to the bookmark', () => {
    const index = buildExploreIndex([node('saved-post', 'source'), node('author', 'person')], [edge('saved-post', 'author')]);
    assert.deepEqual(exploreForwardConnections(index, 'saved-post', new Set(['saved-post'])).map(({ node }) => node.id), ['author']);
    assert.deepEqual(exploreForwardConnections(index, 'author', new Set(['saved-post', 'author'])), []);
    assert.equal(exploreConnections(index, 'author')[0].node.id, 'saved-post');
  });

  it('excludes every ancestor while keeping new branches and off-trail revisits available', () => {
    const index = buildExploreIndex(nodes, [...edges, edge('compilers', 'embedded', 'affinity')]);
    const path = new Set(['embedded', 'bookmark:1', 'firmware', 'compilers']);
    assert.deepEqual(exploreForwardConnections(index, 'compilers', path).map(({ node }) => node.id), ['binary-analysis']);
    assert.equal(explorePreview(index, 'compilers', path)?.node.id, 'binary-analysis');
    assert.ok(exploreForwardConnections(index, 'firmware', new Set(['firmware'])).some(({ node }) => node.id === 'bookmark:1'));
  });
  it('lets the same bookmark belong to several topics without imposing a parent', () => {
    const index = buildExploreIndex(nodes, edges);
    assert.equal(exploreConnections(index, 'embedded')[0].node.id, 'bookmark:1');
    assert.ok(exploreConnections(index, 'firmware').some(({ node }) => node.id === 'bookmark:1'));
    assert.deepEqual(exploreConnections(index, 'bookmark:1').map(({ node }) => node.id).sort(), ['author', 'embedded', 'firmware']);
  });

  it('shows an actual next edge and never invents an ontology relationship', () => {
    const index = buildExploreIndex(nodes, edges);
    assert.equal(explorePreview(index, 'firmware', new Set(['bookmark:1', 'embedded']))?.node.id, 'compilers');
    assert.equal(exploreConnections(index, 'embedded').some(({ node }) => node.id === 'binary-analysis'), false);
    assert.equal(explorePreview(index, 'embedded', new Set(['bookmark:1'])), undefined);
  });

  it('keeps suggestions opt-in and distinguishes overlap from bookmark evidence', () => {
    const index = buildExploreIndex(nodes, edges);
    assert.equal(exploreConnections(index, 'firmware').some(({ node }) => node.kind === 'scout'), false);
    assert.equal(exploreConnections(index, 'firmware', true).some(({ node }) => node.kind === 'scout'), true);
    const root = index.nodes.get('firmware')!;
    const suggestion = index.nodes.get('suggestion')!;
    assert.match(connectionReason(root, suggestion, edge('firmware', 'suggestion')), /Scout suggestion/);
    assert.match(connectionReason(root, index.nodes.get('compilers')!, edge('firmware', 'compilers', 'affinity')), /Overlapping/);
  });

  it('ignores dangling links and self loops and deduplicates both directions', () => {
    const index = buildExploreIndex(nodes, [
      edge('firmware', 'missing'), edge('firmware', 'firmware'),
      edge('firmware', 'compilers', 'affinity', .99), edge('compilers', 'firmware', 'evidence', .3),
      edge('compilers', 'firmware', 'evidence', .7),
    ]);
    const links = exploreConnections(index, 'firmware');
    assert.equal(links.length, 1);
    assert.equal(links[0].edge.kind, 'evidence');
    assert.equal(links[0].edge.weight, .7);
    assert.equal(exploreConnections(index, 'compilers').length, 1);
  });

  it('handles empty graphs and isolated bookmarks as starting points', () => {
    assert.deepEqual(exploreStarts(buildExploreIndex([], []), 'topic'), []);
    const index = buildExploreIndex([node('bookmark:2', 'source'), node('bookmark:1', 'source')], []);
    assert.deepEqual(exploreStarts(index, 'source').map(({ id }) => id), ['bookmark:2', 'bookmark:1']);
    assert.deepEqual(exploreConnections(index, 'bookmark:2'), []);
  });

  it('does not route second-step previews through the following hub', () => {
    const index = buildExploreIndex([node('person:self', 'person'), node('person:a', 'person'), node('person:b', 'person')], [edge('person:self', 'person:a', 'follows'), edge('person:self', 'person:b', 'follows')]);
    assert.equal(explorePreview(index, 'person:a', new Set()), undefined);
  });

  it('appends stronger new connections without shuffling existing branches', () => {
    const before = exploreConnections(buildExploreIndex(nodes, edges), 'firmware').map(({ node }) => node.id);
    const expanded = buildExploreIndex([...nodes, node('new-save', 'source')], [...edges, edge('firmware', 'new-save', 'evidence', 1)]);
    const next = exploreConnections(expanded, 'firmware').map(({ node }) => node.id);
    assert.equal(next[0], 'new-save');
    assert.deepEqual(reconcileExploreOrder(before, next), [...before, 'new-save']);
    assert.deepEqual(reconcileExploreOrder(['a', 'b', 'c'], ['c', 'd', 'a']), ['a', 'c', 'd']);
  });

  it('keeps the visible next-step preview when stronger new links arrive', () => {
    const expanded = buildExploreIndex([...nodes, node('new-save', 'source')], [...edges, edge('firmware', 'new-save', 'evidence', 1)]);
    const excluded = new Set(['bookmark:1']);
    assert.equal(explorePreview(expanded, 'firmware', excluded, false, 'compilers')?.node.id, 'compilers');
    excluded.add('compilers');
    assert.equal(explorePreview(expanded, 'firmware', excluded, false, 'compilers')?.node.id, 'new-save');
  });
});

describe('exploration trail', () => {
  it('returns to an earlier step without appending a repeating cycle', () => {
    const trail = { steps: ['embedded', 'bookmark:1', 'author'], cursor: 2 };
    assert.deepEqual(visitExploreTrail(trail, ['bookmark:1']), { steps: ['embedded', 'bookmark:1'], cursor: 1 });
    const legacyLoop = { steps: ['embedded', 'bookmark:1', 'author', 'bookmark:1', 'author'], cursor: 4 };
    assert.deepEqual(visitExploreTrail(legacyLoop, ['bookmark:1']), { steps: ['embedded', 'bookmark:1'], cursor: 1 });
  });
  it('records both edges when jumping to a preview', () => {
    const trail = visitExploreTrail({ steps: ['embedded'], cursor: 0 }, ['bookmark:1', 'firmware']);
    assert.deepEqual(trail, { steps: ['embedded', 'bookmark:1', 'firmware'], cursor: 2 });
    assert.deepEqual(visitExploreTrail(trail, ['firmware']), trail);
  });

  it('replaces forward history when following a different branch after going back', () => {
    const trail = { steps: ['embedded', 'bookmark:1', 'firmware', 'compilers'], cursor: 1 };
    assert.deepEqual(visitExploreTrail(trail, ['author']), { steps: ['embedded', 'bookmark:1', 'author'], cursor: 2 });
    assert.deepEqual(trail.steps, ['embedded', 'bookmark:1', 'firmware', 'compilers']);
  });

  it('starts a new trail from the overview and bounds long sessions', () => {
    assert.deepEqual(visitExploreTrail({ steps: ['embedded', 'firmware'], cursor: -1 }, ['compilers']), { steps: ['compilers'], cursor: 0 });
    const trail = visitExploreTrail({ steps: [], cursor: -1 }, Array.from({ length: 100 }, (_, i) => String(i)));
    assert.equal(trail.steps.length, 80);
    assert.equal(trail.steps[0], '20');
    assert.equal(trail.cursor, 79);
  });

  it('keeps back and forward cursors valid when a graph update removes nodes', () => {
    const trail = { steps: ['embedded', 'bookmark:1', 'firmware', 'compilers'], cursor: 2 };
    assert.deepEqual(pruneExploreTrail(trail, new Set(['embedded', 'firmware', 'compilers'])), { steps: ['embedded', 'firmware', 'compilers'], cursor: 1 });
    assert.deepEqual(pruneExploreTrail(trail, new Set()), { steps: [], cursor: -1 });
  });
});

describe('orientation controls', () => {
  it('uses the flow direction for forward/back and the cross direction for choosing branches', () => {
    assert.deepEqual(['ArrowUp', 'ArrowDown', 'ArrowRight', 'ArrowLeft'].map((key) => exploreArrowAction('LR', key)), ['previous', 'next', 'follow', 'back']);
    assert.deepEqual(['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp'].map((key) => exploreArrowAction('TB', key)), ['previous', 'next', 'follow', 'back']);
    assert.equal(exploreArrowAction('LR', 'Enter'), null);
    assert.equal(exploreArrowAction('TB', 'Escape'), null);
  });
});
