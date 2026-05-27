import * as THREE from 'three';
import {
  PlacedTile,
  Direction,
  Rotation,
  STRAIGHT_NS,
  CURVE_NE,
  CROSS_NESW,
  RAMP_NS,
  ELEVATED_STRAIGHT_NS,
  RAMP_HEIGHT,
  TILE_SIZE,
  TrackTileDef,
  effectivePorts,
  sampleWorldPath,
  dirVector,
  opposite,
  rotateDir,
} from './trackTile';

/** Y-coordinate of a given port on a placed tile (world Y).
 *  - ELEVATED_STRAIGHT_NS: all ports at RAMP_HEIGHT
 *  - RAMP_NS: base N port at 0, base S port at RAMP_HEIGHT (rotated)
 *  - everything else: 0
 *  Then add `level * RAMP_HEIGHT` for the tile's elevation (so stacked
 *  multi-level layouts report correct port Ys). */
export function portY(tile: PlacedTile, effectivePort: Direction): number {
  const yLift = (tile.level ?? 0) * RAMP_HEIGHT;
  if (tile.def.kind === 'elevated-straight-ns' || tile.def.kind === 'elevated-curve-ne') {
    return RAMP_HEIGHT + yLift;
  }
  if (tile.def.kind === 'ramp-ns') {
    const basePort = rotateDir(effectivePort, -tile.rotation);
    return (basePort === 'S' ? RAMP_HEIGHT : 0) + yLift;
  }
  if (tile.def.kind === 'ramp-ns-tall') {
    const basePort = rotateDir(effectivePort, -tile.rotation);
    return (basePort === 'S' ? 2 * RAMP_HEIGHT : 0) + yLift;
  }
  if (tile.def.kind === 'under-pass-nesw') {
    // Base ports: N=ground (0), E=elevated (H), S=ground (0), W=elevated (H).
    // So elevated ports are the E-W pair, ground ports are the N-S pair.
    const basePort = rotateDir(effectivePort, -tile.rotation);
    return (basePort === 'E' || basePort === 'W' ? RAMP_HEIGHT : 0) + yLift;
  }
  return yLift;
}

/** Does this tile have AT LEAST ONE port whose Y is approximately atY? */
export function tileHasPortAtY(tile: PlacedTile, atY: number, tol = 0.01): boolean {
  for (const p of effectivePorts(tile)) {
    if (Math.abs(portY(tile, p) - atY) <= tol) return true;
  }
  return false;
}

/** Does this tile have a port on side `dir` whose Y is approximately atY? */
export function tileHasPortAtSideAtY(
  tile: PlacedTile,
  dir: Direction,
  atY: number,
  tol = 0.01,
): boolean {
  if (!effectivePorts(tile).includes(dir)) return false;
  return Math.abs(portY(tile, dir) - atY) <= tol;
}

/**
 * A tile's contiguous span along the loop curve, in t-coordinates.
 * `tStart` ≤ t < `tEnd` (with the final span wrapping past 1.0 back to 0).
 */
export interface TileSpan {
  gridX: number;
  gridZ: number;
  /** "gx,gz" key. */
  key: string;
  tStart: number;
  tEnd: number;
}

/**
 * Output of `buildLoop`: the renderable curve, the per-tile t-spans, and
 * a `tileAtT(t)` lookup function for downstream consumers (stations,
 * intersections, HUD) that need to know which tile cell is "under" a
 * given path-position right now.
 */
