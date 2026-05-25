import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  DIRECTIONS,
  opposite,
  rotateDir,
  sampleWorldPath,
  CURVE_NE,
  PlacedTile,
  Rotation,
} from './trackTile';

const HALF = TILE_SIZE / 2;

describe('rotateDir', () => {
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

  it('handles negative rotations (used by sampleWorldPath to undo a placed tile rotation)', () => {
    expect(rotateDir('N', -1)).toBe('E');
    expect(rotateDir('N', -3)).toBe('W');
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
