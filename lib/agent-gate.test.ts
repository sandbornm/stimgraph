import assert from 'node:assert/strict';
import test from 'node:test';
import { tailnetAgentAllowed } from './agent-gate.ts';

const h = (init: Record<string, string>) => new Headers(init);
const tailnet = { tailnet: 'true' };
const ok = { host: 'mac.example.ts.net', 'tailscale-user-login': 'me@example.com' };

test('tailnet agent path requires tailnet mode, a login header, and a ts.net host', () => {
  assert.equal(tailnetAgentAllowed(h(ok), tailnet), true);
  assert.equal(tailnetAgentAllowed(h(ok), {}), false, 'dev mode never trusts the header');
  assert.equal(tailnetAgentAllowed(h({ host: 'mac.example.ts.net' }), tailnet), false);
  assert.equal(tailnetAgentAllowed(h({ ...ok, host: '127.0.0.1:3001' }), tailnet), false);
  assert.equal(tailnetAgentAllowed(h({ ...ok, host: 'evil.com', 'x-forwarded-host': 'mac.example.ts.net:443' }), tailnet), true);
});

test('agent API can be disabled and restricted to an allowlist', () => {
  assert.equal(tailnetAgentAllowed(h(ok), { ...tailnet, agentApi: 'OFF' }), false);
  assert.equal(tailnetAgentAllowed(h(ok), { ...tailnet, logins: 'Me@Example.com, other@x.com' }), true);
  assert.equal(tailnetAgentAllowed(h(ok), { ...tailnet, logins: 'other@x.com' }), false);
});

test('a forged Tailscale-User-Login grants nothing when STIMGRAPH_TAILNET is unset', () => {
  const forged = h({
    host: 'mac.example.ts.net',
    'x-forwarded-host': 'mac.example.ts.net',
    'tailscale-user-login': 'owner@example.com',
  });
  for (const tailnet of [undefined, '', 'false', 'TRUE', '1']) {
    assert.equal(tailnetAgentAllowed(forged, { tailnet, logins: 'owner@example.com' }), false);
  }
  assert.equal(tailnetAgentAllowed(forged, {}), false);
});

test('a Tailscale-User-Login header is ignored unless tailnet mode is explicitly enabled', () => {
  const spoofed = h({ host: 'mac.example.ts.net', 'tailscale-user-login': 'attacker@example.com' });
  assert.equal(tailnetAgentAllowed(spoofed, { tailnet: 'false' }), false);
  assert.equal(tailnetAgentAllowed(spoofed, { tailnet: undefined }), false);
  assert.equal(tailnetAgentAllowed(spoofed, { tailnet: 'true' }), true);
});