export interface LoopResult {
  curve: THREE.CatmullRomCurve3;
  tileSpans: readonly TileSpan[];
  /** O(1) lookup. Returns null only if the curve passes through a region
   *  no tile covers — shouldn't happen for valid layouts. */
  tileAtT(t: number): TileSpan | null;
}

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
  /** Optional ground-level tile beneath an ELEVATED cell, used to render a
   *  track that passes UNDER the bridge. Cell key is the same as `cells`;
   *  graph builder and renderer treat the under-tile as a separate tile at
   *  y=0 (the primary cell's tile stays at its own y). */
  private readonly underCells = new Map<string, PlacedTile>();

  place(
    gx: number,
    gz: number,
    def: TrackTileDef,
    rotation: Rotation,
    routing?: Map<Direction, Direction>,
    level?: number,
  ): PlacedTile {
    const tile: PlacedTile = { gridX: gx, gridZ: gz, def, rotation, routing, level };
    this.cells.set(key(gx, gz), tile);
    return tile;
  }

  /** Place a tile UNDER an elevated cell (for under-passes). Pass `level`
   *  to stack the under-tile at a non-ground Y (e.g. level=1 makes the
   *  "under" layer sit at y=RAMP_HEIGHT — used for a level-1-under-
   *  level-2 crossing). */
  placeUnder(
    gx: number,
    gz: number,
    def: TrackTileDef,
    rotation: Rotation,
    routing?: Map<Direction, Direction>,
    level?: number,
  ): PlacedTile {
    const tile: PlacedTile = { gridX: gx, gridZ: gz, def, rotation, routing, level };
    this.underCells.set(key(gx, gz), tile);
    return tile;
  }

  get(gx: number, gz: number): PlacedTile | undefined {
    return this.cells.get(key(gx, gz));
  }

  /** Remove all tiles at the cell (both primary and under-tile). Used
   *  by post-WFC clean-up that prunes orphan tiles outside the main
   *  connected component. */
  remove(gx: number, gz: number): void {
    this.cells.delete(key(gx, gz));
    this.underCells.delete(key(gx, gz));
  }

  /** Drop every tile (primary + under). Used by the WFC densify pass
   *  before re-populating the layout from a second WFC solve. */
  clear(): void {
    this.cells.clear();
    this.underCells.clear();
  }

  getUnder(gx: number, gz: number): PlacedTile | undefined {
    return this.underCells.get(key(gx, gz));
  }

  /** Return the tile at (gx, gz) whose ports sit at world-Y level `atY`
   *  (within `tol`). Used by the graph builder when walking through cells
   *  that have both an elevated primary tile AND a ground-level under-pass
   *  tile — the trace picks the one matching the current walker's Y. */
  getAt(gx: number, gz: number, atY: number, tol = 0.01): PlacedTile | undefined {
    const primary = this.cells.get(key(gx, gz));
    if (primary && tileHasPortAtY(primary, atY, tol)) return primary;
    const under = this.underCells.get(key(gx, gz));
    if (under && tileHasPortAtY(under, atY, tol)) return under;
    return undefined;
  }

  /** Like getAt, but disambiguates between primary and under-tile by
   *  checking the port AT the entry direction (not just any port on the
   *  tile). When both layers have a port at the same Y on the entry
   *  side (the parallel-overpass transition cell — primary RAMP has S
   *  at Y=0, under STRAIGHT also has S at Y=0), prefer the layer whose
   *  OPPOSITE side stays at the same Y (the straight-through layer).
   *  Otherwise behavior matches getAt. */
  getAtVia(
    gx: number,
    gz: number,
    atY: number,
    entry: Direction,
    opts?: { preferPrimary?: boolean; tol?: number },
  ): PlacedTile | undefined {
    const tol = opts?.tol ?? 0.01;
    const opp = ({ N: 'S', E: 'W', S: 'N', W: 'E' } as const)[entry];
    const primary = this.cells.get(key(gx, gz));
    const under = this.underCells.get(key(gx, gz));
    const pHasEntry = !!(primary && tileHasPortAtSideAtY(primary, entry, atY, tol));
    const uHasEntry = !!(under && tileHasPortAtSideAtY(under, entry, atY, tol));
    if (pHasEntry && uHasEntry) {
      // preferPrimary: caller wants the trace to "go up" through ramp/
      // elevated tiles at ambiguous transitions. Used by the elevated-
      // graph build so train 2 climbs to the upper layer through
      // parallel-overpass transitions instead of staying on ground.
      if (opts?.preferPrimary) return primary!;
      const pStraight = tileHasPortAtSideAtY(primary!, opp, atY, tol);
      const uStraight = tileHasPortAtSideAtY(under!, opp, atY, tol);
      if (uStraight && !pStraight) return under!;
      if (pStraight && !uStraight) return primary!;
      // Both or neither straight-through: fall back to primary-first.
      return primary!;
    }
    if (pHasEntry) return primary!;
    if (uHasEntry) return under!;
    return undefined;
  }

  tiles(): readonly PlacedTile[] {
    return [...this.cells.values(), ...this.underCells.values()];
  }

  /**
   * Walk a closed loop starting at `start`, entering it from `startEntry`.
   * Concatenates each tile's centreline into a single curve and returns a
   * `LoopResult` with a t→tile lookup attached. Only supports 2-port tiles
   * along the path (intersections need explicit routing).
   */
  buildLoop(
    start: PlacedTile,
    startEntry: Direction,
    samplesPerTile = 12,
  ): LoopResult {
    const points: THREE.Vector3[] = [];
    let current = start;
    let entry = startEntry;
    // Y at the current tile's entry port. Used to verify adjacent tiles
    // agree on the elevation at their shared seam — critical for ramp
    // loops where a misaligned seam would pop the train up or down.
    let entryY: number | null = null;
    for (let step = 0; step < 256; step++) {
      const ports = effectivePorts(current);
      if (ports.length !== 2) {
        // 3+-port tiles need explicit routing; fall through to that logic.
        const routedExit = current.routing?.get(entry);
        if (!routedExit || !ports.includes(routedExit) || routedExit === entry) {
          throw new Error(
            `buildLoop hit a ${ports.length}-port tile (${current.def.kind} at ${current.gridX},${current.gridZ}) without valid routing for entry ${entry}`,
          );
        }
        const seg = sampleWorldPath(current, entry, routedExit, samplesPerTile);
        if (entryY !== null && Math.abs(seg[0]!.y - entryY) > 0.001) {
          throw new Error(
            `Y mismatch at tile (${current.gridX},${current.gridZ}) entry: expected ${entryY}, got ${seg[0]!.y}`,
          );
        }
        for (let i = 0; i < seg.length - 1; i++) points.push(seg[i]!);
        entryY = seg[seg.length - 1]!.y;
        const [dx, dz] = dirVector(routedExit);
        const next = this.get(current.gridX + dx, current.gridZ + dz);
        if (!next) throw new Error(`Dead end at (${current.gridX},${current.gridZ}) exiting ${routedExit}`);
        const newEntry = opposite(routedExit);
        if (next === start && newEntry === startEntry) {
          const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
          return buildLookup(curve, this.tiles());
        }
        entry = newEntry;
        current = next;
        continue;
      }
      if (!ports.includes(entry)) {
        throw new Error(
          `Entry ${entry} into tile ${current.def.kind} at ${current.gridX},${current.gridZ} doesn't match ports ${ports.join(',')}`,
        );
      }
      const exit = ports[0] === entry ? ports[1]! : ports[0]!;
      const seg = sampleWorldPath(current, entry, exit, samplesPerTile);
      if (entryY !== null && Math.abs(seg[0]!.y - entryY) > 0.001) {
        throw new Error(
          `Y mismatch at tile (${current.gridX},${current.gridZ}) entry: expected ${entryY}, got ${seg[0]!.y}`,
        );
      }
      for (let i = 0; i < seg.length - 1; i++) points.push(seg[i]!);
      entryY = seg[seg.length - 1]!.y;

      const [dx, dz] = dirVector(exit);
      const next = this.get(current.gridX + dx, current.gridZ + dz);
      if (!next) {
        throw new Error(
          `Dead end at (${current.gridX},${current.gridZ}) exiting ${exit}`,
        );
      }
      const newEntry = opposite(exit);
      if (next === start && newEntry === startEntry) {
        const curve = new THREE.CatmullRomCurve3(points, true, 'centripetal');
        return buildLookup(curve, this.tiles());
      }
      entry = newEntry;
      current = next;
    }
    throw new Error('buildLoop did not close in 256 steps');
  }
}

