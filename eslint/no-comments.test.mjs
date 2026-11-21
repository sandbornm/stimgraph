import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Linter, RuleTester } from 'eslint';
import plugin, {
  collectForbiddenEslintDisableLines,
  disablesLocalNoComments,
  isForbiddenEslintDisable,
  isUnscopedEslintDisable,
  noCommentsRule,
} from './no-comments.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const languageOptions = { ecmaVersion: 'latest', sourceType: 'module' };

const tester = new RuleTester({ languageOptions });

const error = { messageId: 'noComments' };

tester.run('no-comments', noCommentsRule, {
  valid: [
    { code: 'export const n = 1;\n' },
    { code: '/* SPDX-License-Identifier: MIT */\nexport const n = 1;\n' },
    {
      code: '/* Copyright (c) 2026 r2brief contributors.\n * Licensed under the MIT License. */\nexport const n = 1;\n',
    },
    {
      code: '#!/usr/bin/env node\n/* SPDX-License-Identifier: MIT */\nexport const n = 1;\n',
    },
    { code: 'const x = /*#__PURE__*/ fn();\n' },
    { code: 'const x = /* #__NO_SIDE_EFFECTS__ */ fn();\n' },
    { code: 'const x = /* @__PURE__ */ fn();\n' },
    { code: 'const x = /* @__NO_SIDE_EFFECTS__ */ fn();\n' },
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
    { code: '// @ts-expect-error\nconst n = 1;\n', errors: [error] },
    {
      code: '/* @ts-expect-error the module shape is generated */\nconst n = 1;\n',
      errors: [error],
    },
    {
      code: 'const n = 1;\n/* SPDX-License-Identifier: MIT */\n',
      errors: [error],
    },
    {
      code: '#!/usr/bin/env node\nconst n = 1;\n/* SPDX-License-Identifier: MIT */\n',
      errors: [error],
    },
    {
      code: '// remember to add webpackChunkName here\nconst n = 1;\n',
      errors: [error],
    },
    {
      code: 'const mod = await import(/* not a real @vite-ignore here */ "./mod.js");\n',
      errors: [error],
    },
    {
      code: '// docs mention eslint-disable-next-line no-empty\nconst n = 1;\n',
      errors: [error],
    },
  ],
});

test('RuleTester uses node:test describe and it', () => {
  assert.equal(RuleTester.describe, describe);
  assert.equal(RuleTester.it, it);
  assert.equal(RuleTester.itOnly, it.only);
});

test('RuleTester and Linter use ecmaVersion latest so shebang fixtures parse', () => {
  assert.equal(languageOptions.ecmaVersion, 'latest');
});

const linter = new Linter({ configType: 'flat' });
const lintConfig = [
  {
    plugins: { local: plugin },
    rules: { 'local/no-comments': 'error' },
    languageOptions,
  },
];

function errors(code) {
  return linter.verify(code, lintConfig).filter((message) => message.severity === 2);
}

test('scoped eslint-disable comments are allowed', () => {
  assert.equal(
    errors('// eslint-disable-next-line no-empty\nconst n = 1;\n').length,
    0,
  );
  assert.equal(
    errors('/* eslint-disable no-empty */\nconst n = 1;\n').length,
    0,
  );
  assert.equal(
    errors('const n = 1; // eslint-disable-line no-empty\n').length,
    0,
  );
  assert.equal(
    errors('/* eslint-enable no-empty */\nconst n = 1;\n').length,
    0,
  );
});

test('an unscoped eslint-disable-next-line is reported', () => {
  const messages = errors('// eslint-disable-next-line\nconst n = 1;\n');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].ruleId, 'local/no-comments');
});

test('@ts-expect-error is allowed only as a line comment with a description', () => {
  assert.equal(
    errors('// @ts-expect-error the module shape is generated\nconst n = 1;\n').length,
    0,
  );
  assert.equal(errors('// @ts-expect-error\nconst n = 1;\n').length, 1);
  assert.equal(
    errors('/* @ts-expect-error the module shape is generated */\nconst n = 1;\n').length,
    1,
  );
});

