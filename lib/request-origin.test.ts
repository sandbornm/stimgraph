import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRequestOrigin } from './request-origin-core.ts';

const configured = 'https://app.example.ts.net';

test('tailnet mode uses the configured public origin and ignores forwarded headers', () => {
  const request = new Request('http://localhost:3001/graph', {
    headers: {
      host: 'spoofed.example',
      'x-forwarded-host': 'spoofed.example',
      'x-forwarded-proto': 'https',
      origin: 'https://spoofed.example',
    },
  });
  assert.equal(resolveRequestOrigin(request, 'true', configured), configured);
});

test('without tailnet mode the request URL origin is used', () => {
  const request = new Request('http://localhost:3001/graph');
  assert.equal(resolveRequestOrigin(request, undefined, configured), 'http://localhost:3001');
});
