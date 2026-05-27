// Capture a 3/4-view PNG for each set in the latest batch and write it
// alongside the SVG. Reads the batch entry at the top of
// public/batches/index.json, navigates to /?wfc-seed=<seed>&nohud=1 in
// a headless Chromium, waits for the WFC layout to render, screenshots
// the canvas, and writes set-N.png next to set-N.svg.
//
// Usage:
//   node scripts/screenshot-batch.mjs               # latest batch
//   node scripts/screenshot-batch.mjs --all         # every batch in index
//   node scripts/screenshot-batch.mjs --batch <id>  # one specific batch
//
// Requires the dev server to be running on http://localhost:5173/.

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const BATCHES_DIR = 'public/batches';
const INDEX_PATH = path.join(BATCHES_DIR, 'index.json');
const SERVER = process.env.SERVER ?? 'http://localhost:5173';

const index = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
if (!index.length) { console.error('No batches in index.'); process.exit(1); }

const targets = args.all ? index
              : args.batch ? index.filter((b) => b.batchId === args.batch)
              : [index[0]];

if (targets.length === 0) { console.error('No matching batches.'); process.exit(1); }

console.log(`Screenshotting ${targets.length} batch(es) via ${SERVER}`);

const browser = await chromium.launch({ headless: true });
try {
  for (const batch of targets) {
    const outDir = path.join(BATCHES_DIR, batch.batchId);
    fs.mkdirSync(outDir, { recursive: true });
    for (let i = 0; i < batch.sets.length; i++) {
      const s = batch.sets[i];
      if (!s.ok) { console.log(`  set ${i + 1}: skipped (WFC failed)`); continue; }
      const outPath = path.join(outDir, `set-${i + 1}.png`);
      if (fs.existsSync(outPath) && !args.force) {
        console.log(`  set ${i + 1}: already exists (use --force to overwrite)`);
        continue;
      }
      const url = new URL(SERVER);
      url.searchParams.set('wfc-seed', String(s.seed));
      url.searchParams.set('nohud', '1');
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      page.on('pageerror', (err) => console.error(`  [page error] ${err.message}`));
      try {
        await page.goto(url.toString(), { waitUntil: 'networkidle' });
        // WFC build is deferred by 1 RAF + the actual solve. Give it
        // a generous settle so deck materials + train init finish.
        await page.waitForTimeout(1800);
        const canvas = await page.$('canvas#scene');
        if (!canvas) throw new Error('canvas#scene not found');
        await canvas.screenshot({ path: outPath });
        console.log(`  set ${i + 1}: wrote ${path.basename(outPath)}`);
      } finally {
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--all') out.all = true;
    else if (a === '--force') out.force = true;
    else if (a === '--batch') { out.batch = argv[++i]; }
  }
  return out;
}
