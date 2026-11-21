import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Linter } from 'eslint';
import { RuleTester } from 'eslint';
import plugin, { isUnscopedEslintDisable, noCommentsRule } from './no-comments.js';

const tester = new RuleTester({
  languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
});

const error = { messageId: 'noComments' };

test('local/no-comments allowlist and rejections', () => {
  tester.run('no-comments', noCommentsRule, {
    valid: [
      { code: 'export const n = 1;\n' },
      { code: '/* SPDX-License-Identifier: MIT */\nexport const n = 1;\n' },
      {
        code: '/* Copyright (c) 2026 r2brief contributors.\n * Licensed under the MIT License. */\nexport const n = 1;\n',
      },
      { code: 'const x = /*#__PURE__*/ fn();\n' },
      { code: 'const x = /* #__NO_SIDE_EFFECTS__ */ fn();\n' },
      {
        code: 'const mod = await import(/* webpackChunkName: "mod" */ "./mod.js");\n',
      },
      {
        code: 'const mod = await import(/* @vite-ignore */ "./mod.js");\n',
      },
      { code: '// @ts-expect-error the module shape is generated\nconst n = 1;\n' },
    ],
    invalid: [
      { code: '// leftover note\nconst n = 1;\n', errors: [error] },
      { code: '/* section label */\nconst n = 1;\n', errors: [error] },
      { code: 'const n = 1; // trailing why\n', errors: [error] },
      { code: '// TODO: later\nconst n = 1;\n', errors: [error] },
      { code: '// @ts-ignore hidden any\nconst n = 1;\n', errors: [error] },
      { code: '// @ts-nocheck\nconst n = 1;\n', errors: [error] },
      {
        code: 'const n = 1;\n/* SPDX-License-Identifier: MIT */\n',
        errors: [error],
      },
    ],
  });
});

const linter = new Linter({ configType: 'flat' });
const lintConfig = [
  {
    plugins: { local: plugin },
    rules: { 'local/no-comments': 'error' },
    languageOptions: { ecmaVersion: 2022, sourceType: 'module' },
  },
];

function errors(code) {
  return linter.verify(code, lintConfig).filter((message) => message.severity === 2);
}

test('scoped eslint-disable comments are allowed', () => {
  assert.equal(
    errors('// eslint-disable-next-line local/no-comments\nconst n = 1;\n').length,
    0,
  );
  assert.equal(
    errors('/* eslint-disable local/no-comments */\nconst n = 1;\n').length,
    0,
  );
  assert.equal(
    errors('const n = 1; // eslint-disable-line local/no-comments\n').length,
    0,
  );
  assert.equal(
    errors('/* eslint-enable local/no-comments */\nconst n = 1;\n').length,
    0,
  );
});

test('an unscoped eslint-disable-next-line is reported', () => {
  const messages = errors('// eslint-disable-next-line\nconst n = 1;\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'local/no-comments');
});


test('scoped eslint-disable-next-line directives are not treated as unscoped', () => {
  assert.equal(isUnscopedEslintDisable('// eslint-disable-next-line local/no-comments'), false);
  assert.equal(isUnscopedEslintDisable('const n = 1; // eslint-disable-next-line no-empty'), false);
  assert.equal(isUnscopedEslintDisable('/* eslint-disable-next-line no-empty -- temporary */'), false);
  assert.equal(isUnscopedEslintDisable('/* eslint-disable no-empty, local/no-comments */'), false);
  assert.equal(isUnscopedEslintDisable('// eslint-disable-next-line'), true);
  assert.equal(isUnscopedEslintDisable('const n = 1; // eslint-disable-line'), true);
  assert.equal(isUnscopedEslintDisable('/* eslint-disable */'), true);
});

test('source files do not use unscoped eslint-disable directives', async () => {
  const { readdirSync, readFileSync, statSync } = await import('node:fs');
  const { join } = await import('node:path');
  const skip = new Set(['node_modules', 'dist', '.next', '.git', '.wrangler']);
  const files = [];
  function walk(dir) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const path = join(dir, name);
      const stat = statSync(path);
      if (stat.isDirectory()) walk(path);
      else if (/\.(?:[cm]?js|jsx|ts|tsx|mts|cts)$/.test(name) && !name.endsWith('.test.mjs') && !name.endsWith('.test.js')) {
        files.push(path);
      }
    }
  }
  walk(new URL('..', import.meta.url).pathname);
  const hits = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('//') && !trimmed.includes('/*') && !trimmed.includes('*/')) {
        continue;
      }
      if (isUnscopedEslintDisable(trimmed)) hits.push(path);
    }
  }
  assert.deepEqual(hits, []);
});
