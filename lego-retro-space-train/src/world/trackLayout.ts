import * as THREE from 'three';
import {
  PlacedTile,
  Direction,
  Rotation,
  STRAIGHT_NS,
  CURVE_NE,
  RAMP_NS,
  ELEVATED_STRAIGHT_NS,
  TILE_SIZE,
  TrackTileDef,
  effectivePorts,
  sampleWorldPath,
  dirVector,
  opposite,
} from './trackTile';

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

  place(
    gx: number,
    gz: number,
    def: TrackTileDef,
    rotation: Rotation,
    routing?: Map<Direction, Direction>,
  ): PlacedTile {
    const tile: PlacedTile = { gridX: gx, gridZ: gz, def, rotation, routing };
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
export type PolygonOverrides = ReadonlyMap<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>;

export function placePolygonLoop(
  layout: TrackLayout,
  cells: ReadonlyArray<readonly [number, number]>,
  overrides?: PolygonOverrides,
): { start: PlacedTile; startEntry: Direction } {
  if (cells.length < 4) {
    throw new Error('polygon loop needs at least 4 cells');
  }
  const n = cells.length;
  for (let i = 0; i < n; i++) {
    const [gx, gz] = cells[i]!;
    const [pgx, pgz] = cells[(i - 1 + n) % n]!;
    const [ngx, ngz] = cells[(i + 1) % n]!;
    const arrival = dirFromTo(pgx, pgz, gx, gz);
    const departure = dirFromTo(gx, gz, ngx, ngz);
    const entry = opposite(arrival);
    const exit = departure;
    const override = overrides?.get(`${gx},${gz}`);
    if (override) {
      layout.place(gx, gz, override.def, override.rotation, override.routing);
    } else {
      const { def, rotation } = pickStraightOrCurve(entry, exit);
      layout.place(gx, gz, def, rotation);
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
];

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
  // Need count ≥ 3 so k1 + width + k2 = count with each ≥ 1.
  const eligible: number[] = [];
  for (let i = 0; i < steps.length; i++) {
    if (steps[i]![1] >= minSegmentLen) eligible.push(i);
  }
  if (eligible.length === 0) return null;
  const idx = eligible[Math.floor(rng() * eligible.length)]!;
  const [dir, count] = steps[idx]!;
  // Closure-preserving split: the bump's horizontal span (`width`) eats
  // into the original count so net displacement in `dir` stays at `count`.
  // count = k1 + width + k2  with each side ≥ 1.
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
 * Build a randomly-shaped loop by starting from a random small rectangle
 * and applying N extrusions. Each extrusion preserves closure, so the
 * result is always a valid closed perimeter — without the closure-bias
 * problems of pure random walks.
 */
export function generateExtrudedLoop(
  layout: TrackLayout,
  rng: () => number = Math.random,
  iterations = 3,
): { start: PlacedTile; startEntry: Direction; steps: ReadonlyArray<WalkStep> } {
  // Random base rectangle 3-5 wide, 2-4 tall.
  const w = 3 + Math.floor(rng() * 3);
  const h = 2 + Math.floor(rng() * 3);
  let steps: WalkStep[] = [['E', w], ['S', h], ['W', w], ['N', h]];
  for (let i = 0; i < iterations; i++) {
    const next = extrudeRandomSegment(steps, rng);
    if (next) steps = next;
  }
  const { start, startEntry } = placeWalkLoop(layout, steps);
  return { start, startEntry, steps };
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
