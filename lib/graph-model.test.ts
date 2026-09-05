import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SELF_NODE_ID,
  buildFollowsEdges,
  collectNeighborhoodIds,
  matchScore,
  parseSearch,
  rankSearchHits,
} from './graph-model.ts';

describe('buildFollowsEdges', () => {
  it('links you to followed people with a follows kind, heavier for follow-only accounts', () => {
    const edges = buildFollowsEdges(SELF_NODE_ID, [
      { id: 'person:a', kind: 'person', followed: true, evidence: '3 bookmarks · Following' },
      { id: 'person:b', kind: 'person', followed: true, evidence: 'Following · From X' },
      { id: 'person:c', kind: 'person', followed: false, evidence: '2 bookmarks · From X' },
      { id: SELF_NODE_ID, kind: 'person', followed: false, evidence: 'You · this map' },
    ]);
    assert.equal(edges.length, 2);
    assert.ok(edges.every((edge) => edge.kind === 'follows' && edge.from === SELF_NODE_ID));
    const author = edges.find((edge) => edge.to === 'person:a');
    const island = edges.find((edge) => edge.to === 'person:b');
    assert.ok(author && island);
    assert.ok(island.weight > author.weight);
    assert.equal(edges.some((edge) => edge.to === 'person:c'), false);
  });
});

describe('collectNeighborhoodIds', () => {
  const nodes = [
    { id: SELF_NODE_ID },
    { id: 'person:island' },
    { id: 'person:other' },
    { id: 'topic:tools' },
    { id: 'bookmark:1' },
  ];
  const edges = [
    { from: SELF_NODE_ID, to: 'person:island', weight: 0.56, kind: 'follows' as const },
    { from: SELF_NODE_ID, to: 'person:other', weight: 0.34, kind: 'follows' as const },
    { from: 'person:other', to: 'topic:tools', weight: 0.8, kind: 'evidence' as const },
    { from: 'bookmark:1', to: 'person:other', weight: 0.38, kind: 'evidence' as const },
  ];

  it('reaches a follow-only person from you in one step', () => {
    const ids = collectNeighborhoodIds(SELF_NODE_ID, nodes, edges, 1);
    assert.equal(ids.has('person:island'), true);
    assert.equal(ids.has('person:other'), true);
    assert.equal(ids.has('topic:tools'), false);
  });

  it('attaches you to a follow-only person without flooding the rest of following', () => {
    const ids = collectNeighborhoodIds('person:island', nodes, edges, 2);
    assert.equal(ids.has(SELF_NODE_ID), true);
    assert.equal(ids.has('person:other'), false);
    assert.equal(ids.has('topic:tools'), false);
  });

  it('still walks evidence links as an undirected neighborhood', () => {
    const ids = collectNeighborhoodIds('topic:tools', nodes, edges, 2);
    assert.equal(ids.has('person:other'), true);
    assert.equal(ids.has('bookmark:1'), true);
    assert.equal(ids.has('person:island'), false);
  });
});

describe('search', () => {
  it('parses @ # * : and ~ prefixes', () => {
    assert.deepEqual(parseSearch('@rev'), { needle: 'rev', kind: 'person' });
    assert.deepEqual(parseSearch('#mem'), { needle: 'mem', kind: 'topic' });
    assert.deepEqual(parseSearch('*scout'), { needle: 'scout', kind: 'scout' });
    assert.deepEqual(parseSearch(':sync'), { needle: 'sync', kind: 'command' });
    assert.deepEqual(parseSearch('~alice'), { needle: 'alice', kind: 'following' });
  });

  it('scores prefix and token starts above mid-string hits', () => {
    assert.ok(matchScore('Reverse engineering', 'rev') > matchScore('the preview pane', 'rev'));
    assert.ok(matchScore('Mira Fields · @mirafields', 'mira') > matchScore('something mira-adjacent', 'mira'));
  });

  it('ranks label hits first and can filter to following', () => {
    const hits = rankSearchHits('rev', [
      { id: 'topic:reverse-engineering', label: 'Reverse engineering', kind: 'topic', note: 'A topic.', evidence: '12 bookmarks', size: 16, searchLabel: 'reverse engineering' },
      { id: 'person:preview', label: 'Preview Bot · @preview', kind: 'person', note: 'Mentions reverse in passing.', evidence: 'Following · From X', size: 5, followed: true, searchLabel: 'preview bot · @preview' },
      { id: 'cmd:sync', label: 'Sync', kind: 'command', note: '', evidence: '', size: 1, searchLabel: 'sync' },
    ], [
      { id: 'cmd:sync', label: 'Sync', detail: 'Pull bookmarks from X' },
    ]);
    assert.equal(hits[0]?.id, 'topic:reverse-engineering');
    const following = rankSearchHits('~', [
      { id: 'person:a', label: 'Ada · @ada', kind: 'person', note: '', evidence: 'Following · From X', size: 5, followed: true, searchLabel: 'ada · @ada' },
      { id: 'person:b', label: 'Bea · @bea', kind: 'person', note: '', evidence: '2 bookmarks · From X', size: 8, followed: false, searchLabel: 'bea · @bea' },
    ], []);
    assert.deepEqual(following.map((hit) => hit.id), ['person:a']);
  });
});
