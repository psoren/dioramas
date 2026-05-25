import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  DIRECTIONS,
  opposite,
  rotateDir,
  effectivePorts,
  sampleWorldPath,
  STRAIGHT_NS,
  CURVE_NE,
  CROSS_NESW,
  PlacedTile,
  Rotation,
} from './trackTile';

const HALF = TILE_SIZE / 2;

describe('opposite', () => {
  it.each([
    ['N', 'S'], ['S', 'N'], ['E', 'W'], ['W', 'E'],
  ] as const)('%s -> %s', (a, b) => {
    expect(opposite(a)).toBe(b);
    expect(opposite(b)).toBe(a);
  });
});

describe('rotateDir', () => {
  it('zero rotation is identity', () => {
    for (const d of DIRECTIONS) expect(rotateDir(d, 0)).toBe(d);
  });

  it('positive rotation = CCW (matches Three.js rotation.y sign)', () => {
    // rotation=1 (+π/2 around Y, CCW from above) takes a -Z-facing
    // port to -X (north → west).
    expect(rotateDir('N', 1)).toBe('W');
    expect(rotateDir('W', 1)).toBe('S');
    expect(rotateDir('S', 1)).toBe('E');
    expect(rotateDir('E', 1)).toBe('N');
  });

  it('rotation=2 inverts direction', () => {
    for (const d of DIRECTIONS) expect(rotateDir(d, 2)).toBe(opposite(d));
  });

  it('rotation=4 wraps back to identity', () => {
    for (const d of DIRECTIONS) expect(rotateDir(d, 4)).toBe(d);
  });

  it('handles negative rotations', () => {
    expect(rotateDir('N', -1)).toBe('E');
    expect(rotateDir('N', -3)).toBe('W');
  });
});

describe('effectivePorts', () => {
  it('CURVE_NE base rotation has N,E', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CURVE_NE, rotation: 0 };
    expect(new Set(effectivePorts(tile))).toEqual(new Set(['N', 'E']));
  });

  it('CURVE_NE rotation=3 yields E,S (NW corner of a rectangle loop)', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CURVE_NE, rotation: 3 };
    expect(new Set(effectivePorts(tile))).toEqual(new Set(['E', 'S']));
  });

  it('STRAIGHT_NS rotated by 1 becomes east-west', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: STRAIGHT_NS, rotation: 1 };
    expect(new Set(effectivePorts(tile))).toEqual(new Set(['E', 'W']));
  });
});

describe('sampleWorldPath', () => {
  it('STRAIGHT_NS at origin: N→S endpoints land exactly at port positions', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: STRAIGHT_NS, rotation: 0 };
    const pts = sampleWorldPath(tile, 'N', 'S', 8);
    expect(pts[0]!.x).toBeCloseTo(0);
    expect(pts[0]!.z).toBeCloseTo(-HALF);
    expect(pts.at(-1)!.x).toBeCloseTo(0);
    expect(pts.at(-1)!.z).toBeCloseTo(HALF);
  });

  it('STRAIGHT_NS at grid (2, -1): endpoints offset by cell coords', () => {
    const tile: PlacedTile = { gridX: 2, gridZ: -1, def: STRAIGHT_NS, rotation: 0 };
    const pts = sampleWorldPath(tile, 'N', 'S', 4);
    expect(pts[0]!.x).toBeCloseTo(2 * TILE_SIZE);
    expect(pts[0]!.z).toBeCloseTo(-1 * TILE_SIZE - HALF);
  });

  it('CURVE_NE rotated to "SW corner of loop": path connects N to E correctly', () => {
    // Base ports = N, E. With rotation=0 these are already the effective ports.
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CURVE_NE, rotation: 0 };
    const pts = sampleWorldPath(tile, 'N', 'E', 8);
    // First point at N port (0, 0, -HALF)
    expect(pts[0]!.x).toBeCloseTo(0);
    expect(pts[0]!.z).toBeCloseTo(-HALF);
    // Last point at E port (HALF, 0, 0)
    expect(pts.at(-1)!.x).toBeCloseTo(HALF);
    expect(pts.at(-1)!.z).toBeCloseTo(0);
  });

  it('CURVE_NE rotated 3 (NW corner): path connects S to E in world coords', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CURVE_NE, rotation: 3 };
    const pts = sampleWorldPath(tile, 'S', 'E', 8);
    expect(pts[0]!.x).toBeCloseTo(0);
    expect(pts[0]!.z).toBeCloseTo(HALF); // S port at +Z
    expect(pts.at(-1)!.x).toBeCloseTo(HALF);
    expect(pts.at(-1)!.z).toBeCloseTo(0); // E port at +X
  });

  it('throws if asked for a port pair the tile does not have', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: STRAIGHT_NS, rotation: 0 };
    expect(() => sampleWorldPath(tile, 'N', 'E', 4)).toThrow();
  });

  it('CROSS_NESW handles all six pairs without throwing', () => {
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CROSS_NESW, rotation: 0 };
    const pairs: [string, string][] = [
      ['N', 'S'], ['N', 'E'], ['N', 'W'],
      ['E', 'W'], ['E', 'S'], ['S', 'W'],
    ];
    for (const [from, to] of pairs) {
      const pts = sampleWorldPath(tile, from as any, to as any, 4);
      expect(pts.length).toBe(5);
    }
  });
});

describe('tile rotations are self-consistent', () => {
  // For every base port + rotation, the world position of the port should
  // match rotateDir(basePort, rotation)'s expected location.
  const dirToCellPos: Record<string, [number, number]> = {
    N: [0, -HALF],
    E: [HALF, 0],
    S: [0, HALF],
    W: [-HALF, 0],
  };

  for (const rotation of [0, 1, 2, 3] as Rotation[]) {
    it(`CURVE_NE rotation=${rotation} ports land at expected world positions`, () => {
      const tile: PlacedTile = { gridX: 0, gridZ: 0, def: CURVE_NE, rotation };
      const baseN = 'N', baseE = 'E';
      const effN = rotateDir(baseN, rotation);
      const effE = rotateDir(baseE, rotation);
      const pts = sampleWorldPath(tile, effN, effE, 4);
      const startExpected = dirToCellPos[effN]!;
      const endExpected = dirToCellPos[effE]!;
      expect(pts[0]!.x).toBeCloseTo(startExpected[0]);
      expect(pts[0]!.z).toBeCloseTo(startExpected[1]);
      expect(pts.at(-1)!.x).toBeCloseTo(endExpected[0]);
      expect(pts.at(-1)!.z).toBeCloseTo(endExpected[1]);
    });
  }
});