/**
 * Build the t→tile lookup by sampling the curve at uniform t intervals
 * and finding the tile whose cell bbox contains each sampled point.
 * Each tile gets a single contiguous (tStart, tEnd) range — valid for
 * loops where the curve passes through each cell at most once (the only
 * kind we generate today).
 */
function buildLookup(
  curve: THREE.CatmullRomCurve3,
  tiles: readonly PlacedTile[],
): LoopResult {
  const RESOLUTION = 360;
  // For each sample, pick the tile whose centre is closest to the curve
  // point. A pure bbox check would suffer ambiguous matches where a curve
  // smoothly cuts a cell corner — the train would briefly "teleport" to
  // a neighbour. Nearest-centre is unambiguous and is what we want
  // semantically: "which cell does this point belong to most".
  const buckets: (TileSpan | null)[] = new Array(RESOLUTION);
  const spansByKey = new Map<string, TileSpan>();

  for (let i = 0; i < RESOLUTION; i++) {
    const t = i / RESOLUTION;
    const p = curve.getPointAt(t);
    let bestD2 = Infinity;
    let best: PlacedTile | null = null;
    for (const tile of tiles) {
      const dx = p.x - tile.gridX * TILE_SIZE;
      const dz = p.z - tile.gridZ * TILE_SIZE;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = tile; }
    }
    if (!best) { buckets[i] = null; continue; }
    const tileKey = `${best.gridX},${best.gridZ}`;
    let span = spansByKey.get(tileKey);
    if (!span) {
      span = { gridX: best.gridX, gridZ: best.gridZ, key: tileKey, tStart: t, tEnd: t };
      spansByKey.set(tileKey, span);
    }
    span.tEnd = (i + 1) / RESOLUTION;
    buckets[i] = span;
  }

  return {
    curve,
    tileSpans: Array.from(spansByKey.values()),
    tileAtT(t: number) {
      const u = ((t % 1) + 1) % 1;
      const idx = Math.min(RESOLUTION - 1, Math.floor(u * RESOLUTION));
      return buckets[idx] ?? null;
    },
  };
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

// ---------------------------------------------------------------------------
// Polygon-walker generator: place STRAIGHT + CURVE_NE tiles along an
// arbitrary closed polyline of cells. Powers the L/U/zigzag templates and
// can generate any rectilinear loop the caller can describe as a cell path.
// ---------------------------------------------------------------------------

/** Two adjacent cells must differ by 1 in exactly one cardinal axis. */
function dirFromTo(ax: number, az: number, bx: number, bz: number): Direction {
  const dx = bx - ax;
  const dz = bz - az;
  if (dx === 1 && dz === 0) return 'E';
  if (dx === -1 && dz === 0) return 'W';
  if (dx === 0 && dz === 1) return 'S';
  if (dx === 0 && dz === -1) return 'N';
  throw new Error(`cells (${ax},${az}) and (${bx},${bz}) are not cardinally adjacent`);
}

/**
 * Given a 2-port cell's (entry, exit) directions, pick the tile def +
 * rotation that exposes exactly those two ports.
 */
function pickStraightOrCurve(entry: Direction, exit: Direction): { def: TrackTileDef; rotation: Rotation } {
  if (entry === exit) throw new Error(`degenerate cell: entry === exit (${entry})`);
  if (opposite(entry) === exit) {
    // Straight: N↔S → rotation 0; E↔W → rotation 1.
    return { def: STRAIGHT_NS, rotation: entry === 'N' || entry === 'S' ? 0 : 1 };
  }
  // CURVE_NE base ports {N, E}. Rotated:
  //   rot 0 → {N, E}, rot 1 → {W, N}, rot 2 → {S, W}, rot 3 → {E, S}
  const set = new Set([entry, exit]);
  if (set.has('N') && set.has('E')) return { def: CURVE_NE, rotation: 0 };
  if (set.has('W') && set.has('N')) return { def: CURVE_NE, rotation: 1 };
  if (set.has('S') && set.has('W')) return { def: CURVE_NE, rotation: 2 };
  if (set.has('E') && set.has('S')) return { def: CURVE_NE, rotation: 3 };
  throw new Error(`unhandled port pair: ${entry}, ${exit}`);
}

/**
 * Place tiles along a closed cell path. Each cell gets a STRAIGHT or
 * CURVE chosen by the direction of arrival and departure. Returns the
 * start tile and entry needed by `buildLoop`.
 *
 * Cells must be pairwise cardinally adjacent and the last cell must be
 * adjacent to the first (the path closes).
 */
