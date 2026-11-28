import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  accountDeletionDecision,
  DELETE_ACCOUNT_CONFIRMATION,
  deleteAccountRequestAllowed,
  sameOriginRequestAllowed,
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
  assert.deepEqual(accountDeletionDecision({ configured: true, allRevoked: true, force: false }), { delete: true, revoked: true });
  assert.deepEqual(accountDeletionDecision({ configured: true, allRevoked: false, force: false }), {
    delete: false,
    status: 502,
    error: REVOKE_UNCONFIRMED_ERROR,
    revoked: false,
    retryable: true,
  });
  assert.deepEqual(accountDeletionDecision({ configured: true, allRevoked: false, force: true }), { delete: true, revoked: false });
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

test('an unconfigured server deletes from the session row and skips revoke', () => {
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    allRevoked: false,
    force: false,
    cookieValue: 'opaque-session',
    ownerIdFromRow: 'owner-1',
  }), { delete: true, revoked: false, revokeSkipped: 'not_configured', ownerId: 'owner-1' });
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    allRevoked: false,
    force: false,
    cookieValue: 'opaque-session',
    ownerIdFromRow: null,
  }), { delete: false, status: 401, error: 'Connect X first.' });
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    allRevoked: true,
    force: true,
    cookieValue: 'legacy.dotted.cookie',
    ownerIdFromRow: 'owner-1',
  }), { delete: false, status: 401, error: 'Connect X first.' });
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    allRevoked: false,
    force: false,
    cookieValue: undefined,
    ownerIdFromRow: null,
  }), { delete: false, status: 401, error: 'Connect X first.' });
  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/data/route.ts'), 'utf8');
  const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/page.tsx'), 'utf8');
  assert.match(route, /readSessionCookie/);
  assert.match(route, /loadXSessionOwnerId/);
  assert.equal(route.includes('loadXSessionRecord'), false);
  assert.match(route, /revokeSkipped: 'not_configured'/);
  assert.equal(route.includes('The X connection is not configured on the server.'), false);
  assert.match(page, /payload\?\.revoked === false/);
  assert.match(page, /Revoke Stimgraph in your X settings \(Security and account access > Apps and sessions\)\./);
  assert.match(page, /connection\.configured === false/);
});

test('an unconfigured server deletes when the session row is expired and the owner id is still known', () => {
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    allRevoked: false,
    force: false,
    cookieValue: 'opaque-expired-session',
    ownerIdFromRow: 'owner-expired',
  }), { delete: true, revoked: false, revokeSkipped: 'not_configured', ownerId: 'owner-expired' });
});

test('client credentials attempt revoke when only the token key is unusable, and unopened rows stay unconfirmed', () => {
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    clientCredentials: true,
    allRevoked: false,
    force: false,
    cookieValue: 'opaque-session',
    ownerIdFromRow: 'owner-1',
  }), { delete: false, attemptRevoke: true, ownerId: 'owner-1' });
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    clientCredentials: true,
    allRevoked: false,
    force: true,
    cookieValue: 'legacy.dotted.cookie',
    ownerIdFromRow: 'owner-1',
  }), { delete: false, status: 401, error: 'Connect X first.' });
  assert.deepEqual(accountDeletionDecision({
    configured: false,
    clientCredentials: false,
    allRevoked: false,
    force: true,
    cookieValue: 'opaque-session',
    ownerIdFromRow: 'owner-1',
  }), { delete: true, revoked: false, revokeSkipped: 'not_configured', ownerId: 'owner-1' });
  assert.deepEqual(accountDeletionDecision({ allRevoked: true, force: false, unopened: 1 }), {
    delete: false,
    status: 502,
    error: REVOKE_UNCONFIRMED_ERROR,
    revoked: false,
    retryable: true,
  });
  assert.deepEqual(accountDeletionDecision({ allRevoked: true, force: true, unopened: 1 }), {
    delete: true,
    revoked: false,
  });
  assert.deepEqual(accountDeletionDecision({ allRevoked: true, force: false, unopened: 0 }), {
    delete: true,
    revoked: true,
  });
  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/data/route.ts'), 'utf8');
  const unconfigured = route.slice(route.indexOf('if (!xAuthConfigured'), route.indexOf('current: null'));
  assert.match(unconfigured, /xClientCredentialsConfigured\(getRuntimeValue\)/);
  assert.match(unconfigured, /deleteUnconfiguredAccount\(/);
  assert.match(unconfigured, /openXSession/);
  assert.match(unconfigured, /revokeXSession/);
  assert.match(unconfigured, /\bforce,/);
  assert.match(unconfigured, /revokeSkipped: 'not_configured'/);
});

test('disconnect uses the same-origin check that delete uses', () => {
  assert.equal(sameOriginRequestAllowed({
    origin: 'https://app.example.invalid',
    requestOrigin: 'https://app.example.invalid',
    secFetchSite: null,
  }), true);
  assert.equal(sameOriginRequestAllowed({
    origin: 'https://other.example.invalid',
    requestOrigin: 'https://app.example.invalid',
    secFetchSite: 'same-origin',
  }), false);
  assert.equal(sameOriginRequestAllowed({
    origin: null,
    requestOrigin: 'https://app.example.invalid',
    secFetchSite: 'same-origin',
  }), true);
  assert.equal(sameOriginRequestAllowed({
    origin: null,
    requestOrigin: 'https://app.example.invalid',
    secFetchSite: 'same-site',
  }), false);
  const disconnect = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/auth/x/disconnect/route.ts'), 'utf8');
  assert.match(disconnect, /sameOriginRequestAllowed\(/);
  assert.match(disconnect, /status: 403/);
  const handler = disconnect.slice(disconnect.indexOf('export async function POST'));
  assert.ok(handler.indexOf('sameOriginRequestAllowed') < handler.indexOf('disconnectPresentedSession'));
});
