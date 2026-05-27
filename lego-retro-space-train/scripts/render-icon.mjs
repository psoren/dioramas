// One-shot: render public/icon.svg to apple-touch-icon.png at 180×180.
// Run: `node scripts/render-icon.mjs`
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const SVG = fs.readFileSync('public/icon.svg', 'utf8');
const outputs = [
  { size: 180, name: 'apple-touch-icon.png' },
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
];

const browser = await chromium.launch({ headless: true });
try {
  for (const o of outputs) {
    const page = await browser.newPage({ viewport: { width: o.size, height: o.size } });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${SVG.replace('viewBox="0 0 256 256"', `width="${o.size}" height="${o.size}" viewBox="0 0 256 256"`)}</body></html>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join('public', o.name), omitBackground: false });
    await page.close();
    console.log(`wrote public/${o.name}`);
  }
} finally {
  await browser.close();
}
