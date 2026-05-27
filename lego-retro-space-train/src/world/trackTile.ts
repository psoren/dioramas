import * as THREE from 'three';

/**
 * Tile primitives for procedurally composing track networks. The grid is
 * unit-sized in tile cells; world position of a cell is `(gx*TILE_SIZE, 0,
 * gz*TILE_SIZE)`. Tiles snap to that grid and connect via cardinal-direction
 * ports.
 *
 * Convention: looking down at the world from +Y, with +X pointing east:
 *   N = toward -Z, S = toward +Z, E = toward +X, W = toward -X.
 * In a base-rotation tile centred at the origin in local coords, port N sits
 * at (0, 0, -TILE_SIZE/2), port S at (0, 0, +TILE_SIZE/2), etc.
 */

export const TILE_SIZE = 2.4;

export type Direction = 'N' | 'E' | 'S' | 'W';
export const DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'] as const;

const DIR_VECTORS: Record<Direction, readonly [number, number]> = {
  N: [0, -1],
  E: [1, 0],
  S: [0, 1],
  W: [-1, 0],
};

export function dirVector(d: Direction): readonly [number, number] {
  return DIR_VECTORS[d];
}

export function opposite(d: Direction): Direction {
  return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[d];
}

/**
 * Rotate a direction CCW by `quarterTurns`. Matches Three.js `rotation.y`
 * sign (positive rotation.y = CCW when looking down). So a tile placed with
 * rotation=1 has its base N port appearing on its W side in world coords.
 */
export function rotateDir(d: Direction, quarterTurns: number): Direction {
  const idx = DIRECTIONS.indexOf(d);
  return DIRECTIONS[((idx - quarterTurns) % 4 + 4) % 4]!;
}

export type Rotation = 0 | 1 | 2 | 3;

/**
 * A tile kind. Each defines the set of cardinal ports it exposes in its
 * base (unrotated) orientation and how to sample paths between any two of
 * those ports.
 */
export interface TrackTileDef {
  kind: string;
  /** Cardinal ports in the base (rotation 0) orientation. */
  basePorts: readonly Direction[];
  /**
   * Sample the centerline between two of this tile's BASE ports.
   * Returns `samples + 1` points in local cell coordinates (XZ plane, y=0).
   * Endpoints are exactly at the port positions. Throws if the requested
   * pair of ports doesn't exist.
   */
  samplePath(from: Direction, to: Direction, samples: number): THREE.Vector3[];
}

const HALF = TILE_SIZE / 2;

function portPos(d: Direction): THREE.Vector3 {
  const [dx, dz] = DIR_VECTORS[d];
  return new THREE.Vector3(dx * HALF, 0, dz * HALF);
}

/** Vertical lift in world units that a single RAMP_NS tile produces. Use
 *  ELEVATED_STRAIGHT_NS / ELEVATED_CURVE_NE on top to build bridges.
 *  Sized so a train (top ≈ 0.78 world units) clears the elevated deck
 *  with ≈0.6 units of headroom — enough to look like a real bridge with
 *  a track running under it. */
export const RAMP_HEIGHT = 1.4;

// --- Straight tile: N <-> S ---------------------------------------------
export const STRAIGHT_NS: TrackTileDef = {
  kind: 'straight-ns',
  basePorts: ['N', 'S'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const a = portPos(from);
    const b = portPos(to);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t));
    }
    return pts;
  },
};

// --- Ramp tile: N <-> S, low N (y=0) → high S (y=RAMP_HEIGHT) -----------
// XZ is a straight line; Y is LINEAR within the tile. Smoothness at cell
// boundaries comes from the graph-builder's run-aware sampler, which
// detects sequences of consecutive ramp cells and replaces the linear
// per-cell Y with a single cosine S-curve over the whole run. This way
// stacking N ramp cells produces ONE smooth ease (not N small ones with
// "wave" seams), and a single-cell ramp matches the previous cosine ease.
export const RAMP_NS: TrackTileDef = {
  kind: 'ramp-ns',
  basePorts: ['N', 'S'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const a = portPos(from);
    const b = portPos(to);
    if (from === 'S') a.y = RAMP_HEIGHT;
    if (to === 'S') b.y = RAMP_HEIGHT;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t));
    }
    return pts;
  },
};

