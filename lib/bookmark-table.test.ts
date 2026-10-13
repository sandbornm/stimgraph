import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampLimit, filterRows, keywordTopics, rowsFromGraph, rowsToMarkdown, topicCounts, type TableRow } from './bookmark-table.ts';

const row = (id: string, text: string, topics: TableRow['topics'] = [], handle = 'ada'): TableRow => ({ id, author: 'Ada', handle, text, createdAt: '2026-01-02T00:00:00Z', url: `https://x.com/${handle}/status/${id}`, topics });

describe('bookmark table', () => {
  it('filters by query, topic and author', () => {
    const rows = [row('1', 'Rust compilers', [{ id: 'rust', label: 'Rust' }]), row('2', 'Typescript tips', [], 'bob')];
    assert.deepEqual(filterRows(rows, { q: 'rust' }).map((r) => r.id), ['1']);
    assert.deepEqual(filterRows(rows, { topics: ['rust'] }).map((r) => r.id), ['1']);
    assert.deepEqual(filterRows(rows, { topics: ['Rust'] }).map((r) => r.id), ['1']);
    assert.deepEqual(filterRows(rows, { author: '@bob' }).map((r) => r.id), ['2']);
    assert.equal(filterRows(rows, {}).length, 2);
  });
  it('clusters keywords only for untagged rows', () => {
    const rows = keywordTopics([row('1', 'agents and evals'), row('2', 'better evals for agents'), row('3', 'x', [{ id: 't', label: 'T' }])], 12, 2);
    assert.ok(rows[0].topics.some((t) => t.label === 'evals'));
    assert.deepEqual(rows[2].topics, [{ id: 't', label: 'T' }]);
  });
  it('drops filler words and keywords seen fewer than three times', () => {
    const rows = keywordTopics([
      row('1', 'Been working on agents today, years of time'),
      row('2', 'agents post: been a good time today'),
      row('3', 'agents everywhere, been years'),
      row('4', 'evals and agents'),
    ]);
    const labels = new Set(rows.flatMap((r) => r.topics.map((t) => t.label)));
    assert.deepEqual([...labels], ['agents']);
  });
  it('extracts hashtags, ignores urls, mentions and numbers', () => {
    const rows = keywordTopics([
      row('1', '#x402 payments https://a.co/x402 @x402bot 2026'),
      row('2', 'x402 payments for agents 2026'),
      row('3', 'more x402 payments 2026'),
    ]);
    const labels = new Set(rows.flatMap((r) => r.topics.map((t) => t.label)));
    assert.deepEqual([...labels].sort(), ['payments', 'x402']);
  });
  it('counts topics and clamps limits', () => {
    assert.deepEqual(topicCounts([row('1', 'a', [{ id: 'x', label: 'X' }]), row('2', 'b', [{ id: 'x', label: 'X' }])]), [{ id: 'x', label: 'X', count: 2 }]);
    assert.equal(clampLimit('9999'), 500);
    assert.equal(clampLimit('nope'), 50);
  });
  it('builds rows from a graph and renders markdown', () => {
    const rows = rowsFromGraph(
      [
        { id: 'bookmark:9', kind: 'source', label: 'L', note: 'full | text', evidence: 'Saved from @ada · Jan 2026', url: 'https://x.com/ada/status/9' },
        { id: 'person:1', kind: 'person', label: 'Ada · @ada' },
        { id: 'topic:ml', kind: 'topic', label: 'ML' },
      ],
      [{ from: 'bookmark:9', to: 'person:1' }, { from: 'bookmark:9', to: 'topic:ml' }],
    );
    assert.equal(rows[0].handle, 'ada');
    assert.deepEqual(rows[0].topics, [{ id: 'ml', label: 'ML' }]);
    assert.match(rowsToMarkdown(rows), /full \\\| text/);
  });
});
