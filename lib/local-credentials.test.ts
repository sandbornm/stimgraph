import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLocalCredentials } from './local-credentials.ts';

const names = ['X_CLIENT_ID', 'X_CLIENT_SECRET', 'STIMGRAPH_TOKEN_KEY', 'XAI_API_KEY', 'TYPESAFE_API_KEY'];

function isolateEnv(run: () => void) {
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const source = process.env.STIMGRAPH_CREDENTIAL_SOURCE;
  for (const name of names) delete process.env[name];
  try {
    run();
  } finally {
    process.env.STIMGRAPH_CREDENTIAL_SOURCE = source;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}

test('keychain lookups stay silent when security fails with captured output', () => {
  isolateEnv(() => {
    process.env.STIMGRAPH_CREDENTIAL_SOURCE = 'keychain';
    const messages: string[] = [];
    const original = { log: console.log, info: console.info, warn: console.warn, error: console.error };
    console.log = (...args: unknown[]) => { messages.push(String(args)); };
    console.info = (...args: unknown[]) => { messages.push(String(args)); };
    console.warn = (...args: unknown[]) => { messages.push(String(args)); };
    console.error = (...args: unknown[]) => { messages.push(String(args)); };
    try {
      loadLocalCredentials((() => {
        const error = new Error('find-generic-password failed: secret-token-do-not-log');
        throw error;
      }) as typeof import('node:child_process').execFileSync);
    } finally {
      Object.assign(console, original);
    }
    for (const name of names) assert.equal(process.env[name], undefined);
    assert.equal(messages.join('\n').includes('secret-token-do-not-log'), false);
  });
});

test('keychain lookups discard stderr from the security child process', () => {
  isolateEnv(() => {
    process.env.STIMGRAPH_CREDENTIAL_SOURCE = 'keychain';
    const seen: Array<{ stdio?: unknown }> = [];
    loadLocalCredentials(((command, args, options) => {
      seen.push(options as { stdio?: unknown });
      return 'ok-value\n';
    }) as typeof import('node:child_process').execFileSync);
    assert.ok(seen.length > 0);
    for (const options of seen) {
      assert.deepEqual(options.stdio, ['ignore', 'pipe', 'ignore']);
    }
    assert.equal(process.env.X_CLIENT_ID, 'ok-value');
  });
});
