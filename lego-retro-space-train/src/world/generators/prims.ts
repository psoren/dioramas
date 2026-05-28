// Prim's-algorithm-based track generator. Builds the CONNECTIVITY
// skeleton first (a spanning tree over the grid → every cell is in
// the network), adds some extra edges for loops, then looks up the
// matching tile (STRAIGHT / CURVE / TEE / CROSS / STATION) for each
// cell based on which neighbours it's connected to.
//
// Trade-off vs WFC: less surprising shapes (every cell aligned to the
// grid, no organic curves longer than 1 cell), but every cell IS in
// the network — no bunching in a corner of the plate.

import { TrackLayout } from '../trackLayout';
import {
  CROSS_NESW, CURVE_NE, Direction, dirVector, effectivePorts, opposite,
  PlacedTile, Rotation, STATION_N, STRAIGHT_NS, TEE_NES, TrackTileDef,
  ELEVATED_STRAIGHT_NS, RAMP_NS, RAMP_NS_TALL,
} from '../trackTile';
import { extractGraphFromLayout } from '../wfcGenerator';
import { TrackGeneratorOptions, TrackGeneratorResult } from './index';

const DIRS: readonly Direction[] = ['N', 'E', 'S', 'W'];

export function generatePrimsGraph(opts: TrackGeneratorOptions): TrackGeneratorResult {
  const { size, rng } = opts;
  // Step 1: spanning tree over the grid via randomized Prim's.
  const connections = primsMaze(size, rng);
  // Step 2: knock down some walls to create cycles (otherwise it's a
  // tree of dead-ends). ~15% extra connections.
  addCycles(connections, size, rng, 0.15);
  // Step 3: lay tiles. Every cell with ≥1 connection gets a tile;
  // tile choice is deterministic from the connection set.
  const half = Math.floor(size / 2);
  const layout = layoutFromConnections(connections, size, half);
  // Step 4: post-pass — convert eligible 4-way crossings into
  // under-passes (one direction elevated over the other) so trains at
  // different levels actually cross instead of meeting at a CROSS.
  // Doesn't add same-direction stacking (parallel overpasses) —
  // those would be decoration with no topological purpose.
  addUnderPasses(layout, rng);
  // Step 5: extract the graph.
  return extractGraphFromLayout(layout, rng);
}

// --- Randomized Prim's maze ----------------------------------------------

/** For each cell ("x,y"), the set of cardinal directions that have a
 *  connection to that neighbour. Symmetric: if A points N to B then B
 *  points S to A. */
type Connections = Map<string, Set<Direction>>;

function primsMaze(size: number, rng: () => number): Connections {
  const conns: Connections = new Map();
  for (let x = 0; x < size; x++) {
    for (let y = 0; y < size; y++) conns.set(`${x},${y}`, new Set());
  }
  const inSet = new Set<string>();
  const frontier: Array<{ from: string; to: string; dir: Direction }> = [];

  const enqueueWalls = (cell: string) => {
    const [xs, ys] = cell.split(',');
    const x = Number(xs);
    const y = Number(ys);
    for (const dir of DIRS) {
      const [dx, dy] = dirVector(dir);
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      const neighbor = `${nx},${ny}`;
      if (inSet.has(neighbor)) continue;
      frontier.push({ from: cell, to: neighbor, dir });
    }
  };

  // Start at grid centre.
  const start = `${Math.floor(size / 2)},${Math.floor(size / 2)}`;
  inSet.add(start);
  enqueueWalls(start);

  while (frontier.length > 0) {
    const idx = Math.floor(rng() * frontier.length);
    const wall = frontier[idx]!;
    // Swap-remove for O(1) pop.
    frontier[idx] = frontier[frontier.length - 1]!;
    frontier.pop();
    if (inSet.has(wall.to)) continue; // already added via another wall
    conns.get(wall.from)!.add(wall.dir);
    conns.get(wall.to)!.add(opposite(wall.dir));
    inSet.add(wall.to);
    enqueueWalls(wall.to);
  }
  return conns;
}

