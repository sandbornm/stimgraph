import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), './background-sync.ts'), 'utf8');

test('a poll re-reads the session after taking the owner lock so a completed delete wins', () => {
  const start = source.indexOf('await withOwnerWork(');
  assert.ok(start >= 0, 'withOwnerWork poll body is missing');
  const body = source.slice(start, start + 2500);
  const selectAt = body.indexOf('SELECT id FROM x_sessions WHERE id = ?');
  const insertAt = body.indexOf('INSERT OR IGNORE INTO bookmark_sync_state');
  assert.ok(selectAt >= 0, 'session re-read is missing');
  assert.ok(insertAt > selectAt, 'session re-read must happen before sync work');
});

test('an HTTP 400 from X drops the pagination cursor so the next attempt starts at the head', () => {
  assert.match(source, /error instanceof XRequestError && error.status === 400\) continuation = null/);
});
