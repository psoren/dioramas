import { describe, it, expect } from 'vitest';
import { generatePrimsGraph } from './prims';

describe('Prim\'s track generator', () => {
  it('generates a layout from a known seed', () => {
    let s = 12345;
    const rng = () => {
      s |= 0; s = (s + 0x6D2B79F5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    try {
      const result = generatePrimsGraph({ size: 13, rng });
      console.log('OK: nodes=', result.graph.nodes.length, 'edges=', result.graph.edges.length);
      console.log('layout tiles:', result.graph.layout.tiles().length);
      expect(result.graph.nodes.length).toBeGreaterThan(0);
    } catch (e) {
      console.error('threw:', (e as Error).message);
      console.error((e as Error).stack);
      throw e;
    }
  });
});
