import assert from 'node:assert/strict';
import test from 'node:test';
import { uniqueOwnerId } from './unique-owner-id.ts';

test('tailnet owner resolution fails closed unless exactly one owner exists', () => {
  assert.equal(uniqueOwnerId(undefined), undefined);
  assert.equal(uniqueOwnerId([]), undefined);
  assert.equal(uniqueOwnerId([{ id: 'owner-a' }]), 'owner-a');
  assert.equal(uniqueOwnerId([{ id: 'owner-a' }, { id: 'owner-b' }]), undefined);
});