// --- Tall ramp: N <-> S, low N (y=0) → high S (y=2*RAMP_HEIGHT). -------
// Climbs TWO levels in one cell. Steep (≈49° at midpoint) but allowed —
// lets the train go directly from ground to level 2 without an
// intermediate level-1 elevated section, opening up shorter bridge
// configurations than the 7-cell stepped climb. Cosine ease per cell so
// the slope is zero at both ports (not part of the multi-cell ramp-run
// sampler — that's only for regular RAMP_NS).
export const RAMP_NS_TALL: TrackTileDef = {
  kind: 'ramp-ns-tall',
  basePorts: ['N', 'S'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const a = portPos(from);
    const b = portPos(to);
    if (from === 'S') a.y = 2 * RAMP_HEIGHT;
    if (to === 'S') b.y = 2 * RAMP_HEIGHT;
    const aHigh = from === 'S';
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const eased = (1 - Math.cos(Math.PI * t)) / 2;
      const y = aHigh
        ? 2 * RAMP_HEIGHT + (0 - 2 * RAMP_HEIGHT) * eased
        : 0 + (2 * RAMP_HEIGHT - 0) * eased;
      const p = new THREE.Vector3().lerpVectors(a, b, t);
      p.y = y;
      pts.push(p);
    }
    return pts;
  },
};

// --- Elevated straight: N <-> S, both ports at y=RAMP_HEIGHT -----------
// Use between two ramps to build a bridge span over other tracks.
export const ELEVATED_STRAIGHT_NS: TrackTileDef = {
  kind: 'elevated-straight-ns',
  basePorts: ['N', 'S'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const a = portPos(from); a.y = RAMP_HEIGHT;
    const b = portPos(to);   b.y = RAMP_HEIGHT;
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t));
    }
    return pts;
  },
};

// --- Elevated curve: N <-> E quarter arc, both ports at y=RAMP_HEIGHT --
// Same shape as CURVE_NE but elevated, so bridges can TURN at height
// (not just run in straight spans). Needed for WFC layouts where the
// solver wants an L-shaped or U-shaped elevated section.
export const ELEVATED_CURVE_NE: TrackTileDef = {
  kind: 'elevated-curve-ne',
  basePorts: ['N', 'E'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const theta = (t * Math.PI) / 2;
      const x = HALF - HALF * Math.cos(theta);
      const z = -HALF + HALF * Math.sin(theta);
      pts.push(new THREE.Vector3(x, RAMP_HEIGHT, z));
    }
    if (from === 'E' && to === 'N') pts.reverse();
    return pts;
  },
};

// --- Empty tile: 0 ports, no traversal ---------------------------------
// Used by WFC to leave a cell blank. Never actually rendered as a tile;
// the layout simply doesn't place anything when WFC picks EMPTY for a
// cell. Has zero ports, so its adjacency rule on every side is "the
// neighbour must also have no port on the shared boundary."
export const EMPTY_TILE: TrackTileDef = {
  kind: 'empty',
  basePorts: [],
  samplePath() {
    return [];
  },
};

