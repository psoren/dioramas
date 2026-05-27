// ---------------------------------------------------------------------------
// Wave Function Collapse over our port-typed tile set.
//
// HIGH-LEVEL OVERVIEW
// ===================
// Each cell on the grid starts in "superposition" — all variants possible.
// We loop:
//   1. Observe: pick the cell with the lowest entropy, collapse it to one
//      variant chosen by weighted random.
//   2. Propagate: walk neighbors, prune any variant whose adjacency rule
//      no longer holds.
// Repeat until done, or contradiction → restart.
//
// ADJACENCY RULES
// ===============
// Two cells touching on a boundary must agree on what's there:
//   - If tile A has a port on its east side at world-Y = Y, tile B (to the
//     east of A) must have a port on its west side at the same Y.
//   - If tile A has NO port on its east side, tile B must also have NO
//     port on its west side.
// We auto-derive the table from `effectivePorts` + `portY`. No hand rules.
//
// EMPTY TILE
// ==========
// `EMPTY_TILE` has 0 ports. Its adjacency rule on every side is "neighbor
// must also have no port on the shared boundary." Without EMPTY, WFC has
// no way to leave cells blank → can only produce full-grid layouts.
// ---------------------------------------------------------------------------
import {
  ALL_TILES,
  Direction,
  DIRECTIONS,
  EMPTY_TILE,
  PlacedTile,
  RAMP_HEIGHT,
  Rotation,
  TrackTileDef,
  effectivePorts,
  opposite,
} from './trackTile';
import { portY } from './trackLayout';

const ROTATIONS: readonly Rotation[] = [0, 1, 2, 3];
// EMPTY kept in the variant pool (with crushed weight, see defaultWeight)
// as the solver's "escape valve" — without it, boundary cells often have
// no valid variant on 21×21 grids and WFC contradicts continuously. With
// EMPTY at weight 0.005, it's still picked rarely vs track tiles.
const TILE_DEFS: readonly TrackTileDef[] = [...ALL_TILES, EMPTY_TILE];

export interface Variant {
  /** Stable string id, e.g. "straight-ns@1". */
  id: string;
  def: TrackTileDef;
  rotation: Rotation;
  /** Optional level shift. For the initial enumeration we expose level=0
   *  and level=1 for elevated-capable variants; deeper levels can be added
   *  by the caller as needed. */
  level: number;
  /** Default weight in the WFC selection. Higher = more common output. */
  weight: number;
  /** Effective ports after rotation, cached. */
  ports: readonly Direction[];
  /** For each side {N,E,S,W}, the world-Y(s) of the port(s) on that
   *  side, or null if no port. Most tiles have one Y per direction;
   *  parallel-overpass tiles have two (lower + upper layer). Array is
   *  always sorted ascending so adjacency comparison is straightforward. */
  portY: Record<Direction, readonly number[] | null>;
}

/** Enumerate every meaningful (def, rotation, level) variant, deduping
 *  symmetric rotations (e.g. STRAIGHT_NS rot 0 and rot 2 are visually the
 *  same). Level=0 always; level=1 is added for elevated-capable kinds. */
