// One-shot: inspect a specific seed with both generators.
// Set SEED env var. Defaults to 17225.

import { describe, it } from 'vitest';
import { GENERATORS } from '../src/world/generators';
import { effectivePorts, dirVector, opposite } from '../src/world/trackTile';
import { portY } from '../src/world/trackLayout';

const SEED = Number(process.env.SEED ?? 17225);
const SIZE = Number(process.env.SIZE ?? 13);

function mkRng(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe(`inspect seed ${SEED}`, () => {
  for (const name of Object.keys(GENERATORS)) {
    it(name, () => {
      const gen = GENERATORS[name]!;
      try {
        const result = gen({ size: SIZE, rng: mkRng(SEED), maxRetries: 200 });
        const layout = result.graph.layout;
        const tiles = layout.tiles();
        const kindCount = new Map<string, number>();
        let deadEnds = 0;
        let elevatedCells = 0;
        let underPasses = 0;
        for (const t of tiles) {
          kindCount.set(t.def.kind, (kindCount.get(t.def.kind) ?? 0) + 1);
          if (t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne') elevatedCells++;
          if (layout.get(t.gridX, t.gridZ) === t && layout.getUnder(t.gridX, t.gridZ)) underPasses++;
          if (t.def.kind === 'station-n') continue;
          for (const p of effectivePorts(t)) {
            const [dx, dz] = dirVector(p);
            const wantY = portY(t, p);
            const wantOpp = opposite(p);
            const primary = layout.get(t.gridX + dx, t.gridZ + dz);
            const under = layout.getUnder(t.gridX + dx, t.gridZ + dz);
            const m = (c: typeof primary) => !!c && effectivePorts(c).includes(wantOpp) && Math.abs(portY(c, wantOpp) - wantY) < 0.01;
            if (!m(primary) && !m(under)) { deadEnds++; break; }
          }
        }
        console.log(`\n${name} (size=${SIZE}, seed=${SEED}):`);
        console.log(`  tiles=${tiles.length}  nodes=${result.graph.nodes.length}  edges=${result.graph.edges.length}`);
        console.log(`  stations=${result.stations.length}  junctions=${result.junctions.length}`);
        console.log(`  through-stations=${result.stations.filter((s) => s.edges.length >= 2).length}`);
        console.log(`  elevated cells=${elevatedCells}  under-passes=${underPasses}  dead-ends=${deadEnds}`);
        // Connected components via graph shortest-path. Cells in different
        // sub-graphs = train can't reach them from one to the other.
        const assigned = new Set<typeof result.graph.nodes[number]>();
        const compSizes: number[] = [];
        const compEdges: number[] = [];
        for (const n of result.graph.nodes) {
          if (assigned.has(n)) continue;
          assigned.add(n);
          let count = 1;
          const edges = new Set(n.edges);
          for (const other of result.graph.nodes) {
            if (assigned.has(other)) continue;
            if (result.graph.shortestPath(n, other) !== null) {
              assigned.add(other);
              count++;
              for (const e of other.edges) edges.add(e);
            }
          }
          compSizes.push(count);
          compEdges.push(edges.size);
        }
        compSizes.sort((a, b) => b - a);
        console.log(`  graph components: ${compSizes.length} (sizes: ${compSizes.slice(0, 10).join(', ')}${compSizes.length > 10 ? '…' : ''})`);
        if (compSizes.length > 1) {
          console.log(`  ⚠️  ${compSizes.length - 1} disconnected sub-graph(s); train can only ride the largest (${compSizes[0]} nodes)`);
        }
        console.log(`  tile breakdown:`);
        for (const [k, v] of [...kindCount.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${v.toString().padStart(3)} ${k}`);
        }
      } catch (e) {
        console.log(`${name}: FAIL — ${(e as Error).message}`);
      }
    });
  }
});