// --- Under-pass: 4 ports, but 2 elevated + 2 ground. ------------------
// A WFC-virtual tile: the solver picks it whenever a cell should host BOTH
// an elevated bridge passing through one axis AND a ground track passing
// through the perpendicular axis at the same XZ. At layout-conversion
// time the wfcGenerator decomposes it into an ELEVATED_STRAIGHT_NS
// primary tile + a STRAIGHT_NS under-tile (using existing infrastructure
// for stacked cells), so the graph builder and renderer never see this
// tile directly. samplePath therefore throws — it should never be called.
//
// Base orientation (rotation 0): N at y=0, E at y=RAMP_HEIGHT, S at y=0,
// W at y=RAMP_HEIGHT. I.e. elevated runs E-W, ground runs N-S.
export const UNDER_PASS_NESW: TrackTileDef = {
  kind: 'under-pass-nesw',
  basePorts: ['N', 'E', 'S', 'W'],
  samplePath() {
    throw new Error('UNDER_PASS is a WFC-virtual tile; decompose before placement');
  },
};

// --- Station: 1 port, dead-end. Buffer stop on the far side. ----------
// Lets WFC place stations naturally inside the grid (a STATION_N tile
// has a port on its N side and no ports on E/S/W, so WFC's adjacency
// rule forces the N neighbour to also have a south-facing port at y=0
// while the other 3 sides are EMPTY-compatible). The graph builder
// treats a STATION cell as a 1-edge graph node automatically.
//
// samplePath isn't meaningful for a 1-port tile (no port pair exists),
// so it throws — the graph builder only uses appendJunctionHalf for
// station cells, which builds a straight line from cell centre to the
// single port boundary.
export const STATION_N: TrackTileDef = {
  kind: 'station-n',
  basePorts: ['N'],
  samplePath() {
    throw new Error('STATION tile has only 1 port; samplePath not applicable');
  },
};

// --- 90° curve tile: N -> E (and reverse) -------------------------------
// Arc centered at the NE corner of the cell, radius = HALF.
// Enters at N port heading +Z, exits at E port heading +X (or reverse).
export const CURVE_NE: TrackTileDef = {
  kind: 'curve-ne',
  basePorts: ['N', 'E'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const pts: THREE.Vector3[] = [];
    // Sweep θ ∈ [0, π/2]: t=0 corresponds to N port, t=1 to E port.
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const theta = t * Math.PI / 2;
      // Arc relative to NE corner (HALF, 0, -HALF), radius HALF.
      const x = HALF - HALF * Math.cos(theta);
      const z = -HALF + HALF * Math.sin(theta);
      pts.push(new THREE.Vector3(x, 0, z));
    }
    if (from === 'E' && to === 'N') pts.reverse();
    return pts;
  },
};

// --- T-intersection (N, E, S) — Y-junction shape ------------------------
// Main route is straight N↔S. The two branch routes (N↔E and S↔E) are
// quarter arcs centred at the cell's NE and SE corners respectively, so
// the branch is tangent to the main line at the N or S port and curves
// smoothly out to the E port — like a real railroad turnout, not a
// 90° kink. (The two arcs overlap the main straight near the N/S ports
// but render harmlessly at the same y-level.)
export const TEE_NES: TrackTileDef = {
  kind: 'tee-nes',
  basePorts: ['N', 'E', 'S'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    const pair = `${from}${to}`;
    const pts: THREE.Vector3[] = [];
    if (pair === 'NS' || pair === 'SN') {
      // Main: straight line through centre.
      const a = portPos(from);
      const b = portPos(to);
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        pts.push(new THREE.Vector3().lerpVectors(a, b, t));
      }
      return pts;
    }
    if (pair === 'NE' || pair === 'EN') {
      // Arc from N port (0, -HALF) to E port (HALF, 0), centre at NE corner
      // (HALF, 0, -HALF). t=0 at N port, t=1 at E port.
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const theta = t * Math.PI / 2;
        const x = HALF - HALF * Math.cos(theta);
        const z = -HALF + HALF * Math.sin(theta);
        pts.push(new THREE.Vector3(x, 0, z));
      }
      if (from === 'E') pts.reverse();
      return pts;
    }
    // pair === 'ES' || 'SE'
    // Arc from S port (0, HALF) to E port (HALF, 0), centre at SE corner
    // (HALF, 0, HALF). t=0 at S port, t=1 at E port.
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const theta = t * Math.PI / 2;
      const x = HALF - HALF * Math.cos(theta);
      const z = HALF - HALF * Math.sin(theta);
      pts.push(new THREE.Vector3(x, 0, z));
    }
    if (from === 'E') pts.reverse();
    return pts;
  },
};

