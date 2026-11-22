import assert from 'node:assert/strict';
import test from 'node:test';
import { refreshErrorAction, XRequestError } from './x-errors.ts';

test('only a revoked X error deletes the stored session; rate limits and network errors are rethrown', () => {
  assert.equal(refreshErrorAction(new XRequestError(401, 0, true)), 'delete');
  assert.equal(refreshErrorAction(new XRequestError(429, Date.now() + 1000, false)), 'rethrow');
  assert.equal(refreshErrorAction(new XRequestError(500, 0, false)), 'rethrow');
  assert.equal(refreshErrorAction(new Error('socket hang up')), 'rethrow');
});