/** Knock down some additional walls to create cycles. Each attempt
 *  picks a random cell + random direction; if neighbour exists and
 *  isn't already connected, add the connection both ways. */
function addCycles(conns: Connections, size: number, rng: () => number, fraction: number): void {
  const attempts = Math.floor(size * size * fraction);
  for (let i = 0; i < attempts; i++) {
    const x = Math.floor(rng() * size);
    const y = Math.floor(rng() * size);
    const dir = DIRS[Math.floor(rng() * 4)]!;
    const [dx, dy] = dirVector(dir);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
    const cellKey = `${x},${y}`;
    const neighborKey = `${nx},${ny}`;
    const cellConns = conns.get(cellKey)!;
    if (cellConns.has(dir)) continue;
    cellConns.add(dir);
    conns.get(neighborKey)!.add(opposite(dir));
  }
}

// --- Tile lookup ---------------------------------------------------------

function layoutFromConnections(conns: Connections, size: number, half: number): TrackLayout {
  const layout = new TrackLayout();
  for (const [key, dirs] of conns) {
    if (dirs.size === 0) continue;
    const [xs, ys] = key.split(',');
    const gx = Number(xs) - half;
    const gz = Number(ys) - half;
    const tile = tileForConnections(dirs);
    if (!tile) continue;
    layout.place(gx, gz, tile.def, tile.rotation);
  }
  // Belt-and-braces: in case a cell has exactly 1 connection and no
  // STATION_N rotation aligns (shouldn't happen — STATION_N is rotated
  // to N/E/S/W). No-op if all cells matched.
  void size;
  return layout;
}

/** Find a tile def + rotation whose effective ports equal `dirs`. */
function tileForConnections(dirs: Set<Direction>): { def: TrackTileDef; rotation: Rotation } | null {
  const target = sortedKey([...dirs]);
  const candidates: TrackTileDef[] = [STATION_N, STRAIGHT_NS, CURVE_NE, TEE_NES, CROSS_NESW];
  for (const def of candidates) {
    for (let r = 0; r < 4; r++) {
      const fake: PlacedTile = { gridX: 0, gridZ: 0, def, rotation: r as Rotation };
      const ports = effectivePorts(fake);
      if (ports.length !== dirs.size) continue;
      if (sortedKey([...ports]) === target) return { def, rotation: r as Rotation };
    }
  }
  return null;
}

function sortedKey(arr: Direction[]): string {
  return arr.slice().sort().join(',');
}

// --- Under-pass post-pass -------------------------------------------------

/** Replace eligible CROSS_NESW cells with UNDER_PASS_NESW (elevated
 *  E-W upper layer crossing a ground N-S lower layer). For each
 *  candidate CROSS:
 *   - E and W neighbours must be E-W STRAIGHTs (so we can ramp them).
 *   - N and S neighbours stay as-is (ground STRAIGHTs already match
 *     the under-pass's N-S Y=0 ports).
 *  On a match: CROSS → under-pass; E neighbour → RAMP rot 3 (W high,
 *  E low); W neighbour → RAMP rot 1 (W low, E high). The 3-cell
 *  segment forms a clean bridge over the perpendicular ground track.
 *
 *  Probability per candidate is low (~25%) so under-passes are a
 *  feature, not the dominant pattern. */