test('a disable of local/no-comments is rejected', () => {
  const nextLine = errors('// eslint-disable-next-line local/no-comments\nconst n = 1;\n');
  assert.equal(nextLine.length, 1);
  assert.equal(nextLine[0].ruleId, 'local/no-comments');

  const blockNext = errors('/* eslint-disable-next-line local/no-comments */\nconst n = 1;\n');
  assert.equal(blockNext.length, 1);
  assert.equal(blockNext[0].ruleId, 'local/no-comments');

  const fileLevel = '/* eslint-disable local/no-comments */\nconst n = 1; // leftover why\n';
  assert.equal(errors(fileLevel).length, 0);
  assert.deepEqual(collectForbiddenEslintDisableLines(fileLevel), [1]);

  const trailing = 'const n = 1; // eslint-disable-line local/no-comments\n';
  assert.equal(errors(trailing).length, 0);
  assert.deepEqual(collectForbiddenEslintDisableLines(trailing), [1]);

  assert.equal(disablesLocalNoComments('/* eslint-disable local/no-comments */'), true);
  assert.equal(disablesLocalNoComments('/* eslint-disable no-empty, local/no-comments */'), true);
  assert.equal(disablesLocalNoComments('const n = 1; // eslint-disable-line local/no-comments'), true);
  assert.equal(disablesLocalNoComments('// eslint-disable-next-line local/no-comments -- temporary'), true);
  assert.equal(disablesLocalNoComments('/* eslint-disable no-empty */'), false);
  assert.equal(disablesLocalNoComments('/* eslint-enable local/no-comments */'), false);
  assert.deepEqual(
    collectForbiddenEslintDisableLines('/* eslint-disable no-empty, local/no-comments */\n'),
    [1],
  );
  assert.deepEqual(
    collectForbiddenEslintDisableLines('const n = 1; // eslint-disable-line no-empty\n'),
    [],
  );
});

test('a multi-line eslint-disable of local/no-comments is caught by the source scan', () => {
  const splitDirective = '/* eslint-disable\n local/no-comments */\nconst n = 1; // leftover why\n';
  assert.equal(errors(splitDirective).length, 0);
  assert.equal(isForbiddenEslintDisable('/* eslint-disable\n local/no-comments */'), true);
  assert.deepEqual(collectForbiddenEslintDisableLines(splitDirective), [1]);

  const middleLine = '/*\n  eslint-disable local/no-comments\n*/\nconst n = 1;\n';
  assert.equal(errors(middleLine).length, 0);
  assert.deepEqual(collectForbiddenEslintDisableLines(middleLine), [1]);

  const splitList = '/* eslint-disable no-empty,\n   local/no-comments */\nconst n = 1;\n';
  assert.equal(errors(splitList).length, 0);
  assert.equal(isForbiddenEslintDisable('/* eslint-disable no-empty,\n   local/no-comments */'), true);
  assert.deepEqual(collectForbiddenEslintDisableLines(splitList), [1]);
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

test('the source scan catches an unscoped trailing eslint-disable-line', () => {
  assert.deepEqual(
    collectForbiddenEslintDisableLines('const n = 1; // eslint-disable-line\n'),
    [1],
  );
  assert.deepEqual(
    collectForbiddenEslintDisableLines('const n = 1; /* eslint-disable */\n'),
    [1],
  );
  assert.deepEqual(
    collectForbiddenEslintDisableLines('const n = 1; // eslint-disable-line no-empty\n'),
    [],
  );
  assert.deepEqual(
    collectForbiddenEslintDisableLines('const n = 1;\n'),
    [],
  );
});

function scanRootFromImportMetaUrl(importMetaUrl) {
  return fileURLToPath(new URL('..', importMetaUrl));
}

test('the repo scan root is decoded with fileURLToPath', () => {
  const importMetaUrl = 'file:///tmp/my%20project/eslint/no-comments.test.mjs';
  const root = scanRootFromImportMetaUrl(importMetaUrl);
  assert.equal(root.replace(/\/$/, ''), '/tmp/my project');
  assert.notEqual(new URL('..', importMetaUrl).pathname.replace(/\/$/, ''), '/tmp/my project');
  assert.equal(
    scanRootFromImportMetaUrl(import.meta.url),
    fileURLToPath(new URL('..', import.meta.url)),
  );
});

test('source files do not use unscoped eslint-disable directives or disable local/no-comments', () => {
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
  walk(scanRootFromImportMetaUrl(import.meta.url));
  const hits = [];
  for (const path of files) {
    const source = readFileSync(path, 'utf8');
    if (collectForbiddenEslintDisableLines(source).length > 0) {
      hits.push(path);
    }
  }
  assert.deepEqual(hits, []);
});
