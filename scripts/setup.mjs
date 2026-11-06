#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = false;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m, fix) => { failed = true; console.log(`  FAIL ${m}\n       fix: ${fix}`); };

console.log('stimgraph setup\n');

const [maj, min] = process.versions.node.split('.').map(Number);
if (maj > 22 || (maj === 22 && min >= 13)) ok(`Node ${process.versions.node} (need >= 22.13)`);
else bad(`Node ${process.versions.node} is too old (need >= 22.13)`, 'nvm install 22 && nvm use (reads .nvmrc)');

let pnpm = null;
try { pnpm = execSync('pnpm --version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
if (pnpm && Number(pnpm.split('.')[0]) >= 10) ok(`pnpm ${pnpm}`);
else bad(pnpm ? `pnpm ${pnpm} is too old (need 10)` : 'pnpm not found', 'corepack enable   (then re-run: node scripts/setup.mjs)');

try { execSync('git --version', { stdio: 'ignore' }); ok('git'); } catch { bad('git not found', 'install git'); }

const example = path.join(root, '.env.example');
const local = path.join(root, '.env.local');
if (existsSync(local)) ok('.env.local already exists (left untouched)');
else { copyFileSync(example, local); ok('created .env.local from .env.example'); }

console.log('');
if (failed) { console.log('Fix the FAIL lines above, then run this again.'); process.exit(1); }
console.log(`Next:
  1. Edit .env.local: set X_CLIENT_ID, X_CLIENT_SECRET (from your X developer app).
     Without them the app still runs and shows the built-in DEMO collection.
  2. pnpm install --frozen-lockfile
  3. pnpm dev        ->  http://127.0.0.1:3001`);
