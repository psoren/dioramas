import { describe, it, expect } from 'vitest';
import { generateWFCGraph } from './wfcGenerator';

// One-off probe — not a real test. Run with `npx vitest run wfc-density`
// to see how dense the WFC produces layouts across a batch of seeds
// after EMPTY was removed from the variant pool.
describe('WFC density probe', () => {
  it('measures density across 20 random seeds at 13x13', () => {
    const size = 13;
    const totalCells = size * size;
    const samples: Array<{ seed: number; filled: number; pct: number; retries: number; ok: boolean }> = [];
    let failures = 0;
    for (let i = 0; i < 20; i++) {
      const seed = 1_000 + i * 137;
      // deterministic mulberry32
      let s = seed;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        const result = generateWFCGraph({ size, rng, maxRetries: 200 });
        const filledKeys = new Set(result.graph.layout.tiles().map((t) => `${t.gridX},${t.gridZ}`));
        const filled = filledKeys.size;
        samples.push({ seed, filled, pct: filled / totalCells, retries: result.retries, ok: true });
      } catch (e) {
        failures++;
        samples.push({ seed, filled: 0, pct: 0, retries: -1, ok: false });
        if (i < 3) console.log(`  seed ${seed} failed: ${(e as Error).message.slice(0, 300)}`);
      }
    }
    const oks = samples.filter((s) => s.ok);
    const avgPct = oks.reduce((a, b) => a + b.pct, 0) / Math.max(1, oks.length);
    const avgRetries = oks.reduce((a, b) => a + b.retries, 0) / Math.max(1, oks.length);
    const minPct = Math.min(...oks.map((s) => s.pct));
    const maxPct = Math.max(...oks.map((s) => s.pct));
    console.log(`\nWFC density probe (21x21 = ${totalCells} cells):`);
    console.log(`  successes: ${oks.length}/${samples.length} (failures: ${failures})`);
    console.log(`  density mean=${(avgPct * 100).toFixed(1)}% min=${(minPct * 100).toFixed(1)}% max=${(maxPct * 100).toFixed(1)}%`);
    console.log(`  retries mean=${avgRetries.toFixed(1)}`);
    for (const s of samples) {
      if (!s.ok) { console.log(`  seed ${s.seed}: FAILED`); continue; }
      console.log(`  seed ${s.seed}: ${s.filled}/${totalCells} = ${(s.pct * 100).toFixed(1)}%  retries=${s.retries}`);
    }
    expect(oks.length).toBeGreaterThan(0);
  }, 60000);
});
