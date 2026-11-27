import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  accountDeletionDecision,
  DELETE_ACCOUNT_CONFIRMATION,
  deleteAccountRequestAllowed,
  REVOKE_UNCONFIRMED_ERROR,
} from './delete-account.ts';

const origin = 'https://app.example';

function allowed(overrides: Partial<Parameters<typeof deleteAccountRequestAllowed>[0]> = {}) {
  return deleteAccountRequestAllowed({
    origin,
    requestOrigin: origin,
    secFetchSite: null,
    confirm: DELETE_ACCOUNT_CONFIRMATION,
    ...overrides,
  });
}

test('delete account rejects a missing or foreign origin and a bad confirmation', () => {
  assert.equal(allowed(), true);
  assert.equal(allowed({ origin: null, secFetchSite: 'same-origin' }), true);
  assert.equal(allowed({ origin: null, secFetchSite: null }), false);
  assert.equal(allowed({ origin: null, secFetchSite: 'cross-site' }), false);
  assert.equal(allowed({ origin: 'https://untrusted.invalid' }), false);
  assert.equal(allowed({ origin: 'https://untrusted.invalid', secFetchSite: 'same-origin' }), false);
  assert.equal(allowed({ confirm: undefined }), false);
  assert.equal(allowed({ confirm: '' }), false);
  assert.equal(allowed({ confirm: 'delete' }), false);
  assert.equal(allowed({ confirm: 'Delete my account' }), false);
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/page.tsx'), 'utf8');
  assert.match(page, /DELETE_ACCOUNT_CONFIRMATION/);
  assert.match(page, />Delete account</);
  assert.match(page, /force: true/);
  assert.match(page, /X did not confirm revoking access\. Delete your Stimgraph data anyway\?/);
});

test('deletion is refused when revocation failed unless force is set', () => {
  assert.deepEqual(accountDeletionDecision({ allRevoked: true, force: false }), { delete: true, revoked: true });
  assert.deepEqual(accountDeletionDecision({ allRevoked: true, force: true }), { delete: true, revoked: true });
  assert.deepEqual(accountDeletionDecision({ allRevoked: false, force: false }), {
    delete: false,
    status: 502,
    error: REVOKE_UNCONFIRMED_ERROR,
    revoked: false,
    retryable: true,
  });
  assert.equal(REVOKE_UNCONFIRMED_ERROR, 'X did not confirm that access was revoked. Nothing was deleted; try again.');
  assert.deepEqual(accountDeletionDecision({ allRevoked: false, force: true }), { delete: true, revoked: false });
});
