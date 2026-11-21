import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/globals.css'), 'utf8');

test('active bookmark chips use explicit foreground and background tokens, not currentColor', () => {
  const match = css.match(/\.bm-chip\.on\s*\{([^}]*)\}/);
  assert.ok(match, '.bm-chip.on rule is missing');
  assert.match(match[1], /background:\s*var\(--fg/);
  assert.match(match[1], /border-color:\s*var\(--fg/);
  assert.doesNotMatch(match[1], /background:\s*currentColor/);
  const text = css.match(/\.bm-chip\.on,\s*\.bm-chip\.on small\s*\{([^}]*)\}/);
  assert.ok(text, '.bm-chip.on text rule is missing');
  assert.match(text[1], /color:\s*var\(--bg/);
});
