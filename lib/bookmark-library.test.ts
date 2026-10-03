import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { filterDemoLibrary, libraryFilter, libraryOrder, parseLibraryQuery, type LibraryBookmark } from './bookmark-library.ts';

function collection() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bookmarks(owner_id TEXT, post_id TEXT, text TEXT, author_username TEXT, author_name TEXT, created_at TEXT, synced_at INTEGER);
    CREATE TABLE bookmark_topics(owner_id TEXT, post_id TEXT, topic_id TEXT);
    CREATE TABLE topics(owner_id TEXT, id TEXT, label TEXT);
    INSERT INTO bookmarks VALUES
      ('a', '1', '100% useful_method', 'alice', 'Alice', '2020-01-01', 300),
      ('a', '2', 'A recent post', 'bob', 'Bob', '2026-01-01', 100),
      ('b', '3', 'Private other collection', 'alice', 'Alice', '2026-01-01', 500);
    INSERT INTO topics VALUES ('a', 'tools', 'Tools for thought'), ('b', 'tools', 'Private topic');
    INSERT INTO bookmark_topics VALUES ('a', '1', 'tools'), ('b', '3', 'tools');`);
  return db;
}

it('searches text, authors and topics with owner isolation and literal wildcards', () => {
  const db = collection();
  try {
    for (const [query, expected] of [['Alice', ['1']], ['Tools', ['1']], ['%', ['1']], ['_', ['1']], ['Private', []]] as const) {
      const options = parseLibraryQuery(new URLSearchParams({ q: query }));
      const { where, values } = libraryFilter('a', options);
      assert.deepEqual(db.prepare(`SELECT b.post_id FROM bookmarks b WHERE ${where}`).all(...values).map((row) => row.post_id), expected);
    }
  } finally { db.close(); }
});

it('separates import recency from post publication date and filters new or untagged material', () => {
  const db = collection();
  const ids = (params: Record<string, string>) => {
    const options = parseLibraryQuery(new URLSearchParams(params));
    const { where, values } = libraryFilter('a', options);
    return db.prepare(`SELECT b.post_id FROM bookmarks b WHERE ${where} ORDER BY ${libraryOrder(options.sort)}`).all(...values).map((row) => row.post_id);
  };
  try {
    assert.deepEqual(ids({ sort: 'imported' }), ['1', '2']);
    assert.deepEqual(ids({ sort: 'newest' }), ['2', '1']);
    assert.deepEqual(ids({ sort: 'oldest' }), ['1', '2']);
    assert.deepEqual(ids({ since: '200' }), ['1']);
    assert.deepEqual(ids({ topic: '__untagged' }), ['2']);
    assert.deepEqual(ids({ topic: 'tools' }), ['1']);
  } finally { db.close(); }
});

it('normalizes untrusted pagination and sort parameters', () => {
  for (const value of ['-1', 'NaN', 'Infinity', '1.5']) {
    const query = parseLibraryQuery(new URLSearchParams({ offset: value, since: value, sort: 'invalid' }));
    assert.equal(query.offset, 0); assert.equal(query.since, 0); assert.equal(query.sort, 'imported');
  }
  assert.equal(parseLibraryQuery(new URLSearchParams({ q: 'x'.repeat(500) })).query.length, 200);
});

it('pages the full collection beyond the old 16-row directory and keeps ordering stable', () => {
  const items: LibraryBookmark[] = Array.from({ length: 65 }, (_, index) => ({
    postId: String(index).padStart(3, '0'), authorId: 'a', authorUsername: 'alice', authorName: 'Alice',
    text: `Bookmark ${index}`, createdAt: null, importedAt: 100, topics: [],
  }));
  const options = parseLibraryQuery(new URLSearchParams());
  const first = filterDemoLibrary(items, options);
  const second = filterDemoLibrary(items, { ...options, offset: first.nextOffset! });
  const third = filterDemoLibrary(items, { ...options, offset: second.nextOffset! });
  assert.equal(first.total, 65);
  assert.equal(new Set([...first.items, ...second.items, ...third.items].map((item) => item.postId)).size, 65);
  assert.equal(third.nextOffset, null);
});
