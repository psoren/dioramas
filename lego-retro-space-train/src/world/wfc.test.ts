import { describe, it, expect } from 'vitest';
import { buildAdjacencyTable, enumerateVariants, solveWFC } from './wfc';

describe('WFC adjacency table', () => {
  it('enumerates variants without duplicates', () => {
    const variants = enumerateVariants(0);
    const ids = new Set(variants.map((v) => v.id));
    expect(ids.size).toBe(variants.length);
    expect(variants.length).toBeGreaterThan(5);
  });

  it('every variant has at least one allowed neighbor on every side', () => {
    const variants = enumerateVariants(0);
    const table = buildAdjacencyTable(variants);
    for (const v of variants) {
      for (const side of ['N', 'E', 'S', 'W'] as const) {
        const set = table.allowed.get(v.id)![side];
        expect(set.size, `${v.id} side ${side}`).toBeGreaterThan(0);
      }
    }
  });

  it('EMPTY tile is allowed next to anything with no port on the shared side', () => {
    const variants = enumerateVariants(0);
    const table = buildAdjacencyTable(variants);
    const empty = variants.find((v) => v.def.kind === 'empty')!;
    expect(empty).toBeDefined();
    for (const id of table.allowed.get(empty.id)!.E) {
      const neighbor = table.byId.get(id)!;
      expect(neighbor.portY.W).toBeNull();
    }
  });
});

describe('WFC solver', () => {
  it('solves a 4x4 grid (level=0 variants only)', () => {
    const variants = enumerateVariants(0);
    const table = buildAdjacencyTable(variants);
    let s = 7;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const { cells, retries } = solveWFC(table, { width: 4, height: 4, rng });
    expect(cells.size).toBe(16);
    expect(retries).toBeLessThanOrEqual(20);
  });
});
