const LICENSE_HEADER =
  /SPDX-License-Identifier\s*:|@license\b|licensed under\b|all rights reserved\b/i;
const COPYRIGHT = /\bcopyright\b|\(c\)|©/i;
const BUNDLER_MAGIC =
  /^(?:webpack(?:ChunkName|Prefetch|Preload|Mode|Ignore|Exports|Include|Exclude)|@vite-ignore|[@#]__(?:PURE|NO_SIDE_EFFECTS)__|#__(?:INLINE|MANGLE_PROP)__)\b/;
const ESLINT_ENABLE = /^\s*eslint-enable\b/;
const TS_EXPECT_ERROR = /^@ts-expect-error\s+\S/;

function eslintDisableRuleList(text) {
  const comment = /(?:\/\/|\/\*)\s*(eslint-disable(?:-next-line|-line)?(?![\w-])[\s\S]*)$/.exec(
    text.trim(),
  );
  const body = (comment ? comment[1] : text.trim())
    .replace(/^\/\/\s*/, '')
    .replace(/^\/\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*/, '').trim())
    .join('\n')
    .trim();
  const match = /^eslint-disable(?:-next-line|-line)?(?![\w-])([\s\S]*)$/.exec(body);
  if (!match) {
    return null;
  }
  return match[1].replace(/--[\s\S]*$/, '').trim();
}

export function isUnscopedEslintDisable(text) {
  const list = eslintDisableRuleList(text);
  return list !== null && list.length === 0;
}

export function disablesLocalNoComments(text) {
  const list = eslintDisableRuleList(text);
  if (!list) {
    return false;
  }
  return list.split(',').some((name) => name.trim() === 'local/no-comments');
}

export function isForbiddenEslintDisable(text) {
  return isUnscopedEslintDisable(text) || disablesLocalNoComments(text);
}

export function collectForbiddenEslintDisableLines(source) {
  const lines = new Set();
  const lineAt = (index) => source.slice(0, index).split('\n').length;
  const blockRanges = [];
  for (const match of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    blockRanges.push([match.index, match.index + match[0].length]);
    if (isForbiddenEslintDisable(match[0])) {
      lines.add(lineAt(match.index));
    }
  }
  const inBlock = (index) => blockRanges.some(([start, end]) => index >= start && index < end);
  let index = 0;
  for (const line of source.split('\n')) {
    if (!inBlock(index) && isForbiddenEslintDisable(line)) {
      lines.add(lineAt(index));
    }
    index += line.length + 1;
  }
  return [...lines].sort((a, b) => a - b);
}

function isScopedEslintDisable(text) {
  const body = text.trim();
  return /^eslint-disable(?:-next-line|-line)?(?![\w-])\s+\S/.test(body)
    && !isForbiddenEslintDisable(body);
}

function commentText(comment) {
  return comment.value.trim();
}

function isBeforeCode(comment, source) {
  const start = comment.range[0];
  return /^(?:#!.*\r?\n)?\s*$/.test(source.getText().slice(0, start));
}

function isLicenseHeader(comment, source) {
  if (!isBeforeCode(comment, source)) {
    return false;
  }
  const text = commentText(comment);
  if (LICENSE_HEADER.test(text)) {
    return true;
  }
  return COPYRIGHT.test(text) && /\blicen[sc]e\b/i.test(text);
}

function isTsExpectError(comment) {
  return comment.type === 'Line' && TS_EXPECT_ERROR.test(commentText(comment));
}

function isAllowed(comment, source) {
  if (comment.type === 'Shebang') {
    return true;
  }
  const text = commentText(comment);
  if (isLicenseHeader(comment, source)) {
    return true;
  }
  if (BUNDLER_MAGIC.test(text)) {
    return true;
  }
  if (isForbiddenEslintDisable(text)) {
    return false;
  }
  if (isScopedEslintDisable(text) || ESLINT_ENABLE.test(text)) {
    return true;
  }
  if (isTsExpectError(comment)) {
    return true;
  }
  return false;
}

export const noCommentsRule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow comments except license headers, bundler magic, scoped eslint-disable, and @ts-expect-error',
    },
    schema: [],
    messages: {
      noComments:
        'Remove this comment, or encode the constraint as a test, type, or lint rule.',
    },
  },
  create(context) {
    const source = context.sourceCode;
    return {
      Program() {
        for (const comment of source.getAllComments()) {
          if (!isAllowed(comment, source)) {
            context.report({ loc: comment.loc, messageId: 'noComments' });
          }
        }
      },
    };
  },
};

const plugin = {
  meta: { name: 'local', version: '1.0.0' },
  rules: { 'no-comments': noCommentsRule },
};

export default plugin;
