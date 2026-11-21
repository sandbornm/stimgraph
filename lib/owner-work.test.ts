import assert from 'node:assert/strict';
import test from 'node:test';
import { withOwnerWork } from './owner-work.ts';

test('work for the same owner is serialized so an in-flight task cannot overlap a later one', async () => {
  const log: string[] = [];
  const first = withOwnerWork('same-owner-serial', async () => {
    log.push('first');
    await new Promise((resolve) => setTimeout(resolve, 20));
    log.push('first-done');
    return 'first';
  });
  const second = withOwnerWork('same-owner-serial', async () => {
    log.push('second');
    return 'second';
  });
  assert.deepEqual(await Promise.all([first, second]), ['first', 'second']);
  assert.deepEqual(log, ['first', 'first-done', 'second']);
});

test('work for different owners can overlap', async () => {
  let release!: () => void;
  const first = withOwnerWork('overlap-a', () => new Promise<string>((resolve) => {
    release = () => resolve('a');
  }));
  const second = withOwnerWork('overlap-b', async () => 'b');
  assert.equal(await second, 'b');
  release();
  assert.equal(await first, 'a');
});
