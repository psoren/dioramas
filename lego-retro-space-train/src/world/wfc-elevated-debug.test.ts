import { describe, it, expect } from 'vitest';
import { generateWFCGraph, extractGraphFromLayout } from './wfcGenerator';
import { effectivePorts } from './trackTile';
import { portY } from './trackLayout';

// Reproduce a known elevated-trace dead-end and dump the cells around
// the failure so we can see exactly what tile combo is breaking the
// preferPrimary trace.
describe('elevated trace dead-end diag', () => {
  it('finds a failing seed and dumps the neighbourhood', () => {
    let found: { seed: number; err: string; layout: ReturnType<typeof generateWFCGraph>['graph']['layout'] } | null = null;
    for (let i = 0; i < 100 && !found; i++) {
      let s = 200_000 + i * 503;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      let main;
      try { main = generateWFCGraph({ size: 13, rng, maxRetries: 200 }); } catch { continue; }
      try {
        extractGraphFromLayout(main.graph.layout, rng, { preferPrimary: true });
      } catch (e) {
        found = { seed: 200_000 + i * 503, err: (e as Error).message, layout: main.graph.layout };
      }
    }
    if (!found) { console.log('no failing seed found in 100 tries'); return; }
    console.log(`failing seed: ${found.seed}`);
    console.log('error:', found.err);
    const match = found.err.match(/\((-?\d+),(-?\d+)\) y=([0-9.]+)/);
    if (!match) { console.log('no match'); return; }
    const fx = Number(match[1]);
    const fz = Number(match[2]);
    const fy = Number(match[3]);
    console.log(`fail cell (${fx},${fz}) y=${fy}`);
    const layout = found.layout;
    // Dump 3×3 around the failure.
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const gx = fx + dx;
        const gz = fz + dz;
        const primary = layout.get(gx, gz);
        const under = layout.getUnder(gx, gz);
        const fmt = (tag: string, t: typeof primary) => {
          if (!t) return `${tag}: -`;
          const ports = effectivePorts(t);
          const ys = ports.map((p) => `${p}@${portY(t, p).toFixed(2)}`).join(',');
          return `${tag}: ${t.def.kind} rot=${t.rotation} L=${t.level ?? 0} ports=${ys}`;
        };
        console.log(`  (${gx},${gz})  ${fmt('P', primary)}  |  ${fmt('U', under)}`);
      }
    }
    expect(true).toBe(true);
  });
});
