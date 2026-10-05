import assert from 'node:assert/strict';
import { it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { filterDemoLibrary, LIBRARY_PAGE_SIZE, libraryFilter, libraryOrder, parseLibraryQuery, type LibraryBookmark } from './bookmark-library.ts';
import { bookmarkSearchRank } from './bookmark-search.ts';

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
  assert.equal(parseLibraryQuery(new URLSearchParams({ q: 'tools' })).sort, 'relevance');
  assert.equal(parseLibraryQuery(new URLSearchParams({ q: 'tools', sort: 'imported' })).sort, 'imported');
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

function rankedCollection(items: LibraryBookmark[]) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bookmarks(owner_id TEXT, post_id TEXT, text TEXT, author_username TEXT, author_name TEXT, created_at TEXT, synced_at INTEGER);
    CREATE TABLE bookmark_topics(owner_id TEXT, post_id TEXT, topic_id TEXT);
    CREATE TABLE topics(owner_id TEXT, id TEXT, label TEXT, PRIMARY KEY(owner_id, id));`);
  for (const item of items) {
    db.prepare('INSERT INTO bookmarks VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run('owner', item.postId, item.text, item.authorUsername, item.authorName, item.createdAt, item.importedAt);
    for (const topic of item.topics) {
      db.prepare('INSERT OR IGNORE INTO topics VALUES (?, ?, ?)').run('owner', topic.id, topic.label);
      db.prepare('INSERT INTO bookmark_topics VALUES (?, ?, ?)').run('owner', item.postId, topic.id);
    }
  }
  return db;
}

function bookmark(postId: string, text: string, changes: Partial<LibraryBookmark> = {}): LibraryBookmark {
  return { postId, text, authorId: 'a', authorUsername: 'alice', authorName: 'Alice', createdAt: null, importedAt: 100, topics: [], ...changes };
}

function searchDatabase(db: DatabaseSync, params: Record<string, string>) {
  const options = parseLibraryQuery(new URLSearchParams(params));
  const { where, values } = libraryFilter('owner', options);
  const rank = bookmarkSearchRank(options.sort === 'relevance' ? options.query : '');
  return db.prepare(`SELECT b.post_id, ${rank.sql} AS relevance FROM bookmarks b WHERE ${where}
    ORDER BY ${libraryOrder(options.sort)} LIMIT ? OFFSET ?`)
    .all(...rank.values, ...values, LIBRARY_PAGE_SIZE, options.offset).map((row) => row.post_id);
}

const searchItems = [
  bookmark('phrase', 'A practical guide to machine learning', { importedAt: 1, createdAt: '2020-01-01' }),
  bookmark('reordered', 'Learning to build a machine', { importedAt: 20, createdAt: '2025-01-01' }),
  bookmark('split', 'A new learning guide', { authorUsername: 'machine', importedAt: 30, createdAt: '2026-01-01' }),
  bookmark('topic', 'Machine notes', { topics: [{ id: 'learn', label: 'Learning', confidence: 100 }], importedAt: 40 }),
  bookmark('partial', 'Learning without the other word', { importedAt: 50 }),
];

it('finds every query word across fields and puts the original phrase ahead of newer loose matches', () => {
  const db = rankedCollection(searchItems);
  try {
    const ids = searchDatabase(db, { q: 'machine learning' });
    assert.equal(ids[0], 'phrase');
    assert.deepEqual(new Set(ids), new Set(['phrase', 'reordered', 'split', 'topic']));
    assert.deepEqual(searchDatabase(db, { q: '"machine learning"' }), ['phrase']);
    assert.deepEqual(searchDatabase(db, { q: 'machine learning', sort: 'imported' }), ['topic', 'split', 'reordered', 'phrase']);
    assert.deepEqual(searchDatabase(db, { q: 'machine learning', sort: 'newest' }), ['split', 'reordered', 'phrase', 'topic']);
    assert.deepEqual(searchDatabase(db, { q: 'machine learning', sort: 'oldest' }), ['phrase', 'reordered', 'split', 'topic']);
  } finally { db.close(); }
});

it('ranks exact author and topic lookups above incidental metadata substrings', () => {
  const db = rankedCollection([
    bookmark('exact', 'Saved notes', { authorUsername: 'rust' }),
    bookmark('topic', 'Saved notes', { topics: [{ id: 'rust', label: 'Rust', confidence: 100 }] }),
    bookmark('substring', 'Saved notes', { authorUsername: 'trustworthy', importedAt: 900 }),
  ]);
  try { assert.deepEqual(searchDatabase(db, { q: 'rust' }), ['exact', 'topic', 'substring']); }
  finally { db.close(); }
});

it('retains repeated words in the phrase bonus without requiring them in loose matches', () => {
  const items = [
    bookmark('phrase', 'Quoted: to be or not to be.', { importedAt: 1 }),
    bookmark('loose', 'Quoted: to be or not.', { importedAt: 999 }),
  ];
  const db = rankedCollection(items);
  try {
    const params = { q: 'to be or not to be' };
    assert.deepEqual(searchDatabase(db, params), ['phrase', 'loose']);
    assert.deepEqual(filterDemoLibrary(items, parseLibraryQuery(new URLSearchParams(params))).items.map((item) => item.postId), ['phrase', 'loose']);
  } finally { db.close(); }
});

it('keeps ranked results and topic signals inside the owner collection', () => {
  const db = rankedCollection([bookmark('shared-id', 'Learning'), bookmark('own', 'Machine learning')]);
  db.exec(`INSERT INTO bookmarks VALUES ('other', 'private', 'Machine learning', 'machine', 'Machine learning', NULL, 9999);
    INSERT INTO topics VALUES ('other', 'private-topic', 'Machine learning');
    INSERT INTO bookmark_topics VALUES ('other', 'shared-id', 'private-topic');`);
  try { assert.deepEqual(searchDatabase(db, { q: 'machine learning' }), ['own']); }
  finally { db.close(); }
});

it('matches the database and demo ordering for words, phrases, literals, filters and date sorts', () => {
  const items = [...searchItems,
    bookmark('literal', '100% useful_method C:\\tools "OR"'),
    bookmark('nonliteral', '1000 usefulXmethod'),
  ];
  const db = rankedCollection(items);
  try {
    for (const query of ['machine learning', 'LEARNING MACHINE', 'MACHINE machine learning', '"machine learning"', '%', '_', 'C:\\tools', '"OR"', 'alice learning', '"', '', '   ']) {
      for (const sort of ['auto', 'relevance', 'imported', 'newest', 'oldest']) {
        for (const topic of ['', 'learn', '__untagged']) {
          for (const since of ['0', '25']) {
            const params = { q: query, sort, topic, since };
            const demo = filterDemoLibrary(items, parseLibraryQuery(new URLSearchParams(params)));
            assert.deepEqual(searchDatabase(db, params), demo.items.map((item) => item.postId), JSON.stringify(params));
          }
        }
      }
    }
    assert.deepEqual(searchDatabase(db, { q: '%' }), ['literal']);
    assert.deepEqual(searchDatabase(db, { q: '_' }), ['literal']);
    assert.deepEqual(searchDatabase(db, { q: "' OR 1=1 --" }), []);
  } finally { db.close(); }
});

it('ranks before pagination and uses stable ties across every page', () => {
  const items = Array.from({ length: 65 }, (_, index) => bookmark(String(index).padStart(3, '0'), 'learning about a machine'));
  items.push(bookmark('best', 'machine learning', { importedAt: 1 }));
  const db = rankedCollection(items);
  try {
    const pages = [0, 30, 60].flatMap((offset) => searchDatabase(db, { q: 'machine learning', offset: String(offset) }));
    assert.equal(pages[0], 'best');
    assert.equal(new Set(pages).size, 66);
    assert.deepEqual(pages.slice(1), items.slice(0, 65).reverse().map((item) => item.postId));
  } finally { db.close(); }
});

it('uses bounded SQL bindings for many-word searches and does not silently drop words', () => {
  const query = Array.from({ length: 40 }, (_, index) => `w${index}`).join(' ');
  const db = rankedCollection([bookmark('all', query), bookmark('missing', query.replace('w39', ''))]);
  try {
    assert.deepEqual(searchDatabase(db, { q: query }), ['all']);
    assert.equal(bookmarkSearchRank(query).values.length, 1);
  } finally { db.close(); }
});

it('returns accumulated demo pages in one ranking pass', () => {
  const items = Array.from({ length: 95 }, (_, index) => bookmark(String(index).padStart(3, '0'), 'machine learning'));
  const options = parseLibraryQuery(new URLSearchParams({ q: 'machine learning' }));
  const combined = filterDemoLibrary(items, options, 90);
  assert.equal(combined.items.length, 90);
  assert.equal(combined.nextOffset, 90);
  assert.deepEqual(combined.items, [0, 30, 60].flatMap((offset) => filterDemoLibrary(items, { ...options, offset }).items));
});

it('uses an additive index to browse recent imports without sorting the collection', () => {
  const db = rankedCollection(searchItems);
  try {
    const migration = readFileSync(new URL('../drizzle/0004_bookmark_import_order.sql', import.meta.url), 'utf8');
    db.exec(migration); db.exec(migration);
    const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT post_id FROM bookmarks b WHERE owner_id = ? ORDER BY ${libraryOrder('imported')} LIMIT 30`).all('owner');
    assert.ok(plan.some((row) => String(row.detail).includes('idx_bookmarks_owner_imported')));
    assert.ok(plan.every((row) => !String(row.detail).includes('TEMP B-TREE')));
  } finally { db.close(); }
});
