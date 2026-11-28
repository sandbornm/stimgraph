import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { BOOKMARKS_REQUIRE_LIVE_OWNER_SQL, INSERT_SESSION_IF_LIVE_SQL, POLL_LIVE_SESSIONS_SQL } from './owner-live-sql.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('session insert and poller import are refused in SQL when a tombstone covers the sign-in', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE deleted_owners (owner_id TEXT PRIMARY KEY NOT NULL, deleted_at INTEGER NOT NULL);
    CREATE TABLE x_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      owner_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );`);
  db.prepare('INSERT INTO deleted_owners (owner_id, deleted_at) VALUES (?, ?)').run('owner-a', 50);
  const insert = db.prepare(INSERT_SESSION_IF_LIVE_SQL);
  const refused = insert.run('sid-old', 'owner-a', 'sealed', 1000, 100, 100, 'owner-a', 40);
  assert.equal(Number(refused.changes), 0);
  const allowed = insert.run('sid-new', 'owner-a', 'sealed-new', 1000, 100, 100, 'owner-a', 60);
  assert.equal(Number(allowed.changes), 1);
  const live = db.prepare(POLL_LIVE_SESSIONS_SQL).all(0) as Array<{ id: string }>;
  assert.deepEqual(live.map((row) => row.id), ['sid-new']);
  db.prepare('UPDATE x_sessions SET created_at = 40 WHERE id = ?').run('sid-new');
  assert.deepEqual((db.prepare(POLL_LIVE_SESSIONS_SQL).all(0) as Array<{ id: string }>).map((row) => row.id), []);

  db.exec(`CREATE TABLE bookmarks (owner_id TEXT NOT NULL, post_id TEXT NOT NULL, PRIMARY KEY (owner_id, post_id));`);
  db.exec(BOOKMARKS_REQUIRE_LIVE_OWNER_SQL);
  assert.throws(
    () => db.prepare('INSERT INTO bookmarks (owner_id, post_id) VALUES (?, ?)').run('owner-a', 'p-old'),
    /stimgraph-owner-not-live/,
  );
  db.prepare('UPDATE x_sessions SET created_at = 100 WHERE id = ?').run('sid-new');
  db.prepare('INSERT INTO bookmarks (owner_id, post_id) VALUES (?, ?)').run('owner-a', 'p-new');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bookmarks').get().n, 1);

  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  assert.match(storage, /BOOKMARKS_REQUIRE_LIVE_OWNER_SQL/);
  assert.match(storage, /stimgraph-owner-not-live/);
  const sync = readFileSync(join(root, 'lib/background-sync.ts'), 'utf8');
  assert.match(sync, /POLL_LIVE_SESSIONS_SQL/);
  assert.doesNotMatch(sync, /WHERE expires_at > \? ORDER BY updated_at DESC/);
  const revoke = readFileSync(join(root, 'lib/owner-revoke-delete.ts'), 'utf8');
  assert.match(revoke, /await input\.recordOwnerDeleted\(input\.ownerId, Date\.now\(\)\);\s*await input\.deleteData\(input\.ownerId\)/);
});
