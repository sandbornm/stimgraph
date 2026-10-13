import assert from 'node:assert/strict';
import test from 'node:test';
import { BACKFILL_LIMIT, activityQuery, nextPageStep, pollDelay, trustedTailnetLogin } from './background-policy.ts';
import { retryTime } from './x-errors.ts';

test('polling backs off, caps exponential retries, and honors longer server delays', () => {
  assert.equal(pollDelay(0, 0, 1000), 21_600_000);
  assert.equal(pollDelay(1, 0, 1000), 43_200_000);
  assert.equal(pollDelay(100, 0, 1000), 86_400_000);
  assert.equal(pollDelay(2, 100_001_000, 1000), 100_000_000);
  assert.equal(retryTime(new Response('', { headers: { 'retry-after': '600' } }), 1000), 601_000);
  assert.equal(retryTime(new Response('', { headers: { 'x-rate-limit-reset': '900' } }), 1000), 900_000);
});

test('activity cursors are bounded, stable integers', () => {
  assert.deepEqual(activityQuery(new URLSearchParams()), { after: 0, limit: 100 });
  for (const params of ['after=-1', 'after=NaN', 'after=9007199254740992', 'limit=0', 'limit=501', 'limit=1.5']) {
    assert.equal(activityQuery(new URLSearchParams(params)), null);
  }
});

test('tailnet access requires the exact explicitly configured identity', () => {
  assert.equal(trustedTailnetLogin(new Headers(), undefined), false);
  assert.equal(trustedTailnetLogin(new Headers(), 'owner@example.invalid'), false);
  assert.equal(trustedTailnetLogin(new Headers({ 'Tailscale-User-Login': 'other@example.invalid' }), 'owner@example.invalid'), false);
  assert.equal(trustedTailnetLogin(new Headers({ 'Tailscale-User-Login': 'owner@example.invalid' }), 'owner@example.invalid'), true);
});

test('regular polls stop at overlap; backfill pages past it', () => {
  assert.deepEqual(nextPageStep({ backfill: false, inserted: 5, received: 20, nextToken: 't', fetched: 20 }),
    { continuation: null, stop: true, backfillDone: false });
  assert.deepEqual(nextPageStep({ backfill: false, inserted: 20, received: 20, nextToken: 't', fetched: 20 }),
    { continuation: 't', stop: false, backfillDone: false });
  assert.deepEqual(nextPageStep({ backfill: true, inserted: 0, received: 100, nextToken: 't', fetched: 100 }),
    { continuation: 't', stop: false, backfillDone: false });
});

test('backfill completes when X runs out of pages or the limit is reached', () => {
  assert.deepEqual(nextPageStep({ backfill: true, inserted: 3, received: 40, nextToken: undefined, fetched: 340 }),
    { continuation: null, stop: true, backfillDone: true });
  assert.deepEqual(nextPageStep({ backfill: true, inserted: 0, received: 100, nextToken: 't', fetched: BACKFILL_LIMIT }),
    { continuation: null, stop: true, backfillDone: true });
  assert.deepEqual(nextPageStep({ backfill: true, inserted: 0, received: 0, nextToken: 't', fetched: 100 }),
    { continuation: null, stop: true, backfillDone: true });
});
