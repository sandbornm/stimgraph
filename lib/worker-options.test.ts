import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../scripts/worker-options.mjs'), 'utf8');

test('built worker options list every built JS module because Vinext route chunks are imported dynamically', () => {
  assert.match(source, /readdirSync\(modulesRoot, \{ recursive: true \}\)/);
  assert.match(source, /path !== 'index.js'/);
  assert.doesNotMatch(source, /infer dynamic/);
});
