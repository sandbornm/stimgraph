#!/usr/bin/env node
/**
 * Silent product walkthrough. Captions are burned in via .demo-caption.
 * Pair with public/stimgraph.context.json — that file is the agent-readable marble.
 */
import { spawn } from 'node:child_process';
import { mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'public', 'demo');
const videoDir = path.join(outDir, '.pw');
// Set these to a local Chrome/Chromium binary and a playwright-core install.
const chromeBin = process.env.STIMGRAPH_CHROME_BIN;
const playwrightCore = process.env.STIMGRAPH_PLAYWRIGHT_CORE;
if (!chromeBin || !playwrightCore) throw new Error('Set STIMGRAPH_CHROME_BIN and STIMGRAPH_PLAYWRIGHT_CORE.');
const origin = process.env.STIMGRAPH_URL ?? 'http://127.0.0.1:3001';

const beats = [
  { kicker: 'What it is', say: 'Stimgraph maps X bookmarks as a globe of topics, people, and saved posts. STIM means Stuff That Interests Me.' },
  { kicker: 'Move', say: 'Drag to spin. Scroll to zoom. Hover to read names. Click a node to focus it.' },
  { kicker: 'Focus', say: 'The inspector shows why the node is here and the nodes one link away.' },
  { kicker: 'Search', say: 'Press / or click search. Jump to a person, topic, post, or command.' },
  { kicker: 'People', say: 'People view: bookmark authors are brighter. Followed accounts with no saves are quieter.' },
  { kicker: 'Topics', say: 'Topics are lime diamonds. Click a row to fly the camera there.' },
  { kicker: 'Bookmarks', say: 'Each saved post is a small particle near its author.' },
  { kicker: 'Scout', say: 'Cyan diamonds are Grok suggestions from X, not bookmarks.' },
  { kicker: 'Neighborhood', say: 'Grow a two-step neighborhood from the focus node. Export it as a .stimgraph file with no bookmark text.' },
  { kicker: 'Combine', say: 'Import another neighborhood. Matching people and topics become highlighted bridges.' },
  { kicker: 'Tune', say: 'Density, weakest visible link, motion, overlap links, labels, and color palettes. Saved on this device.' },
  { kicker: 'Light mode', say: 'Same lime and cyan meaning on paper. Light and dark share one token set.' },
  { kicker: 'Permissions', say: 'Connect X is read-only. Sync, Grok topic names, and scout are separate clicks.' },
];

function requirePlaywright() {
  const require = createRequire(path.join(root, 'package.json'));
  try {
    return require(path.join(playwrightCore, 'index.js'));
  } catch (error) {
    throw new Error(`playwright-core not found at ${playwrightCore}: ${error instanceof Error ? error.message : error}`);
  }
}

async function caption(page, beat) {
  await page.evaluate(({ kicker, say }) => {
    let el = document.querySelector('.demo-caption');
    if (!el) {
      el = document.createElement('div');
      el.className = 'demo-caption';
      document.body.appendChild(el);
    }
    el.innerHTML = `<b>${kicker}</b>${say}`;
  }, beat);
}

async function rail(page, label) {
  await page.locator('.left-rail button', { hasText: label }).first().click();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runFfmpeg(input, output) {
  await new Promise((resolve, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-i', input,
      '-an',
      '-c:v', 'libx264',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      output,
    ], { stdio: 'inherit' });
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
  });
}

async function main() {
  const { chromium } = requirePlaywright();
  await rm(videoDir, { recursive: true, force: true });
  await mkdir(videoDir, { recursive: true });
  await mkdir(outDir, { recursive: true });

  const browser = await chromium.launch({
    executablePath: chromeBin,
    headless: true,
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  await context.addInitScript(() => {
    localStorage.setItem('stimgraph:theme', 'dark');
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: 'networkidle' });
  await page.waitForSelector('.graph-canvas');
  await sleep(900);

  await caption(page, beats[0]);
  await page.screenshot({ path: path.join(outDir, 'dark.png') });
  await sleep(3800);

  await caption(page, beats[1]);
  const canvas = page.locator('.graph-canvas');
  const box = await canvas.boundingBox();
  if (box) {
    const x = box.x + box.width * 0.42;
    const y = box.y + box.height * 0.52;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 160, y - 40, { steps: 18 });
    await page.mouse.up();
    await page.mouse.wheel(0, -280);
    await sleep(500);
    await page.mouse.wheel(0, 180);
  }
  await sleep(2200);

  await caption(page, beats[2]);
  await page.locator('.inspector h2').first().waitFor();
  await sleep(3600);

  await caption(page, beats[3]);
  await page.locator('.search-box').click();
  await page.locator('.palette-input input').fill('generative');
  await sleep(1400);
  await page.keyboard.press('Enter');
  await sleep(2400);

  await caption(page, beats[4]);
  await rail(page, 'People');
  await sleep(3200);

  await caption(page, beats[5]);
  await rail(page, 'Topics');
  await sleep(3000);

  await caption(page, beats[6]);
  await rail(page, 'Bookmarks');
  await sleep(3000);

  await caption(page, beats[7]);
  await rail(page, 'Scout');
  await sleep(3200);

  await caption(page, beats[8]);
  await rail(page, 'Neighborhood');
  await sleep(3600);

  await caption(page, beats[9]);
  await rail(page, 'Combine');
  await sleep(3800);

  await caption(page, beats[10]);
  await rail(page, 'Tune');
  await sleep(1400);
  await page.getByRole('button', { name: 'Charged' }).click();
  await sleep(1600);
  await page.getByRole('button', { name: 'ice colors' }).click();
  await sleep(1400);
  await page.getByRole('button', { name: 'phosphor colors' }).click();
  await sleep(1200);
  await page.getByRole('button', { name: 'Balanced' }).click();
  await sleep(1600);

  await caption(page, beats[11]);
  await page.locator('.theme-toggle').click();
  await sleep(800);
  await page.screenshot({ path: path.join(outDir, 'light.png') });
  await sleep(2000);
  await page.locator('.theme-toggle').click();
  await sleep(1400);
  await page.locator('.theme-toggle').click();
  await sleep(2200);

  await caption(page, beats[12]);
  await rail(page, 'Map');
  await page.locator('.permissions-link').click();
  await sleep(4200);

  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();
  const mp4 = path.join(outDir, 'stimgraph-silent.mp4');
  await runFfmpeg(webm, mp4);
  await rm(videoDir, { recursive: true, force: true });
  console.log(`wrote ${mp4}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
