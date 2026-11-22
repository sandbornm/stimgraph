const LICENSE_HEADER =
  /SPDX-License-Identifier\s*:|SPDX-FileCopyrightText\s*:|@license\b|licensed under\b|all rights reserved\b/i;
const COPYRIGHT = /\bcopyright\b|\(c\)|©/i;
const BUNDLER_MAGIC =
  /^(?:webpack(?:ChunkName|Prefetch|Preload|Mode|Ignore|Exports|Include|Exclude)|@vite-ignore|[@#]__(?:PURE|NO_SIDE_EFFECTS)__|#__(?:INLINE|MANGLE_PROP)__)\b/;
const TS_EXPECT_ERROR = /^@ts-expect-error\s+\S/;
const RULE_NAME = '@?[\\w-]+(?:/[\\w-]+)*';
const RULE_LIST = `${RULE_NAME}(?:\\s*,\\s*${RULE_NAME})*`;
const DIRECTIVE_REASON = '(?:\\s*--\\s*\\S.*)?';
const WELL_FORMED_DISABLE = new RegExp(
  `^eslint-disable(?:-next-line|-line)?\\s+${RULE_LIST}${DIRECTIVE_REASON}$`,
);
const WELL_FORMED_ENABLE = new RegExp(
  `^eslint-enable(?:\\s+${RULE_LIST})?${DIRECTIVE_REASON}$`,
);

function normalizeDirectiveBody(text) {
  const comment = /(?:\/\/|\/\*)\s*(eslint-(?:disable(?:-next-line|-line)?|enable)(?![\w-])[\s\S]*)$/.exec(
    text.trim(),
  );
  return (comment ? comment[1] : text.trim())
    .replace(/^\/\/\s*/, '')
    .replace(/^\/\*\s*/, '')
    .replace(/\s*\*\/$/, '')
    .split('\n')
    .map((line) => line.replace(/^\s*\*/, '').trim())
    .join('\n')
    .trim()
    .replace(/\s+/g, ' ');
}

function eslintDisableRuleList(text) {
  const body = normalizeDirectiveBody(text);
  const match = /^eslint-disable(?:-next-line|-line)?(?![\w-])(.*)$/.exec(body);
  if (!match) {
    return null;
  }
  return match[1].replace(/--.*$/, '').trim();
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

function isWellFormedEslintDisable(text) {
  return WELL_FORMED_DISABLE.test(normalizeDirectiveBody(text))
    && !isForbiddenEslintDisable(text);
}

function isWellFormedEslintEnable(text) {
  return WELL_FORMED_ENABLE.test(normalizeDirectiveBody(text));
}

function commentText(comment) {
  return comment.value.trim();
}

function isLicenseText(text) {
  if (LICENSE_HEADER.test(text)) {
    return true;
  }
  return COPYRIGHT.test(text) && /\blicen[sc]e\b/i.test(text);
}

function isTripleSlashReference(comment) {
  return comment.type === 'Line' && /^\/\s*<reference\b.*>\s*$/.test(commentText(comment));
}

function isHeaderComment(comment) {
  if (comment.type === 'Shebang') {
    return true;
  }
  if (isTripleSlashReference(comment)) {
    return true;
  }
  return isLicenseText(commentText(comment));
}

function isInLeadingHeaderBlock(comment, source) {
  if (!isHeaderComment(comment)) {
    return false;
  }
  const text = source.getText();
  let pos = 0;
  const shebang = /^#!.*\r?\n/.exec(text);
  if (shebang) {
    pos = shebang[0].length;
  }
  const comments = source.getAllComments().slice().sort((a, b) => a.range[0] - b.range[0]);
  for (const candidate of comments) {
    if (candidate.range[0] < pos) {
      continue;
    }
    if (!/^\s*$/.test(text.slice(pos, candidate.range[0]))) {
      return false;
    }
    if (!isHeaderComment(candidate)) {
      return false;
    }
    if (candidate.range[0] === comment.range[0] && candidate.range[1] === comment.range[1]) {
      return true;
    }
    pos = candidate.range[1];
  }
  return false;
}

function isTsExpectError(comment) {
  return comment.type === 'Line' && TS_EXPECT_ERROR.test(commentText(comment));
}

function isAllowed(comment, source) {
  if (comment.type === 'Shebang') {
    return true;
  }
  const text = commentText(comment);
  if (isInLeadingHeaderBlock(comment, source)) {
    return true;
  }
  if (BUNDLER_MAGIC.test(text)) {
    return true;
  }
  if (isForbiddenEslintDisable(text)) {
    return false;
  }
  if (isWellFormedEslintDisable(text) || isWellFormedEslintEnable(text)) {
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
