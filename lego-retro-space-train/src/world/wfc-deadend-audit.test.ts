import { describe, it, expect } from 'vitest';
import { generateWFCGraph } from './wfcGenerator';
import { effectivePorts, dirVector, opposite } from './trackTile';
import { portY } from './trackLayout';

// Auditor: run a batch of generations and count tiles whose ports
// don't all connect to a neighbour at matching Y. If any exist, the
// trimDeadEnds pass has a hole.
describe('dead-end audit', () => {
  it('counts unmatched-port tiles across 20 seeds', () => {
    const reports: Array<{ seed: number; deadEnds: number; samples: string[] }> = [];
    for (let i = 0; i < 20; i++) {
      const seed = 200_000 + i * 137;
      let s = seed;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let result;
      try { result = generateWFCGraph({ size: 13, rng, maxRetries: 200 }); } catch { continue; }
      const layout = result.graph.layout;
      let deadEnds = 0;
      const samples: string[] = [];
      for (const tile of layout.tiles()) {
        if (tile.def.kind === 'station-n') continue;
        for (const p of effectivePorts(tile)) {
          const [dx, dz] = dirVector(p);
          const nx = tile.gridX + dx;
          const nz = tile.gridZ + dz;
          const wantY = portY(tile, p);
          const wantOpp = opposite(p);
          const primary = layout.get(nx, nz);
          const under = layout.getUnder(nx, nz);
          const m = (cand: typeof primary) => {
            if (!cand) return false;
            const cp = effectivePorts(cand);
            if (!cp.includes(wantOpp)) return false;
            return Math.abs(portY(cand, wantOpp) - wantY) < 0.01;
          };
          if (!m(primary) && !m(under)) {
            deadEnds++;
            if (samples.length < 3) {
              samples.push(`(${tile.gridX},${tile.gridZ}) ${tile.def.kind} rot=${tile.rotation} port=${p} y=${wantY.toFixed(2)}`);
            }
          }
        }
      }
      reports.push({ seed, deadEnds, samples });
    }
    let totalDeadEnds = 0;
    let layoutsWithDeadEnds = 0;
    for (const r of reports) {
      totalDeadEnds += r.deadEnds;
      if (r.deadEnds > 0) layoutsWithDeadEnds++;
    }
    console.log(`\nDead-end audit (${reports.length}/20 solves):`);
    console.log(`  layouts with ≥1 dead-end: ${layoutsWithDeadEnds}`);
    console.log(`  total dead-end ports: ${totalDeadEnds}`);
    for (const r of reports.filter((x) => x.deadEnds > 0).slice(0, 5)) {
      console.log(`    seed ${r.seed}: ${r.deadEnds} dead-ends — samples: ${r.samples.join('; ')}`);
    }
    expect(reports.length).toBeGreaterThan(0);
  }, 240000);
});
