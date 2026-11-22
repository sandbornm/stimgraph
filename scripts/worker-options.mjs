import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';

export function builtWorkerOptions(source) {
  const modulesRoot = resolve(source, 'dist/server');
  const chunks = readdirSync(modulesRoot, { recursive: true })
    .filter((path) => path.endsWith('.js') && path !== 'index.js');
  return {
    modulesRoot,
    modules: ['index.js', ...chunks].map((path) => ({ type: 'ESModule', path: resolve(modulesRoot, path) })),
    compatibilityDate: '2026-05-15', compatibilityFlags: ['nodejs_compat'],
    assets: { directory: resolve(source, 'dist/client'), binding: 'ASSETS',
      routerConfig: { has_user_worker: true, invoke_user_worker_ahead_of_assets: true } },
  };
}
