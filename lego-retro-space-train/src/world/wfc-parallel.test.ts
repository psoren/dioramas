import { describe, it, expect } from 'vitest';
import { generateWFCGraph, extractGraphFromLayout } from './wfcGenerator';

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

  it('elevated graph stats with failure categorisation', () => {
    const size = 13;
    let solves = 0;
    const reasons: Record<string, number> = {};
    let elevatedBuildsOK = 0;
    let elevatedWithThroughStations = 0;
    for (let i = 0; i < 50; i++) {
      const seed = 5_000 + i * 197;
      let s = seed;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let main: ReturnType<typeof generateWFCGraph>;
      try { main = generateWFCGraph({ size, rng, maxRetries: 200 }); }
      catch { continue; }
      solves++;
      // Count parallel cells (primary ELEVATED with under at same rotation).
      let parallelCount = 0;
      for (const t of main.graph.layout.tiles()) {
        if (main.graph.layout.get(t.gridX, t.gridZ) !== t) continue;
        const under = main.graph.layout.getUnder(t.gridX, t.gridZ);
        if (!under) continue;
        const isPrimaryElevated = t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne';
        if (!isPrimaryElevated) continue;
        if (t.rotation === under.rotation) parallelCount++;
      }
      try {
        const elev = extractGraphFromLayout(main.graph.layout, rng, { preferPrimary: true });
        elevatedBuildsOK++;
        const through = elev.stations.filter((st) => st.edges.length >= 2);
        if (through.length >= 2) elevatedWithThroughStations++;
        const key = `OK (parallel=${parallelCount}, through=${through.length})`;
        reasons[key] = (reasons[key] ?? 0) + 1;
      } catch (e) {
        const msg = (e as Error).message.slice(0, 60);
        const key = `FAIL: ${msg} (parallel=${parallelCount})`;
        reasons[key] = (reasons[key] ?? 0) + 1;
      }
    }
    console.log(`\nelevated detail probe (${solves}/50 solves):`);
    console.log(`  elevated builds OK:              ${elevatedBuildsOK}/${solves}`);
    console.log(`  elevated has ≥2 through-stations ${elevatedWithThroughStations}/${solves}`);
    for (const [k, v] of Object.entries(reasons).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
      console.log(`    ${v}× ${k}`);
    }
    expect(solves).toBeGreaterThan(0);
  }, 120000);
});
