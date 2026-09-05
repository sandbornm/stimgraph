import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildExploreIndex, type ExploreNode } from './explore-model.ts';
import { captureTrajectory, parseTrajectoryDraft, resumeTrajectory, trajectoryFrontier, trajectoryMarkdown, trajectoryName } from './trajectory-model.ts';
import type { GraphEdge } from './graph-model.ts';

const node = (id: string, kind: ExploreNode['kind'] = 'topic'): ExploreNode => ({ id, kind, label: id, note: 'Full saved text must stay out of outlines', evidence: '', size: 1 });
const edge = (from: string, to: string, kind: GraphEdge['kind'] = 'evidence'): GraphEdge => ({ from, to, kind, weight: .8 });
const nodes = [node('embedded'), node('post:1', 'source'), node('firmware'), node('compilers'), node('post:2', 'source'), node('author', 'person'), node('scout', 'scout')];
const edges = [edge('embedded', 'post:1'), edge('post:1', 'firmware'), edge('firmware', 'compilers', 'affinity'), edge('post:2', 'embedded'), edge('post:2', 'firmware'), edge('author', 'post:1'), edge('scout', 'firmware')];
const index = buildExploreIndex(nodes, edges);
const trail = { steps: ['embedded', 'post:1', 'firmware', 'compilers'], cursor: 3 };
const steps = captureTrajectory(index, trail);
const draft = { name: 'Embedded to compilers', question: 'What connects these ideas?', steps };

describe('concept trajectories', () => {
  it('captures the active path with evidence without retaining full post text', () => {
    const snapshot = captureTrajectory(index, { ...trail, cursor: 2 });
    assert.deepEqual(snapshot.map((step) => step.id), ['embedded', 'post:1', 'firmware']);
    assert.equal(snapshot[0].via, null);
    assert.equal(snapshot[1].via?.reason, 'A bookmark on this topic');
    assert.equal(steps[3].via?.kind, 'affinity');
    assert.equal(JSON.stringify(snapshot).includes('Full saved text'), false);
    assert.equal(trajectoryName(snapshot), 'embedded → firmware');
  });

  it('marks search jumps as new starting points instead of inventing evidence', () => {
    const jumped = captureTrajectory(index, { steps: ['embedded', 'compilers'], cursor: 1 });
    assert.equal(jumped[1].via, null);
    assert.deepEqual(resumeTrajectory(index, jumped, 1).steps, ['compilers']);
    assert.match(trajectoryMarkdown({ ...draft, steps: jumped }), /no recorded connection/);
  });

  it('resumes or branches without modifying the saved path', () => {
    const next = resumeTrajectory(index, steps, 1);
    next.steps.push('author');
    assert.deepEqual(next.steps, ['embedded', 'post:1', 'author']);
    assert.deepEqual(steps.map((step) => step.id), trail.steps);
  });

  it('preserves gaps after a graph update and resumes only a connected portion', () => {
    const missing = buildExploreIndex(nodes.filter((node) => node.id !== 'post:1'), edges);
    assert.deepEqual(resumeTrajectory(missing, steps, 3), { steps: ['firmware', 'compilers'], cursor: 1 });
    assert.deepEqual(resumeTrajectory(missing, steps, 1), { steps: [], cursor: -1 });
    const disconnected = buildExploreIndex(nodes, edges.filter((edge) => edge.to !== 'compilers'));
    assert.deepEqual(resumeTrajectory(disconnected, steps, 3).steps, ['compilers']);
    assert.equal(steps.length, 4);
  });

  it('finds unvisited evidence-backed bookmarks beside the path once per post', () => {
    const frontier = trajectoryFrontier(index, steps, new Set());
    assert.deepEqual(frontier.map(({ node }) => node.id), ['post:2']);
    assert.equal(frontier[0].from.id, 'firmware');
    assert.deepEqual(trajectoryFrontier(index, steps, new Set(['post:2'])), []);
    const overlapsOnly = buildExploreIndex(nodes, [...edges, edge('compilers', 'post:2', 'affinity')]);
    assert.equal(trajectoryFrontier(overlapsOnly, steps, new Set())[0].from.id, 'firmware');
  });

  it('validates bounded snapshots and rejects duplicate stops and malformed edges', () => {
    assert.deepEqual(parseTrajectoryDraft(draft), draft);
    for (const invalid of [null, {}, { ...draft, name: ' ' }, { ...draft, name: 'a'.repeat(121) },
      { ...draft, question: 'a'.repeat(2001) }, { ...draft, steps: [] }, { ...draft, steps: [steps[0]] },
      { ...draft, steps: [...steps, steps[0]] }, { ...draft, steps: [steps[0], { ...steps[1], kind: 'unknown' }] },
      { ...draft, steps: [steps[0], { ...steps[1], via: { kind: 'evidence', reason: 123 } }] },
      { ...draft, steps: [{ ...steps[0], via: steps[1].via }, steps[1]] },
    ]) assert.equal(parseTrajectoryDraft(invalid), null);
    assert.equal(parseTrajectoryDraft({ ...draft, ownerId: 'other-account' })?.name, draft.name);
    assert.equal('ownerId' in parseTrajectoryDraft({ ...draft, ownerId: 'other-account' })!, false);
  });

  it('exports a readable outline and escapes HTML and Markdown from saved labels', () => {
    const markdown = trajectoryMarkdown({ ...draft, question: '<script>hello</script> [open](https://example.com)' });
    assert.match(markdown, /1\. embedded \(topic\)/);
    assert.match(markdown, /Overlapping bookmark patterns/);
    assert.equal(markdown.includes('<script>'), false);
    assert.equal(markdown.includes('[open]'), false);
    assert.equal(markdown.includes('Full saved text'), false);
  });
});
