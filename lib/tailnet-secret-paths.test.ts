import assert from 'node:assert/strict';
import test from 'node:test';
import { isSecretEnvPath } from '../scripts/tailnet-secret-paths.mjs';

test('tailnet copies skip secret env files and keep the example template', () => {
  assert.equal(isSecretEnvPath('.env'), true);
  assert.equal(isSecretEnvPath('.env.local'), true);
  assert.equal(isSecretEnvPath('config/.env.production'), true);
  assert.equal(isSecretEnvPath('.env.example'), false);
  assert.equal(isSecretEnvPath('lib/request-origin.ts'), false);
});
