import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createIsolatedProject, runInProject } from './isolated-project.mjs';
import { runApiChecks } from './test-api.mjs';

const project = createIsolatedProject();
try {
  const tests = readdirSync(join(project.directory, 'lib')).filter((name) => name.endsWith('.test.ts')).map((name) => `lib/${name}`);
  for (const [label, command, args] of [
    ['Tests', process.execPath, ['--experimental-strip-types', '--test', ...tests]],
    ['Lint', 'node_modules/.bin/eslint', ['.', '--ignore-pattern', 'dist', '--ignore-pattern', '.next']],
    ['Types', 'node_modules/.bin/tsc', ['--noEmit']],
    ['Build', 'node_modules/.bin/vinext', ['build']],
  ]) {
    console.log(`\n${label} — isolated source, inert credentials`);
    const code = await runInProject(project.directory, command, args);
    if (code !== 0) { process.exitCode = code; break; }
  }
  if (!process.exitCode) {
    await runApiChecks(project.directory);
    console.log('\nVerification passed. No local environment files were loaded.');
  }
} finally { project.cleanup(); }
