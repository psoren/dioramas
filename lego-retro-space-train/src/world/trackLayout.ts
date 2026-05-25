import * as THREE from 'three';
import {
  PlacedTile,
  Direction,
  Rotation,
  STRAIGHT_NS,
  CURVE_NE,
  TrackTileDef,
  effectivePorts,
  sampleWorldPath,
  dirVector,
  opposite,
} from './trackTile';

/**
 * Grid of placed track tiles. Provides:
 *   - place / get for individual cell operations
 *   - buildLoop: walk a closed loop through 2-port tiles and produce a
 *     single CatmullRomCurve3 vehicles can run on
 *
 * Generators (`generateRectangleLoop` etc.) place tiles, then the caller
 * calls buildLoop to extract the path.
 */
export class TrackLayout {
  private readonly cells = new Map<string, PlacedTile>();

  place(gx: number, gz: number, def: TrackTileDef, rotation: Rotation): PlacedTile {
    const tile: PlacedTile = { gridX: gx, gridZ: gz, def, rotation };
    this.cells.set(key(gx, gz), tile);
    return tile;
  }

  get(gx: number, gz: number): PlacedTile | undefined {
    return this.cells.get(key(gx, gz));
  }

  tiles(): readonly PlacedTile[] {
    return Array.from(this.cells.values());
  }

  /**
   * Walk a closed loop starting at `start`, entering it from `startEntry`.
   * Concatenates each tile's centreline into a single curve. Only supports
   * 2-port tiles along the path (intersections need explicit routing).
   */
  buildLoop(
    start: PlacedTile,
    startEntry: Direction,
    samplesPerTile = 12,
  ): THREE.CatmullRomCurve3 {
    const points: THREE.Vector3[] = [];
    let current = start;
    let entry = startEntry;
    for (let step = 0; step < 256; step++) {
      const ports = effectivePorts(current);
      if (ports.length !== 2) {
        throw new Error(
          `buildLoop only supports 2-port tiles (tile ${current.def.kind} at ${current.gridX},${current.gridZ} has ${ports.length})`,
        );
      }
      if (!ports.includes(entry)) {
        throw new Error(
          `Entry ${entry} into tile ${current.def.kind} at ${current.gridX},${current.gridZ} doesn't match ports ${ports.join(',')}`,
        );
      }
      const exit = ports[0] === entry ? ports[1]! : ports[0]!;
      const seg = sampleWorldPath(current, entry, exit, samplesPerTile);
      // Drop the last sample of each segment so adjacent segments don't
      // double up at their shared endpoint.
      for (let i = 0; i < seg.length - 1; i++) points.push(seg[i]!);

      const [dx, dz] = dirVector(exit);
      const next = this.get(current.gridX + dx, current.gridZ + dz);
      if (!next) {
        throw new Error(
          `Dead end at (${current.gridX},${current.gridZ}) exiting ${exit}`,
        );
      }
      const newEntry = opposite(exit);
      if (next === start && newEntry === startEntry) {
        // Closed the loop — return without re-emitting the start point.
        return new THREE.CatmullRomCurve3(points, true, 'catmullrom');
      }
      entry = newEntry;
      current = next;
    }
    throw new Error('buildLoop did not close in 256 steps');
  }
}

function key(gx: number, gz: number): string {
  return `${gx},${gz}`;
}

/**
 * Place a closed rectangular loop on the layout. Four CURVE_NE corners +
 * STRAIGHT_NS along each edge. Returns the start tile and entry direction
 * for buildLoop.
 *
 * Grid convention: gx increases east (+X world), gz increases south (+Z
 * world). So gz0 is the NORTH edge and gz1 the SOUTH edge.
 */
export function generateRectangleLoop(
  layout: TrackLayout,
  gx0: number,
  gz0: number,
  gx1: number,
  gz1: number,
): { start: PlacedTile; startEntry: Direction } {
  if (gx1 - gx0 < 1 || gz1 - gz0 < 1) {
    throw new Error('rectangle loop requires at least 2x2 cells');
  }

  // Corners — rotations derived so each corner's two effective ports face
  // inward toward the rectangle's edges.
  layout.place(gx0, gz0, CURVE_NE, 3); // NW: ports E, S
  layout.place(gx1, gz0, CURVE_NE, 2); // NE: ports W, S
  layout.place(gx1, gz1, CURVE_NE, 1); // SE: ports W, N
  layout.place(gx0, gz1, CURVE_NE, 0); // SW: ports E, N

  // N + S edge: east-west straights → STRAIGHT_NS rotated by 1.
  for (let gx = gx0 + 1; gx < gx1; gx++) {
    layout.place(gx, gz0, STRAIGHT_NS, 1);
    layout.place(gx, gz1, STRAIGHT_NS, 1);
  }
  // W + E edge: north-south straights → STRAIGHT_NS rotation 0.
  for (let gz = gz0 + 1; gz < gz1; gz++) {
    layout.place(gx0, gz, STRAIGHT_NS, 0);
    layout.place(gx1, gz, STRAIGHT_NS, 0);
  }

  const start = layout.get(gx0, gz0)!;
  // NW corner has ports E (going east along top) and S (going south down
  // the west side). Enter from S, exit via E.
  return { start, startEntry: 'S' };
}

/**
 * Pick a random rectangle within bounds and place a loop. Same return shape
 * as generateRectangleLoop. `minSize` is in tile cells per side.
 */
export function generateRandomRectangleLoop(
  layout: TrackLayout,
  bounds: { gx0: number; gz0: number; gx1: number; gz1: number },
  rng: () => number = Math.random,
  minSize = 2,
): { start: PlacedTile; startEntry: Direction } {
  const maxW = bounds.gx1 - bounds.gx0;
  const maxH = bounds.gz1 - bounds.gz0;
  if (maxW < minSize || maxH < minSize) {
    throw new Error('bounds too small for requested minSize');
  }
  const w = minSize + Math.floor(rng() * (maxW - minSize + 1));
  const h = minSize + Math.floor(rng() * (maxH - minSize + 1));
  const gx0 = bounds.gx0 + Math.floor(rng() * (maxW - w + 1));
  const gz0 = bounds.gz0 + Math.floor(rng() * (maxH - h + 1));
  return generateRectangleLoop(layout, gx0, gz0, gx0 + w, gz0 + h);
}
