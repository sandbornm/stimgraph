import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { dependencyViolations, lockfileViolations, pinsFromPackageJson, type DirectPins } from './dependency-floor.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const safe: DirectPins = {
  next: '16.4.5',
  eslintConfigNext: '16.4.5',
  react: '19.3.1',
  reactDom: '19.3.1',
  reactServerDomWebpack: '19.3.1',
};

describe('dependency floor', () => {
  it('accepts the patched Next and React Server DOM pins', () => {
    assert.deepEqual(dependencyViolations(safe), []);
    for (const version of ['19.0.9', '19.1.10', '19.2.9', '19.3.2']) {
      assert.deepEqual(dependencyViolations({ ...safe, react: version, reactDom: version, reactServerDomWebpack: version }), []);
    }
  });

  it('rejects Next below 16.4.1', () => {
    assert.match(dependencyViolations({ ...safe, next: '16.4.0' }).join('\n'), /next 16\.4\.0 is below 16\.4\.1/);
    assert.match(dependencyViolations({ ...safe, next: '16.2.6' }).join('\n'), /next 16\.2\.6 is below 16\.4\.1/);
    assert.match(dependencyViolations({ ...safe, eslintConfigNext: '16.4.0' }).join('\n'), /eslint-config-next 16\.4\.0 is below 16\.4\.1/);
  });

  it('rejects a React Server DOM build outside the patched set', () => {
    for (const version of ['19.0.8', '19.1.9', '19.2.8', '19.3.0']) {
      const violations = dependencyViolations({ ...safe, react: version, reactDom: version, reactServerDomWebpack: version });
      assert.match(violations.join('\n'), new RegExp(`react-server-dom-webpack ${version.replaceAll('.', '\\.')} is not in the patched set`));
    }
  });

  it('rejects a React, React DOM, and React Server DOM mismatch', () => {
    const violations = dependencyViolations({ ...safe, reactDom: '19.3.0' });
    assert.match(violations.join('\n'), /do not match/);
  });

  it('rejects a lockfile that reintroduces a vulnerable Next or React Server DOM pin', () => {
    const patched = '  next@16.4.5:\n  eslint-config-next@16.4.5:\n  react-server-dom-webpack@19.3.1:\n';
    assert.deepEqual(lockfileViolations(patched), []);
    assert.match(lockfileViolations(patched.replace('next@16.4.5', 'next@16.2.6')).join('\n'), /next@16\.2\.6/);
    assert.match(lockfileViolations(patched.replace('react-server-dom-webpack@19.3.1', 'react-server-dom-webpack@19.3.0')).join('\n'), /react-server-dom-webpack@19\.3\.0/);
  });

  it('accepts the repository manifest and lockfile', () => {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    assert.deepEqual(dependencyViolations(pinsFromPackageJson(manifest)), []);
    assert.deepEqual(lockfileViolations(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')), []);
  });
});