export function enumerateVariants(maxLevel = 1): Variant[] {
  const out: Variant[] = [];
  const seen = new Set<string>();
  for (const def of TILE_DEFS) {
    const levels = supportsLevels(def) ? [...range(0, maxLevel)] : [0];
    for (const level of levels) {
      for (const rot of ROTATIONS) {
        const fakeTile: PlacedTile = { gridX: 0, gridZ: 0, def, rotation: rot, level };
        const ports = effectivePorts(fakeTile);
        const portYMap: Record<Direction, readonly number[] | null> = {
          N: null, E: null, S: null, W: null,
        };
        // Compute multi-Y for parallel-overpass tiles (both layers
        // present at every port); single-Y for everything else.
        if (def.kind === 'parallel-overpass-ns') {
          const yLow = level * RAMP_HEIGHT;
          const yHigh = (level + 1) * RAMP_HEIGHT;
          // Rotation 0 (or 2): both layers N-S → N+S ports at both Ys.
          // Rotation 1 (or 3): both layers E-W → E+W ports at both Ys.
          const vertical = rot === 0 || rot === 2;
          if (vertical) { portYMap.N = [yLow, yHigh]; portYMap.S = [yLow, yHigh]; }
          else { portYMap.E = [yLow, yHigh]; portYMap.W = [yLow, yHigh]; }
        } else if (def.kind === 'parallel-overpass-curve-ne') {
          // Curve variant: both layers turn the same way. Base rotation
          // (0) has N+E ports at both Y=0 and Y=H. Rotations rotate the
          // port pair around the cell.
          const yLow = level * RAMP_HEIGHT;
          const yHigh = (level + 1) * RAMP_HEIGHT;
          const ys = [yLow, yHigh] as const;
          // Effective port directions for CURVE_NE rot r: N+E becomes
          // E+S (rot 1), S+W (rot 2), W+N (rot 3).
          const ports2 = effectivePorts(fakeTile);
          for (const p of ports2) portYMap[p] = ys;
        } else if (def.kind === 'parallel-overpass-ramp-ns') {
          // Transition: one side multi-Y (matches a parallel overpass),
          // opposite side single-Y at Y=lower (matches normal ground
          // track). The primary RAMP_NS at rotation r has its HIGH port
          // on the side rotateDir(S, r) — i.e., rot 0 → S@H, rot 1 →
          // W@H, rot 2 → N@H, rot 3 → E@H. The overpass attaches to
          // the high side; ground attaches to the opposite low side.
          const yLow = level * RAMP_HEIGHT;
          const yHigh = (level + 1) * RAMP_HEIGHT;
          const overpassSides: Record<number, [Direction, Direction]> = {
            0: ['S', 'N'], // RAMP rot 0: S=high → overpass S, ground N
            1: ['E', 'W'], // RAMP rot 1: E=high → overpass E, ground W
            2: ['N', 'S'], // RAMP rot 2: N=high → overpass N, ground S
            3: ['W', 'E'], // RAMP rot 3: W=high → overpass W, ground E
          };
          const [overpassDir, groundDir] = overpassSides[rot]!;
          portYMap[overpassDir] = [yLow, yHigh];
          portYMap[groundDir] = [yLow];
        } else {
          for (const p of ports) portYMap[p] = [portY(fakeTile, p)];
        }
        // Canonical key: sorted (port, Y-array) entries + level + kind.
        // Dedupes rotations that produce the same port-Y signature.
        const portKey = (['N', 'E', 'S', 'W'] as const)
          .map((d) => `${d}:${portYMap[d] === null ? 'x' : (portYMap[d] as readonly number[]).map((y) => y.toFixed(3)).join('|')}`)
          .join(',');
        const key = `${def.kind}|L${level}|${portKey}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const id = `${def.kind}@${rot}${level === 0 ? '' : `+L${level}`}`;
        out.push({
          id, def, rotation: rot, level,
          weight: defaultWeight(def),
          ports,
          portY: portYMap,
        });
      }
    }
  }
  return out;
}

function supportsLevels(def: TrackTileDef): boolean {
  return (
    def.kind === 'elevated-straight-ns' ||
    def.kind === 'elevated-curve-ne' ||
    def.kind === 'ramp-ns' ||
    // Under-pass at level k: lower layer at k*H, upper layer at (k+1)*H.
    // Level 0 = ground/level-1 crossing, level 1 = level-1/level-2 crossing.
    def.kind === 'under-pass-nesw' ||
    // Parallel overpass family — straight, curve, and transition (ramp
    // into/out of a parallel run). Lower at k*H, upper at (k+1)*H.
    def.kind === 'parallel-overpass-ns' ||
    def.kind === 'parallel-overpass-curve-ne' ||
    def.kind === 'parallel-overpass-ramp-ns' ||
    // Stations on elevated track — a station at level=1 sits at y=H, etc.
    def.kind === 'station-n'
  );
}

/** Per-tile-kind weight bias for WFC selection. STRAIGHT is the most
 *  common tile in real track layouts; intersections are rare; EMPTY is
 *  moderately common so the grid can leave whitespace. */
function defaultWeight(def: TrackTileDef): number {
  switch (def.kind) {
    case 'straight-ns': return 6;
    case 'curve-ne': return 5;
    case 'tee-nes': return 0.4;
    case 'cross-nesw': return 0.15;
    case 'ramp-ns': return 0.2;
    case 'ramp-ns-tall': return 0.2;
    case 'elevated-straight-ns': return 0.4;
    case 'elevated-curve-ne': return 0.25;
    case 'station-n': return 0.4;
    case 'under-pass-nesw': return 0.3;
    // Parallel overpasses are the headline feature — bump them aggressively
    // so WFC picks them whenever adjacency allows (instead of preferring
    // a straight ground tile). Transition tiles also raised because
    // every overpass section needs at least 2 of them to attach to ground.
    case 'parallel-overpass-ns': return 2.5;
    case 'parallel-overpass-curve-ne': return 2.0;
    case 'parallel-overpass-ramp-ns': return 1.5;
    case 'empty': return 0.005;
    default: return 1;
  }
}

function range(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

/** Adjacency table. `allowed[variantId][side]` is the set of variant IDs
 *  that may sit on the given side of `variantId`. Symmetric: if A is
 *  allowed east of B, then B is allowed west of A. */
export interface AdjacencyTable {
  variants: readonly Variant[];
  byId: ReadonlyMap<string, Variant>;
  /** allowed[fromId][side] → set of toIds. */
  allowed: ReadonlyMap<string, Record<Direction, ReadonlySet<string>>>;
}

/** Build the adjacency table by checking every variant pair on every
 *  boundary. Two variants A, B fit across boundary side(A) = opposite(side(B))
 *  iff their port-presence + Y values match on the shared edge. */
export function buildAdjacencyTable(variants: readonly Variant[]): AdjacencyTable {
  const byId = new Map<string, Variant>(variants.map((v) => [v.id, v]));
  const allowed = new Map<string, Record<Direction, Set<string>>>();
  for (const a of variants) {
    allowed.set(a.id, { N: new Set(), E: new Set(), S: new Set(), W: new Set() });
  }
  for (const a of variants) {
    for (const side of DIRECTIONS) {
      const aY = a.portY[side];
      for (const b of variants) {
        const bSide = opposite(side);
        const bY = b.portY[bSide];
        if (portYArraysEqual(aY, bY)) allowed.get(a.id)![side].add(b.id);
      }
    }
  }
  return { variants, byId, allowed };
}

/** True when two port-Y arrays match. Both null = compatible (no port
 *  on either side); both non-null = same length and same Ys element-
 *  wise (within tolerance). Arrays are pre-sorted ascending by
 *  enumerateVariants so we can compare positionally. */
function portYArraysEqual(a: readonly number[] | null, b: readonly number[] | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (Math.abs(a[i]! - b[i]!) >= 0.01) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// WFC solver (minimal: shannon-entropy observe, propagation, full-restart
// on contradiction).
// ---------------------------------------------------------------------------

export interface WFCOptions {
  /** Grid width (cells). */
  width: number;
  /** Grid height (cells). */
  height: number;
  /** Optional pre-collapsed cells. Map key "x,y" → variant id. */
  preSeed?: ReadonlyMap<string, string>;
  /** Random number source. */
  rng?: () => number;
  /** Max restarts on contradiction before giving up. */
  maxRetries?: number;
  /** Per-call weight overrides, keyed by variant id. Lets the densify
   *  pass crush EMPTY weight without rebuilding the adjacency table. */
  weightOverride?: ReadonlyMap<string, number>;
  /** "Soft" pre-seed: restrict each listed cell's options to the given
   *  subset (instead of locking to a single id). Used by the additive
   *  flow so a cumulative STRAIGHT_NS can UPGRADE to TEE_NES when a new
   *  track branches off it — pin the required port-Y signature but let
   *  WFC pick a richer variant that covers it. */
  softPreSeed?: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface WFCResult {
  /** Map "x,y" → variant id. Cells outside grid bounds are not present. */
  cells: Map<string, string>;
  /** Total number of restarts that happened. */
  retries: number;
}

/** Run WFC. Returns the solved grid, or throws if it can't solve within
 *  the retry budget. */
export function solveWFC(table: AdjacencyTable, opts: WFCOptions): WFCResult {
  const rng = opts.rng ?? Math.random;
  const maxRetries = opts.maxRetries ?? 20;
  for (let retry = 0; retry <= maxRetries; retry++) {
    try {
      const cells = solveOnce(table, opts, rng);
      return { cells, retries: retry };
    } catch (e) {
      if ((e as Error).message !== 'WFC_CONTRADICTION') throw e;
    }
  }
  throw new Error(`WFC: exceeded ${maxRetries} retries`);
}

function solveOnce(
  table: AdjacencyTable,
  opts: WFCOptions,
  rng: () => number,
): Map<string, string> {
  const { width, height } = opts;
  const variants = table.variants;
  const allIds = new Set(variants.map((v) => v.id));

  // Initialize each cell to all variants.
  const cellOptions = new Map<string, Set<string>>();
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      cellOptions.set(key(x, y), new Set(allIds));
    }
  }

  // Apply boundary constraints: grid-edge cells can't have ports facing
  // outside the grid.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const opts2 = cellOptions.get(key(x, y))!;
      for (const id of [...opts2]) {
        const v = table.byId.get(id)!;
        if (x === 0 && v.portY.W !== null) opts2.delete(id);
        if (x === width - 1 && v.portY.E !== null) opts2.delete(id);
        if (y === 0 && v.portY.N !== null) opts2.delete(id);
        if (y === height - 1 && v.portY.S !== null) opts2.delete(id);
      }
      if (opts2.size === 0) throw new Error('WFC_CONTRADICTION');
    }
  }

  // Apply pre-seeds.
  if (opts.preSeed) {
    for (const [k, id] of opts.preSeed) {
      const set = cellOptions.get(k);
      if (!set) continue;
      if (!set.has(id)) throw new Error('WFC_CONTRADICTION');
      set.clear();
      set.add(id);
    }
  }
  // Apply soft pre-seeds (intersection with allowed subset). Lets the
  // caller say "this cell must be one of these variants" without locking
  // to a single id.
  if (opts.softPreSeed) {
    for (const [k, allowed] of opts.softPreSeed) {
      const set = cellOptions.get(k);
      if (!set) continue;
      for (const id of [...set]) if (!allowed.has(id)) set.delete(id);
      if (set.size === 0) throw new Error('WFC_CONTRADICTION');
    }
  }

  // Propagate from every cell once (initial settle).
  const toPropagate: string[] = [];
  for (const k of cellOptions.keys()) toPropagate.push(k);
  while (toPropagate.length > 0) {
    const k = toPropagate.pop()!;
    propagate(k, cellOptions, table, width, height, toPropagate);
  }

  // Observe loop: collapse one cell at a time, propagate.
  for (;;) {
    const next = pickLowestEntropyCell(cellOptions, rng);
    if (!next) break; // all collapsed
    const opts2 = cellOptions.get(next)!;
    const choice = weightedPick([...opts2], table, rng, opts.weightOverride);
    opts2.clear();
    opts2.add(choice);
    const queue = [next];
    while (queue.length > 0) {
      const k = queue.pop()!;
      propagate(k, cellOptions, table, width, height, queue);
    }
  }

  // Final collapse: extract each cell's single variant.
  const out = new Map<string, string>();
  for (const [k, set] of cellOptions) {
    if (set.size !== 1) throw new Error('WFC_CONTRADICTION');
    out.set(k, [...set][0]!);
  }
  return out;
}

function propagate(
  k: string,
  cellOptions: Map<string, Set<string>>,
  table: AdjacencyTable,
  width: number,
  height: number,
  queue: string[],
): void {
  const [x, y] = parseKey(k);
  const here = cellOptions.get(k)!;
  for (const side of DIRECTIONS) {
    const [dx, dy] = sideToDelta(side);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
    const nk = key(nx, ny);
    const neighbor = cellOptions.get(nk)!;
    // Compute the union of variants that ANY of `here`'s variants permits
    // on this side. Then trim `neighbor` to that union.
    const permitted = new Set<string>();
    for (const id of here) {
      const v = table.allowed.get(id)![side];
      for (const allowedId of v) permitted.add(allowedId);
    }
    let changed = false;
    for (const id of [...neighbor]) {
      if (!permitted.has(id)) {
        neighbor.delete(id);
        changed = true;
      }
    }
    if (neighbor.size === 0) throw new Error('WFC_CONTRADICTION');
    if (changed) queue.push(nk);
  }
}

function pickLowestEntropyCell(
  cellOptions: Map<string, Set<string>>,
  rng: () => number,
): string | null {
  let bestSize = Infinity;
  const ties: string[] = [];
  for (const [k, set] of cellOptions) {
    if (set.size <= 1) continue;
    if (set.size < bestSize) {
      bestSize = set.size;
      ties.length = 0;
      ties.push(k);
    } else if (set.size === bestSize) {
      ties.push(k);
    }
  }
  if (ties.length === 0) return null;
  return ties[Math.floor(rng() * ties.length)]!;
}

/** Frontier-biased observe: pick the lowest-entropy cell among those
 *  ADJACENT to an already-collapsed cell. The "wavefront" WFC variant —
 *  solution grows outward from existing collapses. NOT WIRED IN by
 *  default: on large grids it's O(n²) per observe step which makes
 *  21×21 solves unacceptably slow. Kept here so it can be swapped in
 *  for small grids or post-pre-seed wavefronts later. */
// @ts-expect-error unused but kept intentionally
function pickFrontierCell(
  cellOptions: Map<string, Set<string>>,
  width: number,
  height: number,
  rng: () => number,
): string | null {
  let bestSize = Infinity;
  const ties: string[] = [];
  for (const [k, set] of cellOptions) {
    if (set.size <= 1) continue;
    const [x, y] = parseKey(k);
    let hasCollapsedNeighbor = false;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const nset = cellOptions.get(key(nx, ny));
      if (nset && nset.size === 1) { hasCollapsedNeighbor = true; break; }
    }
    if (!hasCollapsedNeighbor) continue;
    if (set.size < bestSize) {
      bestSize = set.size;
      ties.length = 0;
      ties.push(k);
    } else if (set.size === bestSize) {
      ties.push(k);
    }
  }
  if (ties.length > 0) return ties[Math.floor(rng() * ties.length)]!;
  // No frontier — fall back to global lowest-entropy so we can seed a
  // new region (covers the no-pre-seed case + post-wavefront restarts).
  return pickLowestEntropyCell(cellOptions, rng);
}

function weightedPick(
  ids: readonly string[],
  table: AdjacencyTable,
  rng: () => number,
  weightOverride?: ReadonlyMap<string, number>,
): string {
  const wOf = (id: string): number =>
    weightOverride?.get(id) ?? table.byId.get(id)!.weight;
  let total = 0;
  for (const id of ids) total += wOf(id);
  let r = rng() * total;
  for (const id of ids) {
    r -= wOf(id);
    if (r <= 0) return id;
  }
  return ids[ids.length - 1]!;
}

function sideToDelta(side: Direction): [number, number] {
  switch (side) {
    case 'N': return [0, -1];
    case 'E': return [1, 0];
    case 'S': return [0, 1];
    case 'W': return [-1, 0];
  }
}

function key(x: number, y: number): string {
  return `${x},${y}`;
}

function parseKey(k: string): [number, number] {
  const [a, b] = k.split(',');
  return [Number(a), Number(b)];
}
