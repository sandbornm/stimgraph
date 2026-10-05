import assert from 'node:assert/strict';
import { it } from 'node:test';
import { bookmarkSnippet } from './bookmark-display.ts';

it('shows a matching passage beyond the opening excerpt and preserves phrase highlights', () => {
  const source = `${'Earlier context. '.repeat(40)}A guide to machine learning with evidence. ${'Later context. '.repeat(30)}`;
  const snippet = bookmarkSnippet(source, '"machine learning"');
  assert.ok(snippet.text.startsWith('…'));
  assert.ok(snippet.text.endsWith('…'));
  assert.ok(snippet.text.length <= 212);
  assert.deepEqual(snippet.matches.map(([start, end]) => snippet.text.slice(start, end)), ['machine learning']);
});

it('keeps literal punctuation and merges overlapping highlights without duplicating text', () => {
  const snippet = bookmarkSnippet('Machine learning is 100% useful_method.', 'machine learning % _');
  const highlights = snippet.matches.map(([start, end]) => snippet.text.slice(start, end));
  assert.deepEqual(highlights, ['Machine', 'learning', '%', '_']);
  assert.deepEqual(bookmarkSnippet('Machine learning', 'machine learning').matches, [[0, 16]]);
  assert.deepEqual(bookmarkSnippet('  A short\n post. ', ''), { text: 'A short post.', matches: [] });
  assert.deepEqual(bookmarkSnippet('A short post.', 'author'), { text: 'A short post.', matches: [] });
});
