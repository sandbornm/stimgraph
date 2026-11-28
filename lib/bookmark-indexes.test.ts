import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type IndexOp =
  | { kind: 'create'; name: string; columns: string }
  | { kind: 'drop'; name: string };

function bookmarkIndexOps(source: string): IndexOp[] {
  const pattern = /CREATE\s+INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?[`'"]?([A-Za-z_]\w*)[`'"]?\s+ON\s+[`'"]?bookmarks[`'"]?\s*\(([^)]*)\)|DROP\s+INDEX\s+(?:IF\s+EXISTS\s+)?[`'"]?(idx_bookmarks_\w+)[`'"]?/gi;
  const ops: IndexOp[] = [];
  for (const match of source.matchAll(pattern)) {
    if (match[1]) {
      ops.push({
        kind: 'create',
        name: match[1],
        columns: match[2].replace(/`/g, '').replace(/\s+/g, ' ').trim().toLowerCase(),
      });
    } else {
      ops.push({ kind: 'drop', name: match[3] });
    }
  }
  return ops;
}

function finalIndexes(ops: IndexOp[]) {
  const indexes = new Map<string, string>();
  for (const op of ops) {
    if (op.kind === 'create') indexes.set(op.name, op.columns);
    else indexes.delete(op.name);
  }
  return indexes;
}

function migrationFiles() {
  return readdirSync(join(root, 'drizzle')).filter((name) => name.endsWith('.sql')).sort();
}

function migrationSource() {
  return migrationFiles().map((name) => readFileSync(join(root, 'drizzle', name), 'utf8')).join('\n');
}

function applyMigrations(db: DatabaseSync) {
  for (const name of migrationFiles()) db.exec(readFileSync(join(root, 'drizzle', name), 'utf8'));
}

function bookmarkIndexNames(db: DatabaseSync) {
  return db.prepare(`SELECT name FROM sqlite_master
    WHERE type = 'index' AND tbl_name = 'bookmarks' AND name NOT LIKE 'sqlite_autoindex%'
    ORDER BY name`).all().map((row) => String(row.name));
}

function plan(db: DatabaseSync, sql: string, args: Array<string | number>) {
  return db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map((row) => String(row.detail)).join('\n');
}

const recentSql = `SELECT post_id, author_id, author_username, author_name, text, created_at
  FROM bookmarks WHERE owner_id = ? ORDER BY created_at DESC, synced_at DESC LIMIT ?`;
const authorSql = `SELECT author_id, author_username, author_name, author_profile_image_url, COUNT(*) AS bookmark_count
  FROM bookmarks WHERE owner_id = ?
  GROUP BY author_id, author_username, author_name, author_profile_image_url
  ORDER BY bookmark_count DESC LIMIT ?`;

test('bookmark migrations keep the read indexes and drop the narrower ones', () => {
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  assert.deepEqual(bookmarkIndexNames(db), [
    'idx_bookmarks_owner_author_profile',
    'idx_bookmarks_owner_recent',
  ]);
  const recent = plan(db, recentSql, ['owner', 50]);
  assert.match(recent, /idx_bookmarks_owner_recent/);
  assert.doesNotMatch(recent, /TEMP B-TREE/);
  const authors = plan(db, authorSql, ['owner', 20]);
  assert.match(authors, /COVERING INDEX idx_bookmarks_owner_author_profile/);
  assert.doesNotMatch(authors, /TEMP B-TREE FOR GROUP BY/);
  db.close();
});

test('ensureSchema bookmark indexes match the migrated set', () => {
  const migrated = finalIndexes(bookmarkIndexOps(migrationSource()));
  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  const ensureOps = bookmarkIndexOps(storage);
  const ensured = finalIndexes(ensureOps);
  assert.deepEqual([...ensured.entries()].sort(), [...migrated.entries()].sort());
  const dropped = ['idx_bookmarks_owner_author', 'idx_bookmarks_owner_created'];
  for (const name of dropped) {
    assert.equal(migrated.has(name), false, name);
    assert.equal(ensureOps.some((op) => op.kind === 'create' && op.name === name), false, name);
    assert.equal(ensureOps.some((op) => op.kind === 'drop' && op.name === name), true, name);
  }
  const db = new DatabaseSync(':memory:');
  applyMigrations(db);
  for (const op of ensureOps) {
    db.exec(op.kind === 'drop'
      ? `DROP INDEX IF EXISTS ${op.name}`
      : `CREATE INDEX IF NOT EXISTS ${op.name} ON bookmarks(${op.columns})`);
  }
  assert.deepEqual(bookmarkIndexNames(db), [...migrated.keys()].sort());
  db.close();
});
