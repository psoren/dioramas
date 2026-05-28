import { describe, it } from 'vitest';
import { generatePrimsGraph } from './prims';
import { effectivePorts } from '../trackTile';
import { portY } from '../trackLayout';

// Diagnostic: build the layout (without graph extraction) and dump
// every tile to spot the bad cell.
describe('Prim\'s diag', () => {
  it('dumps tile-by-tile', () => {
    let s = 12345;
    const rng = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    // We can't easily intercept the layout from generatePrimsGraph, so
    // just call it and report the err+stack on throw.
    try {
      const result = generatePrimsGraph({ size: 7, rng });
      console.log('OK layout has', result.graph.layout.tiles().length, 'tiles');
      console.log('graph nodes', result.graph.nodes.length, 'edges', result.graph.edges.length);
      // Audit every tile's ports.
      for (const t of result.graph.layout.tiles()) {
        const ports = effectivePorts(t);
        const portYs = ports.map((p) => `${p}@${portY(t, p).toFixed(2)}`);
        console.log(`  (${t.gridX},${t.gridZ}) ${t.def.kind} rot=${t.rotation} ports=${portYs.join(',')}`);
      }
    } catch (e) {
      console.error('PRIMS THREW:', (e as Error).message);
      console.error((e as Error).stack);
    }
  });
});
