import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { X_OAUTH_SCOPE } from './x-oauth.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('oauth scope is exactly the bookmark read set', () => {
  assert.equal(X_OAUTH_SCOPE, 'tweet.read users.read bookmark.read offline.access');
  const route = readFileSync(join(root, 'app/api/auth/x/start/route.ts'), 'utf8');
  const page = readFileSync(join(root, 'app/page.tsx'), 'utf8');
  assert.match(route, /scope: X_OAUTH_SCOPE/);
  assert.equal(route.includes('follows.read'), false);
  assert.equal(page.includes('follows.read'), false);
  assert.equal(page.includes('Reconnect X to grant'), false);
});