/** Per-cell override map keyed by `"gx,gz"`. Caller is responsible for
 *  ensuring the override's ports match the (entry, exit) at that cell —
 *  used e.g. by the ramp loop template to substitute RAMP_NS for a
 *  straight on specific edge cells. */
export type PolygonOverrides = ReadonlyMap<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction>; level?: number }>;

export function placePolygonLoop(
  layout: TrackLayout,
  cells: ReadonlyArray<readonly [number, number]>,
  overrides?: PolygonOverrides,
): { start: PlacedTile; startEntry: Direction } {
  if (cells.length < 4) {
    throw new Error('polygon loop needs at least 4 cells');
  }
  const n = cells.length;
  // Collect (entry, exit) per UNIQUE cell. A cell visited more than once
  // is a crossing — its accumulated routing becomes the CROSS_NESW's
  // entry→exit map.
  type Visit = { entry: Direction; exit: Direction };
  const cellVisits = new Map<string, { gx: number; gz: number; visits: Visit[] }>();
  for (let i = 0; i < n; i++) {
    const [gx, gz] = cells[i]!;
    const [pgx, pgz] = cells[(i - 1 + n) % n]!;
    const [ngx, ngz] = cells[(i + 1) % n]!;
    const entry = opposite(dirFromTo(pgx, pgz, gx, gz));
    const exit = dirFromTo(gx, gz, ngx, ngz);
    const key = `${gx},${gz}`;
    let info = cellVisits.get(key);
    if (!info) {
      info = { gx, gz, visits: [] };
      cellVisits.set(key, info);
    }
    info.visits.push({ entry, exit });
  }

  for (const info of cellVisits.values()) {
    const cellKey = `${info.gx},${info.gz}`;
    const override = overrides?.get(cellKey);
    if (override) {
      // Overrides assume a single-visit cell. Crossings can't be overridden
      // because the override doesn't carry multi-routing — fall through to
      // CROSS handling if both apply.
      if (info.visits.length === 1) {
        layout.place(info.gx, info.gz, override.def, override.rotation, override.routing, override.level);
        continue;
      }
    }
    if (info.visits.length === 1) {
      const { entry, exit } = info.visits[0]!;
      const { def, rotation } = pickStraightOrCurve(entry, exit);
      layout.place(info.gx, info.gz, def, rotation);
    } else if (info.visits.length === 2) {
      // Two perpendicular passes → CROSS_NESW with both routes baked in.
      const routing = new Map<Direction, Direction>();
      for (const v of info.visits) routing.set(v.entry, v.exit);
      layout.place(info.gx, info.gz, CROSS_NESW, 0, routing);
    } else {
      throw new Error(
        `Cell (${info.gx},${info.gz}) visited ${info.visits.length} times — only 1 or 2 supported`,
      );
    }
  }

  const [pgx, pgz] = cells[n - 1]!;
  const [gx0, gz0] = cells[0]!;
  const startEntry = opposite(dirFromTo(pgx, pgz, gx0, gz0));
  return { start: layout.get(gx0, gz0)!, startEntry };
}

/**
 * Compact closed-walk specification: a sequence of (direction, count)
 * steps. The walker expands each step into `count` 1-cell moves, builds
 * the cell list, and feeds it to `placePolygonLoop`. The sum of step
 * vectors must be zero (the walk must close).
 */
export type WalkStep = readonly [Direction, number];

/**
 * Compute the (gx, gz) origin needed to centre the walk's bounding box
 * around (0, 0). Pass the result as `placeWalkLoop`'s `origin` argument.
 */
export function centeredOrigin(steps: ReadonlyArray<WalkStep>): [number, number] {
  let cx = 0, cz = 0;
  let minX = 0, maxX = 0, minZ = 0, maxZ = 0;
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    for (let i = 0; i < count; i++) {
      cx += vx;
      cz += vz;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
    }
  }
  return [-Math.round((minX + maxX) / 2), -Math.round((minZ + maxZ) / 2)];
}

export function placeWalkLoop(
  layout: TrackLayout,
  steps: ReadonlyArray<WalkStep>,
  origin: readonly [number, number] = [0, 0],
  overrides?: PolygonOverrides,
): { start: PlacedTile; startEntry: Direction } {
  let dxSum = 0;
  let dzSum = 0;
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    dxSum += vx * count;
    dzSum += vz * count;
  }
  if (dxSum !== 0 || dzSum !== 0) {
    throw new Error(`walk steps don't close: net displacement (${dxSum}, ${dzSum})`);
  }
  const cells: Array<[number, number]> = [];
  let cx = origin[0];
  let cz = origin[1];
  cells.push([cx, cz]);
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    for (let i = 0; i < count; i++) {
      cx += vx;
      cz += vz;
      cells.push([cx, cz]);
    }
  }
  // Last cell is back at origin; drop the duplicate.
  cells.pop();
  return placePolygonLoop(layout, cells, overrides);
}

// --- Template library --------------------------------------------------

/** A loop template — a self-contained recipe for a closed track shape. */
export interface LoopTemplate {
  name: string;
  steps: ReadonlyArray<WalkStep>;
}

