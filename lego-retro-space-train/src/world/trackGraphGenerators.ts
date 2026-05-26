import {
  CURVE_NE,
  Direction,
  ELEVATED_STRAIGHT_NS,
  RAMP_NS,
  Rotation,
  STRAIGHT_NS,
  TEE_NES,
  TrackTileDef,
  dirVector,
  opposite,
} from './trackTile';
import {
  ELEVATED_ROT,
  RAMP_DOWN_ROT,
  RAMP_UP_ROT,
  TrackLayout,
  WalkStep,
  centeredOrigin,
  placePolygonLoop,
} from './trackLayout';
import { GraphNode, NodeKind, TrackGraph, buildGraphFromLayout } from './trackGraph';

// ---------------------------------------------------------------------------
// Passing-siding generator. Builds a centered rectangle main loop with two
// TEE junctions on the south edge and a parallel branch (south of the main
// loop) that connects them. Two stations are added — one on the north edge,
// one mid-branch — so a train can be given a target.
//
//   ┌─────────────────────────────────┐
//   │            Alpha                │   <- top edge, station Alpha
//   │                                 │
//   │                                 │
//   │   T═════════════════════T       │   <- bottom edge w/ 2 TEEs
//        ║                   ║
//        ╚════════ Beta ═════╝        <- branch, station Beta
//
// ---------------------------------------------------------------------------

export interface PassingSidingResult {
  graph: TrackGraph;
  /** All station nodes for the caller's convenience (for HUD / train targeting). */
  stations: GraphNode[];
  /** Junction nodes too. */
  junctions: GraphNode[];
}

export interface PassingSidingOptions {
  /** If true, the parallel branch climbs a ramp at one end, runs elevated
   *  across the middle, and ramps back down at the other end. The two
   *  branch corners stay at ground level so the TEE seams match. Needs
   *  ≥ 3 cells of branch interior (auto-fits with width ≥ 8). */
  elevatedBranch?: boolean;
}

