// Unit-test layouts: run each registered generator against a fixed
// set of seeds and assert structural properties. Catches regressions
// in connectivity, dead-end handling, station/junction placement, and
// graph correctness.
//
// Adding a new generator? Register it in generators/index.ts and these
// tests run against it automatically.

import { describe, it, expect } from 'vitest';
import { GENERATORS } from './index';
import { effectivePorts, dirVector, opposite } from '../trackTile';
import { portY } from '../trackLayout';

const SEEDS = [12345, 67890, 24680, 13579, 99999];
const SIZE = 13;

// Mulberry32: deterministic given a seed, used so tests are
// reproducible across machines.
function mkRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Iterate every (generator, seed) pair so failures pinpoint exactly
// which algorithm broke on which seed.
for (const algoName of Object.keys(GENERATORS)) {
  const generator = GENERATORS[algoName]!;
  describe(`generator: ${algoName}`, () => {
    for (const seed of SEEDS) {
      describe(`seed ${seed}`, () => {
        const result = (() => {
          try {
            return generator({ size: SIZE, rng: mkRng(seed), maxRetries: 200 });
          } catch (e) {
            return { error: e as Error };
          }
        })();

        it('produces a result without throwing', () => {
          if ('error' in result) throw result.error;
          expect(result.graph).toBeDefined();
        });

        if ('error' in result) return; // skip further checks if it threw

        const { graph, stations, junctions } = result;

        it('layout has at least 4 tiles', () => {
          expect(graph.layout.tiles().length).toBeGreaterThanOrEqual(4);
        });

        it('layout has no dead-end ports', () => {
          // Every port of every tile (except 1-port STATION_N) must
          // have a neighbour tile with a matching port at matching Y.
          const layout = graph.layout;
          const deadEnds: string[] = [];
          for (const t of layout.tiles()) {
            if (t.def.kind === 'station-n') continue;
            for (const p of effectivePorts(t)) {
              const [dx, dz] = dirVector(p);
              const nx = t.gridX + dx;
              const nz = t.gridZ + dz;
              const wantY = portY(t, p);
              const wantOpp = opposite(p);
              const primary = layout.get(nx, nz);
              const under = layout.getUnder(nx, nz);
              const matches = (cand: typeof primary) => {
                if (!cand) return false;
                const cp = effectivePorts(cand);
                if (!cp.includes(wantOpp)) return false;
                return Math.abs(portY(cand, wantOpp) - wantY) < 0.01;
              };
              if (!matches(primary) && !matches(under)) {
                deadEnds.push(`(${t.gridX},${t.gridZ}) ${t.def.kind} rot=${t.rotation} port=${p}@Y=${wantY.toFixed(2)}`);
              }
            }
          }
          expect(deadEnds, deadEnds.join('; ')).toEqual([]);
        });

        it('has at least 1 junction (3+ port tile)', () => {
          expect(junctions.length).toBeGreaterThanOrEqual(1);
        });

        it('has at least 2 stations', () => {
          expect(stations.length).toBeGreaterThanOrEqual(2);
        });

        it('has at least 2 through-stations in the largest connected group', () => {
          const through = stations.filter((s) => s.edges.length >= 2);
          // Group through-stations by connected sub-graph.
          const groups: number[] = [];
          const assigned = new Set<typeof through[number]>();
          for (const s of through) {
            if (assigned.has(s)) continue;
            assigned.add(s);
            let count = 1;
            for (const other of through) {
              if (assigned.has(other)) continue;
              if (graph.shortestPath(s, other) !== null) {
                assigned.add(other);
                count++;
              }
            }
            groups.push(count);
          }
          const largest = groups.reduce((a, b) => Math.max(a, b), 0);
          expect(largest, `largest connected through-station group: ${largest}`).toBeGreaterThanOrEqual(2);
        });

        it('graph builds with at least 1 edge', () => {
          expect(graph.edges.length).toBeGreaterThanOrEqual(1);
        });
      });
    }
  });
}
