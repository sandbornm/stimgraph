import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';
import { createIsolatedProject, inertEnvironment, runInProject } from './isolated-project.mjs';

export async function runApiChecks(directory) {
  // Refuse an occupied port instead of sending fixture requests to another app.
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', (error) => reject(new Error(`API checks need free localhost port 3012 (${error.code}).`)));
    probe.listen(3012, '127.0.0.1', () => probe.close(resolve));
  });

  const fixtures = ['search', 'research'].map((name) => ({
    source: join(directory, 'scripts/fixtures', `${name}-route.ts`),
    target: join(directory, 'app/api', `test-${name}`),
  }));
  for (const { target } of fixtures) {
    if (existsSync(target)) throw new Error('Fixture routes must only be installed in a fresh isolated copy.');
  }
  for (const { source, target } of fixtures) {
    mkdirSync(target, { recursive: true });
    copyFileSync(source, join(target, 'route.ts'));
  }

  const server = spawn('node_modules/.bin/vinext', ['dev', '--port', '3012'], {
    cwd: directory, env: inertEnvironment(), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', exited = false, interrupted = false;
  const capture = (chunk) => { output = (output + chunk).slice(-12000); };
  server.stdout.on('data', capture); server.stderr.on('data', capture);
  const stopped = new Promise((resolve) => {
    server.once('exit', () => { exited = true; resolve(); });
    server.once('error', (error) => { capture(error.message); exited = true; resolve(); });
  });
  const interrupt = () => { interrupted = true; server.kill('SIGTERM'); };
  process.once('SIGINT', interrupt); process.once('SIGTERM', interrupt);
  try {
    const deadline = Date.now() + 30000;
    while (true) {
      if (interrupted || exited || Date.now() > deadline) throw new Error('The isolated API preview did not become ready.');
      try {
        const response = await fetch('http://127.0.0.1:3012/api/auth/x/status', { signal: AbortSignal.timeout(1000) });
        if (response.ok) break;
      } catch { /* Wait for the local preview to bind its port. */ }
      await delay(100);
    }
    console.log('API checks — disposable D1, synthetic accounts, no live provider calls');
    for (const name of ['search', 'trajectories', 'research']) {
      if (interrupted || exited) throw new Error('The isolated API preview stopped before verification finished.');
      const code = await runInProject(directory, process.execPath, [`scripts/test-${name}.mjs`]);
      if (code !== 0) throw new Error(`The ${name} API checks failed.`);
    }
  } catch (error) {
    process.stderr.write(output);
    throw error;
  } finally {
    process.removeListener('SIGINT', interrupt); process.removeListener('SIGTERM', interrupt);
    if (!exited) server.kill('SIGTERM');
    const killTimeout = setTimeout(() => server.kill('SIGKILL'), 5000).unref();
    await stopped;
    clearTimeout(killTimeout);
    for (const { target } of fixtures) rmSync(target, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const project = createIsolatedProject();
  try { await runApiChecks(project.directory); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
  finally { project.cleanup(); }
}
