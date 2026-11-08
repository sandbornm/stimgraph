import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { applyMigrationSql } from '../scripts/apply-migration-sql.mjs';

const migration = readFileSync(new URL('../drizzle/0007_import_cursor.sql', import.meta.url), 'utf8');

function tables(options: { column: boolean }) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE bookmark_sync_state (owner_id TEXT PRIMARY KEY${options.column ? ', import_cursor TEXT' : ''});
    CREATE TABLE bookmark_observations (
      sequence INTEGER PRIMARY KEY, owner_id TEXT NOT NULL, post_id TEXT NOT NULL, observed_at INTEGER NOT NULL
    );`);
  return db;
}

function indexExists(db: DatabaseSync) {
  return db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_observations_owner_observed'`).get() != null;
}

describe('import cursor migration', () => {
  it('creates the observed_at index when import_cursor was already added', () => {
    const db = tables({ column: true });
    applyMigrationSql(db, migration);
    assert.equal(indexExists(db), true);
    applyMigrationSql(db, migration);
    assert.equal(indexExists(db), true);
    const columns = db.prepare(`SELECT name FROM pragma_table_info('bookmark_sync_state')`).all() as Array<{ name: string }>;
    assert.equal(columns.filter((column) => column.name === 'import_cursor').length, 1);
  });

  it('adds import_cursor and the index on a table that has neither', () => {
    const db = tables({ column: false });
    applyMigrationSql(db, migration);
    const columns = db.prepare(`SELECT name FROM pragma_table_info('bookmark_sync_state')`).all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'import_cursor'));
    assert.equal(indexExists(db), true);
  });
});
