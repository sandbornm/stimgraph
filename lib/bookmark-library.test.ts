import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { parseLibraryQuery, queryBookmarkLibrary, type SqlRunner } from './bookmark-library.ts';

function database(): SqlRunner {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE bookmarks (
      owner_id TEXT NOT NULL, post_id TEXT NOT NULL, author_id TEXT NOT NULL,
      author_username TEXT NOT NULL, author_name TEXT NOT NULL, text TEXT NOT NULL,
      created_at TEXT, synced_at INTEGER NOT NULL, PRIMARY KEY (owner_id, post_id)
    );
    CREATE TABLE bookmark_observations (
      sequence INTEGER PRIMARY KEY AUTOINCREMENT, owner_id TEXT NOT NULL,
      post_id TEXT NOT NULL, observed_at INTEGER NOT NULL, UNIQUE(owner_id, post_id)
    );
    CREATE TABLE topics (
      owner_id TEXT NOT NULL, id TEXT NOT NULL, label TEXT NOT NULL,
      source TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (owner_id, id)
    );
    CREATE TABLE bookmark_topics (
      owner_id TEXT NOT NULL, post_id TEXT NOT NULL, topic_id TEXT NOT NULL,
      confidence INTEGER NOT NULL, evidence TEXT NOT NULL, source TEXT NOT NULL,
      PRIMARY KEY (owner_id, post_id, topic_id)
    );
  `);
  const insert = db.prepare(`INSERT INTO bookmarks (
    owner_id, post_id, author_id, author_username, author_name, text, created_at, synced_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const observe = db.prepare('INSERT INTO bookmark_observations (owner_id, post_id, observed_at) VALUES (?, ?, ?)');
  const rows: Array<[string, string, string, string, string, string, number]> = [
    ['me', 'a1', 'zed', 'Zed', 'compilers love metal', '2024-01-01T00:00:00.000Z', 100],
    ['me', 'a2', 'bob', 'Bob', 'typescript tips', '2020-01-01T00:00:00.000Z', 300],
    ['me', 'a3', 'ada', 'Grace', 'graph notes', '2022-06-01T00:00:00.000Z', 200],
    ['me', 'a4', 'ada', 'Grace', 'more notes', '2023-01-01T00:00:00.000Z', 250],
    ['me', 'a5', 'cara', 'Cara', 'percent literal', '2021-01-01T00:00:00.000Z', 150],
    ['other', 'a1', 'zed', 'Zed', 'compilers secret', '2024-06-01T00:00:00.000Z', 999],
  ];
  for (const [owner, id, handle, name, text, created, observed] of rows) {
    insert.run(owner, id, handle, handle, name, text, created, observed);
    observe.run(owner, id, observed);
  }
  db.prepare('INSERT INTO topics (owner_id, id, label, source, created_at) VALUES (?, ?, ?, ?, ?)').run('me', 'rust', 'Rust', 'hashtag', 1);
  db.prepare(`INSERT INTO bookmark_topics (owner_id, post_id, topic_id, confidence, evidence, source)
    VALUES (?, ?, ?, 100, '#Rust', 'hashtag')`).run('me', 'a1', 'rust');
  return {
    all: async (sql, values) => db.prepare(sql).all(...values) as Record<string, unknown>[],
  };
}

const saved = parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=10'));

describe('bookmark library query', () => {
  it('matches every word in bookmark text or author and hides other owners', async () => {
    const db = database();
    const text = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=compilers&limit=10')));
    assert.deepEqual(text.bookmarks.map((row) => row.id), ['a1']);
    const author = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=grace&limit=10&sort=author')));
    assert.deepEqual(author.bookmarks.map((row) => row.id), ['a3', 'a4']);
    const handle = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=@bob&limit=10')));
    assert.deepEqual(handle.bookmarks.map((row) => row.id), ['a2']);
    const topic = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=rust&limit=10')));
    assert.deepEqual(topic.bookmarks.map((row) => row.id), ['a1']);
    const both = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=compilers%20bob&limit=10')));
    assert.deepEqual(both.bookmarks, []);
    assert.equal(both.matched, 0);
    const literal = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('q=%25&limit=10')));
    assert.deepEqual(literal.bookmarks, []);
  });

  it('sorts saved time by observed_at and posted time by created_at', async () => {
    const db = database();
    const desc = await queryBookmarkLibrary(db, 'me', saved);
    assert.deepEqual(desc.bookmarks.map((row) => row.id), ['a2', 'a4', 'a3', 'a5', 'a1']);
    const asc = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_asc&limit=10')));
    assert.deepEqual(asc.bookmarks.map((row) => row.id), ['a1', 'a5', 'a3', 'a4', 'a2']);
    const posted = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=posted&limit=10')));
    assert.deepEqual(posted.bookmarks.map((row) => row.id), ['a1', 'a4', 'a3', 'a5', 'a2']);
    const author = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=author&limit=10')));
    assert.deepEqual(author.bookmarks.map((row) => row.id), ['a3', 'a4', 'a2', 'a5', 'a1']);
    assert.equal(desc.total, 5);
  });

  it('pages on offset boundaries without skipping or repeating', async () => {
    const db = database();
    const first = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=2&offset=0')));
    assert.deepEqual(first.bookmarks.map((row) => row.id), ['a2', 'a4']);
    assert.equal(first.matched, 5);
    assert.equal(first.nextOffset, 2);
    const middle = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=2&offset=2')));
    assert.deepEqual(middle.bookmarks.map((row) => row.id), ['a3', 'a5']);
    assert.equal(middle.nextOffset, 4);
    const last = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=2&offset=4')));
    assert.deepEqual(last.bookmarks.map((row) => row.id), ['a1']);
    assert.equal(last.nextOffset, null);
    const partial = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=2&offset=5')));
    assert.deepEqual(partial.bookmarks, []);
    assert.equal(partial.nextOffset, null);
    const past = await queryBookmarkLibrary(db, 'me', parseLibraryQuery(new URLSearchParams('sort=saved_desc&limit=2&offset=6')));
    assert.deepEqual(past.bookmarks, []);
    assert.equal(past.nextOffset, null);
  });

  it('rejects unknown sort and clamps paging input', () => {
    assert.equal(parseLibraryQuery(new URLSearchParams('sort=synced')).sort, 'saved_desc');
    assert.equal(parseLibraryQuery(new URLSearchParams('offset=-4&limit=nope')).offset, 0);
    assert.equal(parseLibraryQuery(new URLSearchParams('limit=9000')).limit, 100);
    assert.equal(parseLibraryQuery(new URLSearchParams()).limit, 50);
  });
});
