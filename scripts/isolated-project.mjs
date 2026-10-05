import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export function createIsolatedProject() {
  const root = process.cwd();
  const directory = mkdtempSync(join(tmpdir(), 'stimgraph-'));
  try {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' }).split('\0').filter(Boolean);
    for (const file of new Set(files)) {
      // Filter names before any stat/read/copy. Never traverse credential files,
      // private databases, generated output, or links to another directory.
      if (file.split('/').some((name) => name === '.env' || name.startsWith('.env.')
        || name === '.dev.vars' || name.startsWith('.dev.vars.')
        || ['.git', 'node_modules', '.wrangler', '.vinext', '.next', 'dist', '.playwright-mcp'].includes(name))
        || file.startsWith('data/') || /\.(?:db|sqlite)(?:-shm|-wal)?$/.test(file)) continue;
      const from = join(root, file);
      if (!lstatSync(from, { throwIfNoEntry: false })?.isFile()) continue;
      const to = join(directory, file);
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
    }
    symlinkSync(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export function inertEnvironment(port = 3012) {
  return { ...process.env, STIMGRAPH_DEMO: '0', X_CLIENT_ID: 'stimgraph-inert-test', X_CLIENT_SECRET: 'stimgraph-inert-test-secret',
    X_REDIRECT_URI: `http://127.0.0.1:${port}/api/auth/x/callback`, XAI_API_KEY: '', NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${port}`,
    NPM_CONFIG_IGNORE_SCRIPTS: 'true', WRANGLER_SEND_METRICS: 'false', NEXT_TELEMETRY_DISABLED: '1',
    WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_PATH: '.wrangler/logs', MINIFLARE_REGISTRY_PATH: '.wrangler/registry' };
}

export async function runInProject(directory, command, args, env = inertEnvironment()) {
  const child = spawn(command, args, { cwd: directory, env, stdio: 'inherit' });
  const interrupt = () => child.kill('SIGINT');
  const terminate = () => child.kill('SIGTERM');
  process.once('SIGINT', interrupt); process.once('SIGTERM', terminate);
  try {
    return await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code) => resolve(code ?? 130));
    });
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', terminate);
  }
}
