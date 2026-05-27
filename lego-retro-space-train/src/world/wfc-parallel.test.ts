import { describe, it, expect } from 'vitest';
import { generateWFCGraph } from './wfcGenerator';

// Quick probe — do parallel-overpass cells ever survive into the final
// layout? They form isolated rings so keepOnlyLargestComponent drops
// most of them; let's measure the rate.
describe('parallel overpass probe', () => {
  it('counts parallel-overpass cells across 30 random seeds', () => {
    const size = 13;
    let totalParallelCells = 0;
    let layoutsWithParallel = 0;
    let solves = 0;
    for (let i = 0; i < 30; i++) {
      const seed = 1_000 + i * 137;
      let s = seed;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        const result = generateWFCGraph({ size, rng, maxRetries: 200 });
        solves++;
        // A parallel overpass decomposes to ELEVATED + STRAIGHT (or CURVE)
        // at the SAME rotation. Detect by checking matching rotations.
        let cellsHere = 0;
        for (const t of result.graph.layout.tiles()) {
          if (result.graph.layout.get(t.gridX, t.gridZ) !== t) continue; // primary only
          const under = result.graph.layout.getUnder(t.gridX, t.gridZ);
          if (!under) continue;
          const isPrimaryElevated = t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne';
          if (!isPrimaryElevated) continue;
          if (t.rotation === under.rotation) cellsHere++;
        }
        totalParallelCells += cellsHere;
        if (cellsHere > 0) layoutsWithParallel++;
      } catch { /* WFC failed */ }
    }
    console.log(`\nparallel-overpass probe (${solves}/30 solves):`);
    console.log(`  layouts with ≥1 parallel-overpass cell: ${layoutsWithParallel}/${solves}`);
    console.log(`  total parallel cells across all solves: ${totalParallelCells}`);
    expect(solves).toBeGreaterThan(0);
  }, 90000);
});
