import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { asIntent, asStale, asStaleMode, clampLimit, filterRows, intentCounts, keywordTopics, rowsFromGraph, rowsToMarkdown, topicCounts, type TableRow } from './bookmark-table.ts';

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

describe('why-saved intent and stale flag', () => {
  const rows: TableRow[] = [
    { ...row('1', 'try this cli'), intent: 'try', stale: false },
    { ...row('2', 'launch news'), intent: 'read', stale: true },
    { ...row('3', 'unlabeled'), intent: null, stale: null },
  ];
  it('filters by intent and stale mode', () => {
    assert.deepEqual(filterRows(rows, { intents: ['try'] }).map((r) => r.id), ['1']);
    assert.deepEqual(filterRows(rows, { intents: ['TRY', 'read'] }).map((r) => r.id), ['1', '2']);
    assert.deepEqual(filterRows(rows, { stale: 'hide' }).map((r) => r.id), ['1', '3'], 'unknown stays visible');
    assert.deepEqual(filterRows(rows, { stale: 'only' }).map((r) => r.id), ['2']);
    assert.equal(filterRows(rows, { stale: 'include' }).length, 3);
    assert.deepEqual(filterRows(rows, { intents: ['try'], stale: 'hide' }).map((r) => r.id), ['1']);
  });
  it('counts intents and parses stored values', () => {
    assert.deepEqual(intentCounts(rows), [{ id: 'try', count: 1 }, { id: 'read', count: 1 }]);
    assert.equal(asIntent('reference'), 'reference');
    assert.equal(asIntent('weather'), null);
    assert.equal(asIntent(null), null);
    assert.equal(asStale(1), true);
    assert.equal(asStale(0), false);
    assert.equal(asStale(null), null);
    assert.equal(asStaleMode('hide'), 'hide');
    assert.equal(asStaleMode('bogus'), 'include');
    assert.equal(asStaleMode(null), 'include');
  });
  it('exports why-saved and stale columns in Markdown', () => {
    const md = rowsToMarkdown(rows);
    assert.match(md, /\| Why saved \| Stale \|/);
    assert.match(md, /\| try \| actionable \|/);
    assert.match(md, /\| read \| stale \|/);
  });
  it('graph rows have unknown intent and stale', () => {
    const [r] = rowsFromGraph([{ id: 'bookmark:9', kind: 'source', label: 'x' }], []);
    assert.equal(r.intent, null);
    assert.equal(r.stale, null);
  });
});