export function generatePassingSiding(
  rng: () => number = Math.random,
  options: PassingSidingOptions = {},
): PassingSidingResult {
  // Rectangle dimensions. Sized to fill most of the 28-unit plate
  // (~11 tiles per side, leaving 1-tile margin). Pulling N/S edge in by 1
  // leaves room below the bottom edge for the parallel branch.
  const w = 8 + Math.floor(rng() * 2); // 8 or 9
  const h = 5 + Math.floor(rng() * 2); // 5 or 6
  const gxL = -Math.floor(w / 2);
  const gxR = gxL + w;
  const gzT = -Math.floor((h + 1) / 2); // shift up by 1 so branch fits inside plate
  const gzB = gzT + h;

  // TEE positions on the south edge (avoid the corners; leave at least one
  // straight cell at each end so the branch corners don't collide with the
  // rectangle's SW/SE corners).
  const teeWestX = gxL + 2;
  const teeEastX = gxR - 2;

  // Build the main rectangle cell list (the polygon walker uses this).
  const cells: Array<readonly [number, number]> = [];
  for (let x = gxL; x <= gxR; x++) cells.push([x, gzT]);             // top edge E
  for (let z = gzT + 1; z <= gzB; z++) cells.push([gxR, z]);          // right edge S
  for (let x = gxR - 1; x >= gxL; x--) cells.push([x, gzB]);          // bottom edge W
  for (let z = gzB - 1; z > gzT; z--) cells.push([gxL, z]);           // left edge N

  // Override the two TEE cells on the bottom edge. Main path along the
  // bottom goes W (entry E, exit W). TEE_NES rotated 3 → ports {E, S, W};
  // routing {E: W} tells buildLoop the spare port S is unused for the
  // main loop walk. The S port is what the branch attaches to.
  const overrides = new Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>();
  overrides.set(`${teeEastX},${gzB}`, {
    def: TEE_NES, rotation: 3,
    routing: new Map<Direction, Direction>([['E', 'W']]),
  });
  overrides.set(`${teeWestX},${gzB}`, {
    def: TEE_NES, rotation: 3,
    routing: new Map<Direction, Direction>([['E', 'W']]),
  });

  const layout = new TrackLayout();
  placePolygonLoop(layout, cells, overrides);

  // Branch tiles, one row south of the main bottom edge.
  const branchZ = gzB + 1;
  // East branch corner: comes from N (south port of east TEE), goes W.
  // CURVE_NE has base ports {N, E}; rotated 1 → {W, N}.
  layout.place(teeEastX, branchZ, CURVE_NE, 1);
  // West branch corner: comes from E, goes N (up to west TEE).
  // CURVE_NE rotated 0 → {N, E}.
  layout.place(teeWestX, branchZ, CURVE_NE, 0);
  // Branch interior: either all-flat straights (E-W direction, rot 1) or
  // an elevated section flanked by ramps. The corners stay at y=0 so the
  // TEE seams match; ramps and elevated sit at RAMP_HEIGHT in the middle.
  const interiorLen = teeEastX - teeWestX - 1; // count of cells between corners
  const useElevated = !!options.elevatedBranch && interiorLen >= 3;
  if (useElevated) {
    // Train direction along the branch is W (entry from E, exit W per cell).
    // Rotations match trackLayout's RAMP_UP_ROT[W]=3 / RAMP_DOWN_ROT[W]=1 /
    // ELEVATED_ROT[W]=1 so the Y profile matches what buildLoop expects.
    const rampUpX = teeEastX - 1;
    const rampDownX = teeWestX + 1;
    layout.place(rampUpX, branchZ, RAMP_NS, 3);
    layout.place(rampDownX, branchZ, RAMP_NS, 1);
    for (let x = rampDownX + 1; x < rampUpX; x++) {
      layout.place(x, branchZ, ELEVATED_STRAIGHT_NS, 1);
    }
  } else {
    for (let x = teeWestX + 1; x < teeEastX; x++) {
      layout.place(x, branchZ, STRAIGHT_NS, 1);
    }
  }

  // Station node positions:
  // - "Alpha" on the north edge, centered.
  // - "Beta" on the branch, centered.
  const alphaX = Math.round((gxL + gxR) / 2);
  const betaX = Math.round((teeWestX + teeEastX) / 2);
  const stationCells: Array<{ gx: number; gz: number; kind: NodeKind; label: string }> = [
    { gx: alphaX, gz: gzT, kind: 'station', label: 'Alpha' },
    { gx: betaX,  gz: branchZ, kind: 'station', label: 'Beta'  },
  ];

  // All cells that should become graph nodes (junctions + stations). The
  // graph builder treats anything in this set as an edge boundary even if
  // the underlying tile is a 2-port straight — that's how stations split
  // an edge into two.
  const nodeCells: Array<{ gx: number; gz: number; kind: NodeKind; label?: string }> = [
    { gx: teeEastX, gz: gzB, kind: 'junction', label: 'East-Jct' },
    { gx: teeWestX, gz: gzB, kind: 'junction', label: 'West-Jct' },
    ...stationCells,
  ];

  const graph = buildGraphFromLayout(layout, nodeCells);

  const stations = graph.nodes.filter((n) => n.kind === 'station');
  const junctions = graph.nodes.filter((n) => n.kind === 'junction');
  return { graph, stations, junctions };
}

// ---------------------------------------------------------------------------
// Random graph track. Each roll:
//   1. Generates an organic base loop via the extruded random shape generator
//      (rectangle + a few outward bumps), centered on the plate.
//   2. Finds straight runs in the placed cell list.
//   3. Picks the longest run and inserts a passing siding (2 TEEs + a
//      parallel branch outside the loop). Stations Alpha (on the longest
//      run NOT used by the siding) and Beta (mid-branch) anchor train
//      routing.
//   4. Picks another long run and inserts an elevated bridge (RAMP +
//      ELEVATED + RAMP).
//   5. If no run long enough for a siding, falls back to the rectangle
//      passing-siding template.
// ---------------------------------------------------------------------------

