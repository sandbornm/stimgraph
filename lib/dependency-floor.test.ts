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

  it('rejects Next 16.4.4 and earlier releases', () => {
    for (const version of ['16.4.4', '16.4.3', '16.4.0', '16.2.6']) {
      const pattern = version.replaceAll('.', '\\.');
      assert.match(dependencyViolations({ ...safe, next: version }).join('\n'), new RegExp(`next ${pattern} is below 16\\.4\\.5`));
      assert.match(dependencyViolations({ ...safe, eslintConfigNext: version }).join('\n'), new RegExp(`eslint-config-next ${pattern} is below 16\\.4\\.5`));
    }
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

  it('rejects a lockfile that reintroduces an old Next, React, brace-expansion, or esbuild pin', () => {
    const patched = [
      '  next@16.4.5:',
      '  eslint-config-next@16.4.5:',
      '  react@19.3.1:',
      '  react-dom@19.3.1:',
      '  react-server-dom-webpack@19.3.1:',
      '  brace-expansion@1.1.21:',
      '  brace-expansion@5.0.12:',
      '  esbuild@0.25.12:',
      '  esbuild@0.28.2:',
      '  esbuild@<=0.24.2: 0.25.12',
    ].join('\n');
    assert.deepEqual(lockfileViolations(patched), []);
    assert.match(lockfileViolations(patched.replace('next@16.4.5', 'next@16.4.4')).join('\n'), /next@16\.4\.4 is below 16\.4\.5/);
    assert.match(lockfileViolations(patched.replace('react-dom@19.3.1', 'react-dom@19.3.0')).join('\n'), /do not match/);
    assert.match(lockfileViolations(patched.replace('brace-expansion@1.1.21', 'brace-expansion@1.1.18')).join('\n'), /brace-expansion@1\.1\.18 is below 1\.1\.21/);
    assert.match(lockfileViolations(patched.replace('esbuild@0.25.12', 'esbuild@0.24.2')).join('\n'), /esbuild@0\.24\.2 is at or below 0\.24\.2/);
    assert.match(lockfileViolations(patched.replace('esbuild@0.28.2', 'esbuild@0.18.20')).join('\n'), /esbuild@0\.18\.20 is at or below 0\.24\.2/);
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
