// Copies source only. Reject secret paths before any filesystem access.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, lstatSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = resolve(root, '.tailnet/source');
const paths = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root }).toString().split('\0');
for (const relative of new Set(paths)) {
  if (!relative || relative.split('/').some((part) => part === '.env' || (part.startsWith('.env.') && part !== '.env.example'))) continue;
  const source = resolve(root, relative);
  if (!lstatSync(source, { throwIfNoEntry: false })?.isFile()) continue;
  const target = resolve(destination, relative);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
}
console.log('Prepared .tailnet/source without local environment files or application data.');
