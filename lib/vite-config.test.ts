import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = readFileSync(join(root, 'vite.config.ts'), 'utf8');

test('Seatbelt sandboxes poll for HMR because FSEvents is blocked', () => {
  assert.match(source, /CODEX_SANDBOX === 'seatbelt'/);
  const helper = source.match(/export function seatbeltServerWatch\(\) \{([\s\S]*?)\n\}/);
  assert.ok(helper, 'seatbeltServerWatch helper is missing');
  assert.match(helper[1], /useFsEvents:\s*false/);
  assert.match(helper[1], /usePolling:\s*true/);
  assert.match(source, /isCodexSeatbeltSandbox \? seatbeltServerWatch\(\)/);
});

test('Wrangler log and registry env is set before the Cloudflare Vite plugin is imported', () => {
  const importAt = source.indexOf("import('@cloudflare/vite-plugin')");
  assert.ok(importAt > 0, 'dynamic Cloudflare plugin import is missing');
  for (const name of ['WRANGLER_WRITE_LOGS', 'WRANGLER_LOG_PATH', 'MINIFLARE_REGISTRY_PATH', 'CLOUDFLARE_DEV_REGISTRY_PATH']) {
    const at = source.indexOf('process.env.' + name);
    assert.ok(at >= 0, name + ' is missing');
    assert.ok(at < importAt, name + ' must be assigned before the plugin import');
  }
});

test('Wrangler and Miniflare defaults are project-local non-secret tool settings', () => {
  assert.match(source, /process\.env\.WRANGLER_WRITE_LOGS \?\?= 'false'/);
  assert.match(source, /process\.env\.WRANGLER_LOG_PATH \?\?= '\.wrangler\/logs'/);
  assert.match(source, /process\.env\.MINIFLARE_REGISTRY_PATH \?\?= '\.wrangler\/registry'/);
  assert.doesNotMatch(source, /['"`]\.env/);
  assert.doesNotMatch(source, /\bdotenv\b/);
  assert.doesNotMatch(source, /\bloadEnv\b/);
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\.env$/m);
  assert.match(gitignore, /^\.env\.\*$/m);
  assert.match(gitignore, /^!\.env\.example$/m);
});
