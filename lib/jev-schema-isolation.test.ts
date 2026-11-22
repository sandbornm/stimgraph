import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const schema = readFileSync(join(dir, '../db/jev-schema.ts'), 'utf8');
const storage = readFileSync(join(dir, '../db/storage.ts'), 'utf8');

test('Jev schema stays in its own module so db/jev.ts can import storage without a cycle', () => {
  assert.doesNotMatch(schema, /from ['"]\.\/storage['"]/);
  assert.doesNotMatch(schema, /from ['"]\.\/jev['"]/);
  assert.match(storage, /from ['"]\.\/jev-schema['"]/);
});
