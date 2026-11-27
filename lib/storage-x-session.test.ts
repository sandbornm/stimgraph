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

test('delete-owner lookup reads owner_id without an expiry filter or a delete', () => {
  const body = functionBody('loadXSessionOwnerId');
  assert.match(body, /SELECT owner_id FROM x_sessions WHERE id = \?/);
  assert.doesNotMatch(body, /expires_at/);
  assert.doesNotMatch(body, /DELETE/);
  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/data/route.ts'), 'utf8');
  const unconfigured = route.slice(route.indexOf('if (!xAuthConfigured'), route.indexOf('const active = await getActiveXSession'));
  assert.match(unconfigured, /loadXSessionOwnerId\(cookieValue\)/);
  assert.doesNotMatch(unconfigured, /loadXSessionRecord/);
  assert.doesNotMatch(unconfigured, /expires_at/);
});

test('re-sealing a legacy session is compare-and-swap so it cannot overwrite a token rotated meanwhile', () => {
  const body = functionBody('resealXSessionRecord');
  assert.match(body, /UPDATE x_sessions SET payload = \?, updated_at = \?\s+WHERE id = \? AND owner_id = \? AND payload = \?/);
  assert.doesNotMatch(body, /INSERT INTO x_sessions/);
  const server = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'x-auth-server.ts'), 'utf8');
  const migrate = server.match(/async function migrateLegacyPayload\([\s\S]*?\n\}/);
  assert.ok(migrate);
  assert.match(migrate[0], /resealXSessionRecord\(id, stored\.ownerId, stored\.payload, payload\)/);
  assert.doesNotMatch(migrate[0], /saveXSessionRecord/);
});