export const LOOP_TEMPLATES: ReadonlyArray<LoopTemplate> = [
  { name: 'rect-5x3', steps: [['E', 4], ['S', 2], ['W', 4], ['N', 2]] },
  { name: 'rect-3x4', steps: [['E', 2], ['S', 3], ['W', 2], ['N', 3]] },
  { name: 'L-large', steps: [['E', 4], ['S', 1], ['E', 2], ['S', 2], ['W', 6], ['N', 3]] },
  { name: 'L-small', steps: [['E', 2], ['S', 1], ['E', 1], ['S', 1], ['W', 3], ['N', 2]] },
  { name: 'U-corridor', steps: [['E', 3], ['S', 4], ['E', 1], ['S', 1], ['W', 4], ['N', 5]] },
  { name: 'zigzag', steps: [['E', 2], ['S', 1], ['E', 2], ['S', 2], ['W', 2], ['N', 1], ['W', 2], ['N', 2]] },
  // Self-crossing template: the (3,2) cell is visited twice and becomes a
  // CROSS_NESW with routing for both perpendicular passes (E→W and S→N).
  { name: 'figure-8', steps: [['E', 2], ['S', 2], ['W', 4], ['S', 2], ['E', 2], ['N', 4]] },
];

/**
 * Build steps for an asymmetric figure-8: two perpendicular lobes joined
 * at one self-crossing cell. lobeW1/H1 control the top-left lobe size,
 * lobeW2/H2 the bottom-right lobe. The crossing falls at (0, h1).
 */
export function figure8Steps(
  w1: number,
  h1: number,
  w2: number,
  h2: number,
): WalkStep[] {
  return [
    ['E', w1],
    ['S', h1],
    ['W', w1 + w2],
    ['S', h2],
    ['E', w2],
    ['N', h1 + h2],
  ];
}

/** Pick random lobe sizes 3-5 cells per side and build a figure-8,
 *  centred around the origin so the loop sits on the middle of the plate. */
export function generateRandomFigure8(
  layout: TrackLayout,
  rng: () => number = Math.random,
): { start: PlacedTile; startEntry: Direction } {
  const w1 = 3 + Math.floor(rng() * 3);
  const h1 = 3 + Math.floor(rng() * 3);
  const w2 = 3 + Math.floor(rng() * 3);
  const h2 = 3 + Math.floor(rng() * 3);
  const steps = figure8Steps(w1, h1, w2, h2);
  return placeWalkLoop(layout, steps, centeredOrigin(steps));
}

/** Pick a random template and place it. */
export function generateTemplateLoop(
  layout: TrackLayout,
  rng: () => number = Math.random,
  origin: readonly [number, number] = [0, 0],
): { start: PlacedTile; startEntry: Direction; template: string } {
  const tpl = LOOP_TEMPLATES[Math.floor(rng() * LOOP_TEMPLATES.length)]!;
  const { start, startEntry } = placeWalkLoop(layout, tpl.steps, origin);
  return { start, startEntry, template: tpl.name };
}

// ---------------------------------------------------------------------------
// Extrude-based random walker: takes a base loop's walk steps and repeatedly
// "extrudes" a rectangular bump out of a random straight segment. Always
// preserves closure (every extrusion adds equal N/S and E/W displacement
// inside the bump that cancels). Produces organic blob shapes.
// ---------------------------------------------------------------------------

function perpCCW(d: Direction): Direction {
  // 90° CCW (left when facing in `d`).
  return ({ N: 'W', W: 'S', S: 'E', E: 'N' } as const)[d];
}

/**
 * Pick one straight segment in `steps` long enough to extrude, split it
 * around a random offset, and insert a 4-step rectangular bump. Returns a
 * new step list on success, or null if no segment was long enough.
 *
 * Always extrudes to the "left" of the walk direction. For CW base shapes
 * (rectangles wrapped clockwise) this points outward, growing the
 * perimeter. For CCW it eats inward — which is fine, also closes.
 */
export function extrudeRandomSegment(
  steps: ReadonlyArray<WalkStep>,
  rng: () => number = Math.random,
  minSegmentLen = 3,
  maxBumpDepth = 3,
): WalkStep[] | null {
  // Retry a few times — a single random pick may produce a self-
  // intersecting bump that we have to reject.
  for (let attempt = 0; attempt < 8; attempt++) {
    const candidate = attemptExtrusion(steps, rng, minSegmentLen, maxBumpDepth);
    if (candidate && isSelfAvoiding(candidate)) return candidate;
  }
  return null;
}

function attemptExtrusion(
  steps: ReadonlyArray<WalkStep>,
  rng: () => number,
  minSegmentLen: number,
  maxBumpDepth: number,
): WalkStep[] | null {
  const eligible: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]![1] >= minSegmentLen) eligible.push(i);
  }
  if (eligible.length === 0) return null;
  const idx = eligible[Math.floor(rng() * eligible.length)]!;
  const [dir, count] = steps[idx]!;
  // Closure-preserving split: count = k1 + width + k2  with each ≥ 1.
  const k1 = 1 + Math.floor(rng() * (count - 2));
  const remaining = count - k1 - 1;
  const k2 = 1 + Math.floor(rng() * remaining);
  const width = count - k1 - k2;
  const depth = 1 + Math.floor(rng() * maxBumpDepth);
  const out = perpCCW(dir);
  const back = opposite(out);
  return [
    ...steps.slice(0, idx),
    [dir, k1],
    [out, depth],
    [dir, width],
    [back, depth],
    [dir, k2],
    ...steps.slice(idx + 1),
  ];
}