function addUnderPasses(layout: TrackLayout, rng: () => number): void {
  const candidates: PlacedTile[] = [];
  for (const t of layout.tiles()) {
    if (t.def.kind !== 'cross-nesw') continue;
    if (layout.get(t.gridX, t.gridZ) !== t) continue;
    candidates.push(t);
  }
  // Shuffle so the choice isn't biased by tile-iteration order.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  for (const cross of candidates) {
    if (rng() > 0.85) continue; // 85% chance — under-passes should be common
    // Try E-W bridge first, then N-S. RNG decides priority.
    const tryEW = rng() < 0.5;
    const order: Array<'EW' | 'NS'> = tryEW ? ['EW', 'NS'] : ['NS', 'EW'];
    for (const axis of order) {
      if (axis === 'EW') {
        const east = layout.get(cross.gridX + 1, cross.gridZ);
        const west = layout.get(cross.gridX - 1, cross.gridZ);
        if (!isHorizontalStraight(east) || !isHorizontalStraight(west)) continue;
        layout.remove(cross.gridX, cross.gridZ);
        // Bridge primary ELEVATED runs E-W (rot 1), under STRAIGHT runs
        // N-S (rot 0). Pick level: 60% level-0 (Y=H), 40% level-1 (Y=2H).
        const tall = rng() < 0.4;
        if (tall) {
          layout.place(cross.gridX, cross.gridZ, ELEVATED_STRAIGHT_NS, 1 as Rotation, undefined, 1);
        } else {
          layout.place(cross.gridX, cross.gridZ, ELEVATED_STRAIGHT_NS, 1 as Rotation);
        }
        layout.placeUnder(cross.gridX, cross.gridZ, STRAIGHT_NS, 0 as Rotation);
        // Side ramps: W ramp goes W=low→E=high, E ramp goes W=high→E=low.
        layout.remove(west!.gridX, west!.gridZ);
        layout.remove(east!.gridX, east!.gridZ);
        if (tall) {
          // RAMP_NS_TALL climbs the full 2H in one cell.
          layout.place(west!.gridX, west!.gridZ, RAMP_NS_TALL, 1 as Rotation);
          layout.place(east!.gridX, east!.gridZ, RAMP_NS_TALL, 3 as Rotation);
        } else {
          layout.place(west!.gridX, west!.gridZ, RAMP_NS, 1 as Rotation);
          layout.place(east!.gridX, east!.gridZ, RAMP_NS, 3 as Rotation);
        }
        break;
      } else {
        const north = layout.get(cross.gridX, cross.gridZ - 1);
        const south = layout.get(cross.gridX, cross.gridZ + 1);
        if (!isVerticalStraight(north) || !isVerticalStraight(south)) continue;
        layout.remove(cross.gridX, cross.gridZ);
        const tall = rng() < 0.4;
        // For N-S bridge: primary ELEVATED runs N-S (rot 0), under
        // STRAIGHT runs E-W (rot 1) — the perpendicular ground track.
        if (tall) {
          layout.place(cross.gridX, cross.gridZ, ELEVATED_STRAIGHT_NS, 0 as Rotation, undefined, 1);
        } else {
          layout.place(cross.gridX, cross.gridZ, ELEVATED_STRAIGHT_NS, 0 as Rotation);
        }
        layout.placeUnder(cross.gridX, cross.gridZ, STRAIGHT_NS, 1 as Rotation);
        // N ramp goes N=high→S=low (rot 2). S ramp: S=high→N=low (rot 0).
        layout.remove(north!.gridX, north!.gridZ);
        layout.remove(south!.gridX, south!.gridZ);
        if (tall) {
          layout.place(north!.gridX, north!.gridZ, RAMP_NS_TALL, 2 as Rotation);
          layout.place(south!.gridX, south!.gridZ, RAMP_NS_TALL, 0 as Rotation);
        } else {
          layout.place(north!.gridX, north!.gridZ, RAMP_NS, 2 as Rotation);
          layout.place(south!.gridX, south!.gridZ, RAMP_NS, 0 as Rotation);
        }
        break;
      }
    }
  }
}

function isHorizontalStraight(t: PlacedTile | undefined): boolean {
  if (!t) return false;
  if (t.def.kind !== 'straight-ns') return false;
  return t.rotation === 1 || t.rotation === 3;
}

function isVerticalStraight(t: PlacedTile | undefined): boolean {
  if (!t) return false;
  if (t.def.kind !== 'straight-ns') return false;
  return t.rotation === 0 || t.rotation === 2;
}
