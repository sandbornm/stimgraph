import { createIsolatedProject, inertEnvironment, runInProject } from './isolated-project.mjs';

const port = Number(process.argv[2] ?? 3001);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a port between 1024 and 65535.');
const project = createIsolatedProject();
console.log(`Demo at http://127.0.0.1:${port}. Temporary data; no local credentials loaded. Use pnpm dev for your connected collection.`);
try {
  const code = await runInProject(project.directory, 'node_modules/.bin/vinext', ['dev', '--port', String(port)], {
    ...inertEnvironment(port), STIMGRAPH_DEMO: '1', X_CLIENT_ID: '', X_CLIENT_SECRET: '', X_REDIRECT_URI: '',
  });
  if (code !== 130) process.exitCode = code;
} finally { project.cleanup(); }
