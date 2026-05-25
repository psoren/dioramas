import { describe, it, expect } from 'vitest';
import {
  TILE_SIZE,
  DIRECTIONS,
  opposite,
  rotateDir,
  sampleWorldPath,
  CURVE_NE,
  RAMP_NS,
  RAMP_HEIGHT,
  ELEVATED_STRAIGHT_NS,
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

describe('ramp tiles', () => {
  it('RAMP_NS climbs monotonically from N (y=0) to S (y=RAMP_HEIGHT)', () => {
    // Catches sign errors and bad endpoint Y assignment that would still
    // typecheck but break bridge alignment with neighbouring tiles.
    const tile: PlacedTile = { gridX: 0, gridZ: 0, def: RAMP_NS, rotation: 0 };
    const pts = sampleWorldPath(tile, 'N', 'S', 10);
    expect(pts[0]!.y).toBeCloseTo(0);
    expect(pts.at(-1)!.y).toBeCloseTo(RAMP_HEIGHT);
    for (let i = 1; i < pts.length; i++) {
      expect(pts[i]!.y).toBeGreaterThanOrEqual(pts[i - 1]!.y);
    }
  });

  it('ELEVATED_STRAIGHT_NS exit Y matches RAMP_NS top — bridges align', () => {
    // The bridge contract: a ramp tile leaves at y=RAMP_HEIGHT, the next
    // (elevated) tile must enter at the same height. If they ever drift
    // apart, the train pops up/down at the seam.
    const ramp: PlacedTile = { gridX: 0, gridZ: 0, def: RAMP_NS, rotation: 0 };
    const elev: PlacedTile = { gridX: 0, gridZ: 1, def: ELEVATED_STRAIGHT_NS, rotation: 0 };
    const rampExit = sampleWorldPath(ramp, 'N', 'S', 4).at(-1)!;
    const elevEntry = sampleWorldPath(elev, 'N', 'S', 4)[0]!;
    expect(elevEntry.y).toBeCloseTo(rampExit.y);
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