/** Run-direction → TEE_NES rotation that exposes ports {dir, opposite(dir),
 *  branchPort} where branchPort is perpCCW(dir) (i.e. OUTSIDE the CW walk).
 *  Mapping derived by hand from the {N,E,S} base port layout. */
const TEE_RUN_ROT: Record<Direction, Rotation> = {
  E: 1, // ports {W, N, E} → branch port N
  W: 3, // ports {E, S, W} → branch port S
  N: 2, // ports {S, W, N} → branch port W
  S: 0, // ports {N, E, S} → branch port E
};

/** Inverse perpendicular (outward of a CW walk): perpCCW direction. */
const PERP_CCW: Record<Direction, Direction> = {
  N: 'W', W: 'S', S: 'E', E: 'N',
};

/** Straight tile rotation that exposes ports along a given axis. */
function straightRotForAxis(dir: Direction): Rotation {
  return dir === 'N' || dir === 'S' ? 0 : 1;
}

export interface RandomGraphTrackOptions {
  /** Force fallback to the rectangle template — useful for deterministic tests. */
  forceRectangle?: boolean;
}

export function generateRandomGraphTrack(
  rng: () => number = Math.random,
  options: RandomGraphTrackOptions = {},
): PassingSidingResult {
  if (options.forceRectangle) {
    return generatePassingSiding(rng, { elevatedBranch: true });
  }
  // Retry on contract failure — each attempt has independent rolls, so a
  // different bbox / decoration outcome usually satisfies the contract on
  // the 2nd or 3rd try. After MAX_RETRIES we accept the template fallback.
  const MAX_RETRIES = 6;
  for (let i = 0; i < MAX_RETRIES; i++) {
    const result = tryGenerateRandomGraphTrack(rng);
    if (result) return result;
  }
  return generatePassingSiding(rng, { elevatedBranch: true });
}

