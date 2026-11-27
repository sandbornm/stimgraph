import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { DELETE_ACCOUNT_CONFIRMATION, deleteAccountRequestAllowed } from './delete-account.ts';

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
});
