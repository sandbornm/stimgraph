import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../db/storage.ts'), 'utf8');

function functionBody(name: string) {
  const match = source.match(new RegExp(`export async function ${name}\\([\\s\\S]*?\\n\\}`));
  assert.ok(match, name + ' is missing');
  return match[0];
}

test('saving a refreshed session only updates an existing row and cannot recreate a deleted session', () => {
  const body = functionBody('saveXSessionRecord');
  assert.match(body, /UPDATE x_sessions SET payload = \?, expires_at = \?, updated_at = \?\s+WHERE id = \? AND owner_id = \?/);
  assert.doesNotMatch(body, /INSERT INTO x_sessions/);
  assert.doesNotMatch(body, /replaceXSessionRecord/);
});