/**
 * Walk the steps and classify the result. Returns:
 *   - `cellVisits`: per-cell list of (entry, exit) visits, mirroring what
 *     `placePolygonLoop` produces internally. Useful for validating
 *     candidate walks before tile placement.
 *   - `crossings`: count of cells visited exactly twice with a valid
 *     perpendicular routing (entries + exits cover {N,E,S,W}).
 *   - `invalidCells`: cells that break the contract (visited 3+ times, or
 *     visited 2x without all 4 directions distinct). Empty on a valid walk.
 *
 * This is the source of truth for "can this walk be turned into a layout".
 */
type Visit = { entry: Direction; exit: Direction };
export interface WalkAnalysis {
  cellVisits: Map<string, Visit[]>;
  crossings: number;
  invalidCells: string[];
}
export function analyzeWalk(steps: ReadonlyArray<WalkStep>): WalkAnalysis {
  // Expand to cell list with per-cell entries/exits.
  let cx = 0, cz = 0;
  const cells: Array<[number, number]> = [[cx, cz]];
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    for (let i = 0; i < count; i++) {
      cx += vx;
      cz += vz;
      cells.push([cx, cz]);
    }
  }
  // Last cell is the closure back to origin; drop the duplicate.
  cells.pop();
  const n = cells.length;
  const visits = new Map<string, Visit[]>();
  for (let i = 0; i < n; i++) {
    const [gx, gz] = cells[i]!;
    const [pgx, pgz] = cells[(i - 1 + n) % n]!;
    const [ngx, ngz] = cells[(i + 1) % n]!;
    const entry = opposite(dirFromTo(pgx, pgz, gx, gz));
    const exit = dirFromTo(gx, gz, ngx, ngz);
    const key = `${gx},${gz}`;
    let list = visits.get(key);
    if (!list) {
      list = [];
      visits.set(key, list);
    }
    list.push({ entry, exit });
  }
  let crossings = 0;
  const invalidCells: string[] = [];
  for (const [key, list] of visits) {
    if (list.length === 1) continue;
    if (list.length !== 2) { invalidCells.push(key); continue; }
    // Both visits must be straight-through (entry == opposite(exit)) for a
    // CROSS_NESW, AND the two visits must be perpendicular to each other.
    // Equivalent shortcut: the 4 ports used (entry1, exit1, entry2, exit2)
    // must be exactly {N,E,S,W}.
    const used = new Set<Direction>([
      list[0]!.entry, list[0]!.exit, list[1]!.entry, list[1]!.exit,
    ]);
    if (used.size === 4) crossings++;
    else invalidCells.push(key);
  }
  return { cellVisits: visits, crossings, invalidCells };
}

/** True iff walking `steps` from origin never revisits a cell (except for
 *  the final return to origin that closes the loop). Used to reject
 *  extrusion candidates whose bump collides with the existing path. */