function tryGenerateRandomGraphTrack(rng: () => number): PassingSidingResult | null {
  // ---------- Design ----------
  // Clean rectangle main loop. One side gets a Y-spur (TEE on the main +
  // a short branch peeling off, ending in a station with a buffer
  // stop — looks like a real LEGO Y-switch). The OPPOSITE side gets an
  // elevated bridge. Three stations: one at the spur end, one each on
  // the two perpendicular sides of the main loop.
  // Variety per roll: 4 spur-side choices × 4 dimension combos = 16
  // distinct layouts. (Passing-siding template was tried but its two
  // TEEs + parallel branch read as a "tongue" hanging off the loop
  // rather than a real switch.)
  // ---------- 1. Rectangle ----------
  // 7-8 wide × 6-7 tall fits inside ±5 cells from origin even with a
  // branch column 1 cell off each side (Math.round centring of odd
  // widths leans by 0.5 cell — odd values 9+ exceed the bound).
  const w = 7 + Math.floor(rng() * 2); // 7-8
  const h = 6 + Math.floor(rng() * 2); // 6-7
  const steps: WalkStep[] = [['E', w], ['S', h], ['W', w], ['N', h]];
  const origin = centeredOrigin(steps);

  // Expand walk → cell list (clockwise from top-left corner).
  const cells: Array<readonly [number, number]> = [[origin[0], origin[1]]];
  {
    let cx = origin[0], cz = origin[1];
    for (const [dir, count] of steps) {
      const [vx, vz] = dirVector(dir);
      for (let i = 0; i < count; i++) {
        cx += vx;
        cz += vz;
        cells.push([cx, cz]);
      }
    }
    cells.pop();
  }
  const walkSet = new Set(cells.map(([x, z]) => `${x},${z}`));

  // Bbox check: rectangle must fit on the plate (±5 cells from origin).
  for (const [x, z] of cells) {
    if (Math.abs(x) > 5 || Math.abs(z) > 5) return null;
  }

  // ---------- 2. Identify the 4 sides' interior cells ----------
  // Each side's cells are pass-through (straight) — the corners are NOT
  // included (they're curves). Sidings/bridges go ON these straight runs.
  // Cell layout from the walk (starting at top-left corner index 0):
  //   indices [0]          : NW corner
  //   indices [1 .. w-1]   : top edge, w-1 straight cells (going E)
  //   indices [w]          : NE corner
  //   indices [w+1 .. w+h-1]: right edge, h-1 straight cells (going S)
  //   indices [w+h]        : SE corner
  //   indices [w+h+1 .. 2w+h-1]: bottom edge, w-1 straight cells (going W)
  //   indices [2w+h]       : SW corner
  //   indices [2w+h+1 .. 2w+2h-1]: left edge, h-1 straight cells (going N)
  type SideKey = 'top' | 'right' | 'bottom' | 'left';
  const sides: Record<SideKey, { dir: Direction; cells: ReadonlyArray<readonly [number, number]> }> = {
    top:    { dir: 'E', cells: cells.slice(1, w) },
    right:  { dir: 'S', cells: cells.slice(w + 1, w + h) },
    bottom: { dir: 'W', cells: cells.slice(w + h + 1, 2 * w + h) },
    left:   { dir: 'N', cells: cells.slice(2 * w + h + 1, 2 * w + 2 * h) },
  };

  // ---------- 3. Pick spur + bridge sides ----------
  const allSides: SideKey[] = ['top', 'right', 'bottom', 'left'];
  for (let i = allSides.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [allSides[i], allSides[j]] = [allSides[j]!, allSides[i]!];
  }
  const spurSide = allSides[0]!;
  const oppositeOf: Record<SideKey, SideKey> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };
  const bridgeSide = oppositeOf[spurSide];
  const perpendicularSides = allSides.filter((s) => s !== spurSide && s !== bridgeSide);

  // ---------- 4. Place decorations ----------
  const claimed = new Set<string>();
  const overrides = new Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>();
  type ExtraTile = { gx: number; gz: number; def: TrackTileDef; rotation: Rotation };
  const extraTiles: ExtraTile[] = [];
  const nodeCells: Array<{ gx: number; gz: number; kind: NodeKind; label: string }> = [];
  let stationIdx = 0;
  const stationLabel = () => String.fromCharCode(65 + stationIdx++);

  // 4a. Y-spur on the chosen side: TEE at the side's midpoint, branch
  // extending outward, dead-end station at the end.
  const spurRun = sides[spurSide];
  if (spurRun.cells.length < 1) return null;
  const teeCell = spurRun.cells[Math.floor(spurRun.cells.length / 2)]!;
  const runDir = spurRun.dir;
  const branchDir = PERP_CCW[runDir];
  const [bdx, bdz] = dirVector(branchDir);
  const spurLen = 2 + Math.floor(rng() * 2); // 2-3 cells
  const spurCells: Array<readonly [number, number]> = [];
  for (let k = 1; k <= spurLen; k++) {
    spurCells.push([teeCell[0] + bdx * k, teeCell[1] + bdz * k]);
  }
  // All spur cells must fit on the plate and not collide with the walk.
  for (const [x, z] of spurCells) {
    if (walkSet.has(`${x},${z}`)) return null;
    if (Math.abs(x) > 5 || Math.abs(z) > 5) return null;
  }
  const teeRot = TEE_RUN_ROT[runDir];
  const teeRouting = new Map<Direction, Direction>([[opposite(runDir), runDir]]);
  overrides.set(`${teeCell[0]},${teeCell[1]}`, { def: TEE_NES, rotation: teeRot, routing: teeRouting });
  claimed.add(`${teeCell[0]},${teeCell[1]}`);
  const spurStraightRot = straightRotForAxis(branchDir);
  for (const [cx, cz] of spurCells) {
    extraTiles.push({ gx: cx, gz: cz, def: STRAIGHT_NS, rotation: spurStraightRot });
    claimed.add(`${cx},${cz}`);
  }
  nodeCells.push({ gx: teeCell[0], gz: teeCell[1], kind: 'junction', label: 'Jct' });
  const spurEnd = spurCells[spurCells.length - 1]!;
  nodeCells.push({ gx: spurEnd[0], gz: spurEnd[1], kind: 'station', label: stationLabel() });

  // 4b. Bridge on the opposite side.
  const bridgeRun = sides[bridgeSide];
  if (bridgeRun.cells.length < 3) return null;
  placeBridge({ dir: bridgeRun.dir, cells: [...bridgeRun.cells] }, claimed, overrides);

  // 4c. Stations on the two perpendicular sides — one each, at the
  // midpoint of each side's straight run.
  for (const side of perpendicularSides) {
    const run = sides[side];
    if (run.cells.length === 0) continue;
    const mid = run.cells[Math.floor(run.cells.length / 2)]!;
    if (claimed.has(`${mid[0]},${mid[1]}`)) continue;
    claimed.add(`${mid[0]},${mid[1]}`);
    nodeCells.push({ gx: mid[0], gz: mid[1], kind: 'station', label: stationLabel() });
  }

  // ---------- 4. Place layout ----------
  const layout = new TrackLayout();
  placePolygonLoop(layout, cells, overrides);
  for (const t of extraTiles) layout.place(t.gx, t.gz, t.def, t.rotation);

  // No CROSS_NESW cells in this generator (no twists, no self-crossings),
  // so we skip the CROSS scan that earlier templates needed.

  // Deduplicate by cell (stations should never coincide with TEEs/CROSSes,
  // but a paranoid filter keeps the builder happy).
  const seenKey = new Set<string>();
  const filtered = nodeCells.filter((n) => {
    const k = `${n.gx},${n.gz}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });

  // ---------- 6. Build graph ----------
  let graph: TrackGraph;
  try {
    graph = buildGraphFromLayout(layout, filtered);
  } catch (err) {
    void err;
    return null;
  }
  const stations = graph.nodes.filter((n) => n.kind === 'station');
  const junctions = graph.nodes.filter((n) => n.kind === 'junction');
  // Contract: ≥3 stations, ≥1 intersection, ≥1 elevated section.
  const elevCount = graph.layout.tiles().filter((t) => t.def.kind === 'elevated-straight-ns' || t.def.kind === 'ramp-ns').length;
  if (stations.length < 3 || junctions.length < 1 || elevCount === 0) {
    return null;
  }
  return { graph, stations, junctions };
}

// --- Decoration helpers --------------------------------------------------

function placeBridge(
  run: { dir: Direction; cells: Array<readonly [number, number]> },
  claimed: Set<string>,
  overrides: Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>,
): void {
  const start = Math.floor((run.cells.length - 3) / 2);
  const up = run.cells[start]!;
  const el = run.cells[start + 1]!;
  const dn = run.cells[start + 2]!;
  overrides.set(`${up[0]},${up[1]}`, { def: RAMP_NS, rotation: RAMP_UP_ROT[run.dir] });
  overrides.set(`${el[0]},${el[1]}`, { def: ELEVATED_STRAIGHT_NS, rotation: ELEVATED_ROT[run.dir] });
  overrides.set(`${dn[0]},${dn[1]}`, { def: RAMP_NS, rotation: RAMP_DOWN_ROT[run.dir] });
  // Claim the 3 bridge cells plus a 1-cell margin on each side so the
  // next decoration (siding TEE, spur) can't land on the ramp seam — a
  // TEE on a ramp tile would cause a Y discontinuity at the junction.
  claimed.add(`${up[0]},${up[1]}`);
  claimed.add(`${el[0]},${el[1]}`);
  claimed.add(`${dn[0]},${dn[1]}`);
  const dirVec = run.dir === 'E' ? [1, 0] : run.dir === 'W' ? [-1, 0] : run.dir === 'N' ? [0, -1] : [0, 1];
  claimed.add(`${up[0] - dirVec[0]!},${up[1] - dirVec[1]!}`);
  claimed.add(`${dn[0] + dirVec[0]!},${dn[1] + dirVec[1]!}`);
}