// --- 4-way intersection -------------------------------------------------
export const CROSS_NESW: TrackTileDef = {
  kind: 'cross-nesw',
  basePorts: ['N', 'E', 'S', 'W'],
  samplePath(from, to, samples) {
    requirePair(this, from, to);
    // Straight line through the centre for any pair. Sharper turns for
    // perpendicular pairs are fine — vehicles slow down a beat across the
    // cross visually anyway.
    const a = portPos(from);
    const b = portPos(to);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t));
    }
    return pts;
  },
};

function requirePair(def: TrackTileDef, from: Direction, to: Direction): void {
  if (!def.basePorts.includes(from) || !def.basePorts.includes(to)) {
    throw new Error(`Tile ${def.kind} has no port pair ${from}->${to}`);
  }
  if (from === to) throw new Error(`from === to (${from})`);
}

export const ALL_TILES: readonly TrackTileDef[] = [
  STRAIGHT_NS, CURVE_NE, TEE_NES, CROSS_NESW, RAMP_NS, RAMP_NS_TALL,
  ELEVATED_STRAIGHT_NS, ELEVATED_CURVE_NE, STATION_N, UNDER_PASS_NESW,
];

// --- Placed tile + helpers ----------------------------------------------

export interface PlacedTile {
  gridX: number;
  gridZ: number;
  def: TrackTileDef;
  rotation: Rotation;
  /** Optional entry→exit routing for 3+-port tiles. The walker uses this
   *  to decide which exit a train takes when it enters via a given port.
   *  Absent for 2-port tiles (only one possible exit). */
  routing?: Map<Direction, Direction>;
  /** Vertical lift in RAMP_HEIGHT units added to every Y in the tile's
   *  samplePath output. Used to stack ELEVATED tiles at level 2, 3, etc.
   *  and to chain RAMPs into multi-level climbs:
   *   - level=0: tile sits at its default elevation (ELEVATED at y=H, ramps
   *     climbing 0→H, ground tiles at y=0). Equivalent to undefined.
   *   - level=1: everything shifted up by RAMP_HEIGHT. ELEVATED at 2H,
   *     ramp climbing H→2H.
   *   - level=N: shifted up by N*RAMP_HEIGHT. */
  level?: number;
}

/** A placed tile's actual world-space ports (rotated + translated). */
export function effectivePorts(tile: PlacedTile): readonly Direction[] {
  return tile.def.basePorts.map((p) => rotateDir(p, tile.rotation));
}

/** Sample the centerline of a placed tile in WORLD coordinates between two
 *  effective (rotated) ports. */
export function sampleWorldPath(
  tile: PlacedTile,
  fromEffective: Direction,
  toEffective: Direction,
  samples: number,
): THREE.Vector3[] {
  // Translate effective ports back to base ports by undoing the rotation.
  const fromBase = rotateDir(fromEffective, -tile.rotation);
  const toBase = rotateDir(toEffective, -tile.rotation);
  const local = tile.def.samplePath(fromBase, toBase, samples);
  // Apply rotation then translate to grid cell centre.
  const cellX = tile.gridX * TILE_SIZE;
  const cellZ = tile.gridZ * TILE_SIZE;
  const cos = Math.cos((tile.rotation * Math.PI) / 2);
  const sin = Math.sin((tile.rotation * Math.PI) / 2);
  const yLift = (tile.level ?? 0) * RAMP_HEIGHT;
  return local.map((p) => {
    const x = p.x * cos + p.z * sin;
    const z = -p.x * sin + p.z * cos;
    return new THREE.Vector3(cellX + x, p.y + yLift, cellZ + z);
  });
}