function isSelfAvoiding(steps: ReadonlyArray<WalkStep>): boolean {
  let totalSteps = 0;
  for (const [, count] of steps) totalSteps += count;
  let cx = 0;
  let cz = 0;
  const seen = new Set<string>([`${cx},${cz}`]);
  let i = 0;
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    for (let j = 0; j < count; j++) {
      cx += vx;
      cz += vz;
      i++;
      // The very last step closes the loop by returning to (0,0); that
      // duplicate is expected and skipped.
      if (i === totalSteps) continue;
      const key = `${cx},${cz}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
  }
  return true;
}

/**
 * Build a randomly-shaped loop by starting from a random small rectangle
 * and applying N extrusions. Each extrusion preserves closure, so the
 * result is always a valid closed perimeter — without the closure-bias
 * problems of pure random walks.
 *
 * If `bridges > 0`, also tries to insert that many ramp bridges on
 * straight cell runs ≥ 3. Each bridge climbs RAMP_HEIGHT and immediately
 * descends back to ground — no stacking, max height stays at RAMP_HEIGHT.
 */
export function generateExtrudedLoop(
  layout: TrackLayout,
  rng: () => number = Math.random,
  iterations = 3,
  bridges = 0,
): { start: PlacedTile; startEntry: Direction; steps: ReadonlyArray<WalkStep> } {
  // Sized for a 28-unit / ~11-tile plate: 6-8 cells wide × 5-7 tall base,
  // plus a few extrusions, fills most of the baseplate.
  const w = 6 + Math.floor(rng() * 3);
  const h = 5 + Math.floor(rng() * 3);
  let steps: WalkStep[] = [['E', w], ['S', h], ['W', w], ['N', h]];
  for (let i = 0; i < iterations; i++) {
    const next = extrudeRandomSegment(steps, rng);
    if (next) steps = next;
  }
  const origin = centeredOrigin(steps);
  const overrides = buildBridgeOverrides(steps, rng, bridges, origin);
  const { start, startEntry } = placeWalkLoop(layout, steps, origin, overrides);
  return { start, startEntry, steps };
}

// ---------------------------------------------------------------------------
// Twist operator: take a closed walk that has K crossings, return a new walk
// with K+1 crossings. Each call inserts a small "dip" detour into one
// straight segment such that the detour and the original straight share
// exactly one cell, with perpendicular routings — a valid CROSS_NESW.
//
// Dip shape for a horizontal straight `[E, n]`:
//
//        . . X . X . . .          - = original straight (z=0)
//        . . | . | . . .          | = dip outward leg (z=-1)
//        - - - * - - - -          X = dip horizontal leg above (z=-1)
//        . . | . | . . .          # = dip horizontal leg below (z=1)
//        . . # # # . . .          * = the new crossing cell (z=0)
//
// The dip extends 1 cell perpendicular-outward (CCW) and 1 cell
// perpendicular-inward, so it bumps slightly outside AND slightly inside
// the polygon. The "inside" cells (3 of them) are what risk colliding
// with the rest of the walk — analyzeWalk catches that as invalid.
// ---------------------------------------------------------------------------

/**
 * Try once to attach a dip to one of the eligible straight segments. The
 * caller is responsible for validating the result with `analyzeWalk`.
 * Returns null if no segment is long enough.
 */
function attemptTwist(
  steps: ReadonlyArray<WalkStep>,
  rng: () => number,
  minSegmentLen: number,
): WalkStep[] | null {
  // Dip eats up `wu - wd + 1 = 2` cells from the segment's length and
  // needs at least 1 cell on each side: minimum count = 1 + 2 + 1 = 4.
  const eligible: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]![1] >= minSegmentLen) eligible.push(i);
  }
  if (eligible.length === 0) return null;
  const idx = eligible[Math.floor(rng() * eligible.length)]!;
  const [dir, count] = steps[idx]!;
  const wu = 2;
  const wd = 1;
  // j is the lead-in length before the dip starts. Tail length =
  // count - j - wu + wd = count - j - 1. Need tail ≥ 1, so j ≤ count - 2.
  // Also need j ≥ 1.
  const j = 1 + Math.floor(rng() * (count - 2));
  const tail = count - j - wu + wd;
  if (tail < 1) return null;
  const out = perpCCW(dir);     // outward of the dip (CCW = "left" of walk)
  const back = opposite(out);   // inward — the leg that pierces the original
  const rev = opposite(dir);
  return [
    ...steps.slice(0, idx),
    [dir, j],
    [out, 1],
    [dir, wu],
    [back, 2],
    [rev, wd],
    [out, 1],
    [dir, tail],
    ...steps.slice(idx + 1),
  ];
}

/**
 * Add exactly one crossing to `steps`. Returns null if no eligible
 * segment exists OR every attempted dip collides with the rest of the
 * walk. Multiple attempts pick different segments.
 */
export function twistRandomSegment(
  steps: ReadonlyArray<WalkStep>,
  rng: () => number = Math.random,
  minSegmentLen = 4,
  maxAttempts = 16,
): WalkStep[] | null {
  const baseline = analyzeWalk(steps);
  if (baseline.invalidCells.length > 0) return null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = attemptTwist(steps, rng, minSegmentLen);
    if (!candidate) return null;
    const a = analyzeWalk(candidate);
    if (a.invalidCells.length === 0 && a.crossings === baseline.crossings + 1) {
      return candidate;
    }
  }
  return null;
}

/**
 * Build a randomly-shaped loop with at least `targetCrossings` self-
 * crossings. Starts from a small rectangle, applies a few extrusions for
 * organic shape, then applies twists until the target is hit (or we run
 * out of eligible segments). Always returns a valid walk — the actual
 * crossings count is included in the result so the caller can adapt.
 */
export function generateTwistedLoop(
  layout: TrackLayout,
  rng: () => number = Math.random,
  iterations = 3,
  targetCrossings = 2,
): { start: PlacedTile; startEntry: Direction; steps: ReadonlyArray<WalkStep>; crossings: number } {
  // Sized for the 28-unit plate: 7-9 wide × 6-8 tall starting box. Twists
  // need 4-cell straights and consume interior space, so we start bigger
  // than the pure-extrude default.
  const w = 7 + Math.floor(rng() * 3);
  const h = 6 + Math.floor(rng() * 3);
  let steps: WalkStep[] = [['E', w], ['S', h], ['W', w], ['N', h]];
  for (let i = 0; i < iterations; i++) {
    const next = extrudeRandomSegment(steps, rng);
    if (next) steps = next;
  }
  let crossings = 0;
  // Each twist tries hard; if none succeed we bail rather than spin forever.
  for (let i = 0; i < targetCrossings; i++) {
    const next = twistRandomSegment(steps, rng);
    if (!next) break;
    steps = next;
    crossings++;
  }
  const { start, startEntry } = placeWalkLoop(layout, steps, centeredOrigin(steps));
  return { start, startEntry, steps, crossings };
}

// --- Bridge insertion --------------------------------------------------

/** Rotation lookup for ramp tiles by walking direction. RAMP_NS base has
 *  N=low (y=0) and S=high (y=RAMP_HEIGHT); these rotations align that
 *  pattern with each cardinal walk so entry-port Y is always low. */
export const RAMP_UP_ROT: Record<Direction, Rotation> = { E: 1, W: 3, N: 2, S: 0 };
/** Same trick but with the high port at the entry side. */
export const RAMP_DOWN_ROT: Record<Direction, Rotation> = { E: 3, W: 1, N: 0, S: 2 };
/** ELEVATED_STRAIGHT_NS rotated to match the walk direction. */
export const ELEVATED_ROT: Record<Direction, Rotation> = { E: 1, W: 1, N: 0, S: 0 };

/**
 * Walk the cell list and find runs of ≥ `minLen` consecutive *straight*
 * cells in the same direction. A cell is "straight in direction X" iff
 * its entry direction (== exit of previous cell) equals its own exit
 * direction X — i.e. the walker passes through without turning. Corner
 * cells (where entry != exit) are explicitly excluded from runs because
 * placing a ramp tile on a corner produces wrong-orientation ports.
 */
export function findStraightRuns(
  cells: ReadonlyArray<readonly [number, number]>,
  minLen: number,
): Array<{ dir: Direction; cells: Array<[number, number]>; startIdx: number }> {
  const runs: Array<{ dir: Direction; cells: Array<[number, number]>; startIdx: number }> = [];
  const n = cells.length;
  if (n < minLen) return runs;
  const exitDir: Direction[] = [];
  for (let i = 0; i < n; i++) {
    const [cx, cz] = cells[i]!;
    const [nx, nz] = cells[(i + 1) % n]!;
    exitDir.push(dirFromTo(cx, cz, nx, nz));
  }
  let i = 0;
  while (i < n) {
    const entry = exitDir[(i - 1 + n) % n]!;
    const exit = exitDir[i]!;
    if (entry !== exit) {
      i++;
      continue;
    }
    const dir = exit;
    const start = i;
    while (i < n) {
      const e = exitDir[(i - 1 + n) % n]!;
      const x = exitDir[i]!;
      if (e === dir && x === dir) i++;
      else break;
    }
    const len = i - start;
    if (len >= minLen) {
      const slice: Array<[number, number]> = [];
      for (let j = start; j < start + len; j++) slice.push([cells[j]![0], cells[j]![1]]);
      runs.push({ dir, cells: slice, startIdx: start });
    }
  }
  return runs;
}

/**
 * Try to insert `bridgeCount` ramp bridges on long straight runs of the
 * cell path. Each bridge takes 3 consecutive cells: RAMP up, ELEVATED,
 * RAMP down. Runs are claimed greedily so two bridges never overlap.
 */
function buildBridgeOverrides(
  steps: ReadonlyArray<WalkStep>,
  rng: () => number,
  bridgeCount: number,
  origin: readonly [number, number] = [0, 0],
): PolygonOverrides | undefined {
  if (bridgeCount <= 0) return undefined;
  // Expand steps to cell list — mirrors placeWalkLoop's logic. Must use the
  // same origin as the placer so the override keys match the placed cells.
  let cx = origin[0], cz = origin[1];
  const cells: Array<[number, number]> = [[cx, cz]];
  for (const [dir, count] of steps) {
    const [vx, vz] = dirVector(dir);
    for (let i = 0; i < count; i++) {
      cx += vx;
      cz += vz;
      cells.push([cx, cz]);
    }
  }
  cells.pop();
  const runs = findStraightRuns(cells, 3);
  if (runs.length === 0) return undefined;
  // Shuffle runs so bridges land at random straights.
  for (let i = runs.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [runs[i], runs[j]] = [runs[j]!, runs[i]!];
  }
  const overrides = new Map<string, { def: TrackTileDef; rotation: Rotation }>();
  let placed = 0;
  for (const run of runs) {
    if (placed >= bridgeCount) break;
    if (run.cells.length < 3) continue;
    // Place the bridge at the start of the run (could also randomise offset).
    const [up, elev, down] = run.cells;
    overrides.set(`${up![0]},${up![1]}`,     { def: RAMP_NS,              rotation: RAMP_UP_ROT[run.dir] });
    overrides.set(`${elev![0]},${elev![1]}`, { def: ELEVATED_STRAIGHT_NS, rotation: ELEVATED_ROT[run.dir] });
    overrides.set(`${down![0]},${down![1]}`, { def: RAMP_NS,              rotation: RAMP_DOWN_ROT[run.dir] });
    placed++;
  }
  return overrides;
}

// ---------------------------------------------------------------------------
// Ramp loop template: a rectangle whose top edge climbs over a bridge span
// and descends back to ground. Uses placePolygonLoop's override map.
// ---------------------------------------------------------------------------

/**
 * Place a closed rectangle whose middle of the top edge climbs a ramp,
 * runs across an elevated span, and ramps back down. Width must be ≥ 5
 * (room for: corner + straight + ramp + elevated + ramp + straight + corner).
 */
export function placeRampBridgeLoop(
  layout: TrackLayout,
  w: number,
  h: number,
  origin: readonly [number, number] = [0, 0],
): { start: PlacedTile; startEntry: Direction } {
  if (w < 5) throw new Error('ramp bridge loop needs width >= 5');
  if (h < 2) throw new Error('ramp bridge loop needs height >= 2');
  const steps: WalkStep[] = [['E', w - 1], ['S', h - 1], ['W', w - 1], ['N', h - 1]];
  // Top edge cells (after start cell at origin) are at gz = origin[1].
  // They run E from origin gx=0..w-1. The middle 3 cells host the ramps
  // + elevated straight: at gx = ramp-up, gx+1 = elevated, gx+2 = ramp-down.
  const oz = origin[1];
  const ox = origin[0];
  const rampStartX = ox + Math.floor((w - 3) / 2);
  // Walker travels E across the top, so entry/exit for these cells are
  // W → E. Ramp rotations: RAMP_NS rot 1 climbs west→east (W low, E high);
  // ELEVATED_STRAIGHT_NS rot 1 is flat at RAMP_HEIGHT W↔E; RAMP_NS rot 3
  // descends west→east (W high, E low).
  const overrides: Map<string, { def: TrackTileDef; rotation: Rotation }> = new Map([
    [`${rampStartX},${oz}`,     { def: RAMP_NS,             rotation: 1 }],
    [`${rampStartX + 1},${oz}`, { def: ELEVATED_STRAIGHT_NS, rotation: 1 }],
    [`${rampStartX + 2},${oz}`, { def: RAMP_NS,             rotation: 3 }],
  ]);
  return placeWalkLoop(layout, steps, origin, overrides);
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
