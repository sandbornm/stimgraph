import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { NON_OWNER_TABLES, OWNER_SCOPED_TABLES, ownerDeleteStatements } from './owner-tables.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function createTables(source: string) {
  return [...source.matchAll(/CREATE TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+[`'"]?([A-Za-z_][A-Za-z0-9_]*)[`'"]?/g)].map((match) => match[1]);
}

test('every table is owner-scoped or explicitly excluded from account deletion', () => {
  const discovered = new Set<string>();
  for (const file of readdirSync(join(root, 'drizzle')).filter((name) => name.endsWith('.sql'))) {
    for (const table of createTables(readFileSync(join(root, 'drizzle', file), 'utf8'))) discovered.add(table);
  }
  for (const table of createTables(readFileSync(join(root, 'db/storage.ts'), 'utf8'))) discovered.add(table);
  const schema = readFileSync(join(root, 'db/schema.ts'), 'utf8');
  for (const match of schema.matchAll(/sqliteTable\(\s*['"]([A-Za-z_][A-Za-z0-9_]*)['"]/g)) discovered.add(match[1]);

  const owned = new Map(OWNER_SCOPED_TABLES.map((entry) => [entry.table, entry.column]));
  const excluded = new Map(NON_OWNER_TABLES.map((entry) => [entry.table, entry.reason]));
  for (const table of discovered) {
    assert.equal(owned.has(table) !== excluded.has(table), true, table);
  }
  for (const [table, column] of owned) {
    assert.ok(discovered.has(table), table);
    assert.equal(column, table === 'accounts' ? 'id' : 'owner_id');
  }
  for (const [table, reason] of excluded) {
    assert.ok(discovered.has(table), table);
    assert.ok(reason.length > 10, table);
  }
  assert.deepEqual(NON_OWNER_TABLES.map((entry) => entry.table), ['oauth_pending', 'background_health', 'deleted_owners', 'schema_events']);
  assert.match(
    NON_OWNER_TABLES.find((entry) => entry.table === 'deleted_owners')?.reason ?? '',
    /sign-in started before the delete cannot recreate the account/,
  );
  const statements = ownerDeleteStatements();
  assert.equal(statements.length, OWNER_SCOPED_TABLES.length);
  assert.deepEqual(statements.slice(-2), [
    'DELETE FROM x_sessions WHERE owner_id = ?',
    'DELETE FROM accounts WHERE id = ?',
  ]);
  assert.equal(statements.some((sql) => sql.includes('deleted_owners')), false);
  assert.match(readFileSync(join(root, 'db/storage.ts'), 'utf8'), /ownerDeleteStatements\(\)/);
});
