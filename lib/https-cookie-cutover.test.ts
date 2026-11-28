import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXPIRE_SESSIONS_HTTPS_COOKIE_CUTOVER,
  EXPIRE_UNPREFIXED_CUTOVER_INSERT_SQL,
  EXPIRE_UNPREFIXED_CUTOVER_UPDATE_SQL,
  SCHEMA_EVENTS_CREATE_SQL,
} from '../db/schema.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function sessionDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE x_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  return db;
}

function insertSession(db: DatabaseSync, id: string, expiresAt: number) {
  db.prepare('INSERT INTO x_sessions (id, owner_id, payload, expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, 'owner-cutover', `sealed-${id}`, expiresAt, 1, 1);
}

function expiresAt(db: DatabaseSync, id: string) {
  const row = db.prepare('SELECT expires_at FROM x_sessions WHERE id = ?').get(id) as { expires_at: number } | undefined;
  return row?.expires_at;
}

function applyBoundCutover(db: DatabaseSync, appliedAt: number) {
  db.prepare(SCHEMA_EVENTS_CREATE_SQL).run();
  db.prepare(EXPIRE_UNPREFIXED_CUTOVER_UPDATE_SQL).run();
  db.prepare(EXPIRE_UNPREFIXED_CUTOVER_INSERT_SQL).run(appliedAt);
}

test('the cutover flag expires existing rows once and leaves a later session unexpired', () => {
  const db = sessionDb();
  insertSession(db, 'old', 5_000);
  applyBoundCutover(db, 10);
  assert.equal(expiresAt(db, 'old'), 0);
  assert.equal(
    (db.prepare('SELECT id FROM schema_events').get() as { id: string }).id,
    EXPIRE_SESSIONS_HTTPS_COOKIE_CUTOVER,
  );
  insertSession(db, 'new', 9_000);
  applyBoundCutover(db, 11);
  assert.equal(expiresAt(db, 'old'), 0);
  assert.equal(expiresAt(db, 'new'), 9_000);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM schema_events').get() as { n: number }).n, 1);
  assert.equal((db.prepare('SELECT payload FROM x_sessions WHERE id = ?').get('old') as { payload: string }).payload, 'sealed-old');

  const migrated = sessionDb();
  insertSession(migrated, 'before', 4_000);
  const migration = readFileSync(join(root, 'drizzle/0009_expire_unprefixed_cutover.sql'), 'utf8');
  migrated.exec(migration);
  assert.equal(expiresAt(migrated, 'before'), 0);
  insertSession(migrated, 'after', 8_000);
  migrated.exec(migration);
  assert.equal(expiresAt(migrated, 'before'), 0);
  assert.equal(expiresAt(migrated, 'after'), 8_000);
  assert.equal((migrated.prepare('SELECT COUNT(*) AS n FROM schema_events').get() as { n: number }).n, 1);

  const journal = JSON.parse(readFileSync(join(root, 'drizzle/meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  assert.equal(journal.entries.find((entry) => entry.idx === 9)?.tag, '0009_expire_unprefixed_cutover');
  assert.match(migration, /UPDATE x_sessions SET expires_at = 0 WHERE NOT EXISTS/);
  assert.match(migration, /INSERT OR IGNORE INTO schema_events \(id, applied_at\) VALUES \('expire_sessions_https_cookie_cutover'/);
  const storage = readFileSync(join(root, 'db/storage.ts'), 'utf8');
  const ensure = storage.slice(storage.indexOf('export async function ensureSchema'), storage.indexOf('const OAUTH_PENDING_TTL_MS'));
  const updateAt = ensure.indexOf('EXPIRE_UNPREFIXED_CUTOVER_UPDATE_SQL');
  const insertAt = ensure.indexOf('EXPIRE_UNPREFIXED_CUTOVER_INSERT_SQL');
  assert.ok(ensure.includes('SCHEMA_EVENTS_CREATE_SQL'));
  assert.ok(updateAt >= 0 && insertAt > updateAt);
  const docs = readFileSync(join(root, 'docs/DEPLOYMENT.md'), 'utf8');
  assert.match(docs, /Existing HTTPS users must sign in with X again/);
  assert.match(docs, /On HTTPS only those `__Host-` names authenticate/);
  assert.match(docs, /Unprefixed names are only for plain HTTP on localhost/);
  assert.match(docs, /The poller retries revocation only/);
  assert.match(docs, /must not import bookmarks for expired rows/);
  assert.doesNotMatch(docs, /accepted once/);
  assert.doesNotMatch(docs, /reissued/);
});
