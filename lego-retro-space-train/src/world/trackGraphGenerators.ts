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
  extrudeRandomSegment,
  findStraightRuns,
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

/** Branch corner rotations (CURVE_NE) for joining the TEE's branch port
 *  to the parallel run cells. Indexed by run direction. */
function branchCornerRotations(runDir: Direction): { entrySide: Rotation; exitSide: Rotation } {
  // teeEntry is the FIRST TEE the walker hits along the run (smaller index
  // in the run cell list). teeExit is the LAST. The branch travels from
  // entryCorner (perpendicular-outward of teeEntry) along the parallel
  // row to exitCorner (outward of teeExit), then down into teeExit.
  //
  // For run E: cells ordered W→E. teeEntry is WEST TEE, teeExit is EAST.
  //   entryCorner ports needed: {S, E} (S to TEE below, E to next branch cell).
  //   exitCorner  ports needed: {W, S}.
  // Derived per direction; cross-checked against the W path used by the
  // legacy generatePassingSiding template (which uses rot 1 / rot 0 there).
  switch (runDir) {
    case 'E': return { entrySide: 3, exitSide: 2 };
    case 'W': return { entrySide: 1, exitSide: 0 };
    case 'N': return { entrySide: 0, exitSide: 3 };
    case 'S': return { entrySide: 2, exitSide: 1 };
  }
}

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
  // ---------- 1. Random base shape ----------
  // Either a centred rectangle (with optional outward bumps) or a clean
  // parametric figure-8 (two lobes meeting at one CROSS — naturally
  // shaped without the "lollipop" knot the twist op produces on small
  // segments). Sized to fit the 28-unit plate (~11 cells per side).
  const useFigure8 = rng() < 0.35;
  let steps: WalkStep[];
  if (useFigure8) {
    const w1 = 3 + Math.floor(rng() * 2); // 3-4
    const h1 = 2 + Math.floor(rng() * 2); // 2-3
    const w2 = 3 + Math.floor(rng() * 2);
    const h2 = 2 + Math.floor(rng() * 2);
    steps = [
      ['E', w1],
      ['S', h1],
      ['W', w1 + w2],
      ['S', h2],
      ['E', w2],
      ['N', h1 + h2],
    ];
  } else {
    const w = 7 + Math.floor(rng() * 3); // 7-9
    const h = 5 + Math.floor(rng() * 3); // 5-7
    steps = [['E', w], ['S', h], ['W', w], ['N', h]];
    // Outward bumps for organic shape variety.
    const extrusions = Math.floor(rng() * 3); // 0-2
    for (let i = 0; i < extrusions; i++) {
      const next = extrudeRandomSegment(steps, rng, /*minLen*/ 4, /*maxBumpDepth*/ 1);
      if (next) steps = next;
    }
  }
  const origin = centeredOrigin(steps);

  // Expand walk → cell list.
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
  // Identify cells that the walk visits more than once — these become
  // CROSS_NESW tiles after placePolygonLoop. Pre-claim them so decorations
  // (sidings/spurs/stations) don't collide with the auto-placed CROSSes.
  const visitCount = new Map<string, number>();
  for (const [x, z] of cells) {
    const k = `${x},${z}`;
    visitCount.set(k, (visitCount.get(k) || 0) + 1);
  }
  const crossCellKeys = new Set<string>();
  for (const [k, v] of visitCount) if (v >= 2) crossCellKeys.add(k);

  // Bbox check: reject if the walk overruns the plate (±5 cells from
  // origin = 11×11 cells on the 28-unit baseplate). Caller retries.
  for (const [x, z] of cells) {
    if (Math.abs(x) > 5 || Math.abs(z) > 5) return null;
  }

  // ---------- 2. Find runs ----------
  const baseRuns = findStraightRuns(cells, 3);
  // Shuffle so decoration placement is random.
  for (let i = baseRuns.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [baseRuns[i], baseRuns[j]] = [baseRuns[j]!, baseRuns[i]!];
  }

  // ---------- 3. Allocate decorations ----------
  // Pre-claim CROSS cells so stations / spurs / sidings don't land on them
  // (which would shadow the CROSS as a 'station' node and lose the
  // intersection in routing).
  const claimed = new Set<string>(crossCellKeys);
  const overrides = new Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>();
  type ExtraTile = { gx: number; gz: number; def: TrackTileDef; rotation: Rotation };
  const extraTiles: ExtraTile[] = [];
  const nodeCells: Array<{ gx: number; gz: number; kind: NodeKind; label: string }> = [];
  let stationIdx = 0;
  const stationLabel = () => String.fromCharCode(65 + stationIdx++); // A, B, C, ...
  let junctionIdx = 0;
  const junctionLabel = () => `Jct-${++junctionIdx}`;

  // Find a contiguous unclaimed sub-run of length ≥ minLen.
  const pickFreeSubRun = (minLen: number): { dir: Direction; cells: Array<readonly [number, number]> } | null => {
    for (const r of baseRuns) {
      let start = -1;
      let runLen = 0;
      for (let i = 0; i < r.cells.length; i++) {
        const [cx, cz] = r.cells[i]!;
        if (claimed.has(`${cx},${cz}`)) {
          if (runLen >= minLen) {
            return { dir: r.dir, cells: r.cells.slice(start, start + runLen) };
          }
          start = -1;
          runLen = 0;
        } else {
          if (start === -1) start = i;
          runLen++;
        }
      }
      if (runLen >= minLen) {
        return { dir: r.dir, cells: r.cells.slice(start, start + runLen) };
      }
    }
    return null;
  };

  // 3a. Reserve a main-loop bridge first so it always lands. Bridges only
  // need 3 cells (RAMP + ELEVATED + RAMP), while sidings need 4+, so
  // claiming bridge cells first won't starve siding placement.
  {
    const run = pickFreeSubRun(3);
    if (run) placeBridge(run, claimed, overrides);
  }

  // 3b. Passing sidings (1-2). Min run 4 cells = TEE + TEE + 2 margin.
  const nSidings = 1 + Math.floor(rng() * 2);
  let placedSidings = 0;
  for (let i = 0; i < nSidings; i++) {
    const run = pickFreeSubRun(4);
    if (!run) break;
    if (tryPlaceSiding(run, rng, walkSet, claimed, overrides, extraTiles, nodeCells, stationLabel, junctionLabel)) {
      placedSidings++;
    }
  }

  // 3c. Dead-end spurs (0-2). Each ends in a station.
  const nSpurs = Math.floor(rng() * 3);
  for (let i = 0; i < nSpurs; i++) {
    const run = pickFreeSubRun(3);
    if (!run) break;
    tryPlaceSpur(run, rng, walkSet, claimed, overrides, extraTiles, nodeCells, stationLabel, junctionLabel);
  }

  // 3d. Try for one more bridge for vertical variety.
  {
    const run = pickFreeSubRun(3);
    if (run) placeBridge(run, claimed, overrides);
  }

  // 3d. Ensure ≥ 2 stations: add main-loop stations on free runs if needed.
  while (nodeCells.filter((n) => n.kind === 'station').length < 2) {
    const run = pickFreeSubRun(1);
    if (!run) break;
    const cell = run.cells[Math.floor(run.cells.length / 2)]!;
    claimed.add(`${cell[0]},${cell[1]}`);
    nodeCells.push({ gx: cell[0], gz: cell[1], kind: 'station', label: stationLabel() });
  }

  // ---------- 4. Place layout ----------
  const layout = new TrackLayout();
  placePolygonLoop(layout, cells, overrides);
  for (const t of extraTiles) layout.place(t.gx, t.gz, t.def, t.rotation);

  // ---------- 5. CROSS cells become junction nodes ----------
  for (const tile of layout.tiles()) {
    if (tile.def.kind !== 'cross-nesw') continue;
    if (nodeCells.some((n) => n.gx === tile.gridX && n.gz === tile.gridZ)) continue;
    nodeCells.push({ gx: tile.gridX, gz: tile.gridZ, kind: 'junction', label: `X-${junctionIdx++}` });
  }

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
  // Contract: ≥2 stations, ≥1 intersection (TEE or CROSS), ≥1 elevated.
  const crossCount = graph.layout.tiles().filter((t) => t.def.kind === 'cross-nesw').length;
  const elevCount = graph.layout.tiles().filter((t) => t.def.kind === 'elevated-straight-ns' || t.def.kind === 'ramp-ns').length;
  if (stations.length < 2 || (placedSidings === 0 && crossCount === 0) || elevCount === 0) {
    return null;
  }
  return { graph, stations, junctions };
}

// --- Decoration helpers --------------------------------------------------

function tryPlaceSiding(
  run: { dir: Direction; cells: Array<readonly [number, number]> },
  _rng: () => number,
  walkSet: ReadonlySet<string>,
  claimed: Set<string>,
  overrides: Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>,
  extraTiles: Array<{ gx: number; gz: number; def: TrackTileDef; rotation: Rotation }>,
  nodeCells: Array<{ gx: number; gz: number; kind: NodeKind; label: string }>,
  stationLabel: () => string,
  junctionLabel: () => string,
): boolean {
  const dir = run.dir;
  const branchDir = PERP_CCW[dir];
  const [bdx, bdz] = dirVector(branchDir);
  const teeEntry = run.cells[1]!;
  const teeExit = run.cells[run.cells.length - 2]!;
  const interior: Array<readonly [number, number]> = [];
  for (let k = 2; k < run.cells.length - 2; k++) {
    const [cx, cz] = run.cells[k]!;
    interior.push([cx + bdx, cz + bdz]);
  }
  const entryCorner: readonly [number, number] = [teeEntry[0] + bdx, teeEntry[1] + bdz];
  const exitCorner: readonly [number, number] = [teeExit[0] + bdx, teeExit[1] + bdz];
  const branchCells: Array<readonly [number, number]> = [entryCorner, ...interior, exitCorner];
  // Collision + bounds check. Branch cells must not overlap the walk or
  // anything previously claimed, and must stay on the plate (±5 cells).
  for (const [x, z] of branchCells) {
    if (walkSet.has(`${x},${z}`) || claimed.has(`${x},${z}`)) return false;
    if (Math.abs(x) > 5 || Math.abs(z) > 5) return false;
  }
  // TEEs as overrides on the main walk.
  const teeRot = TEE_RUN_ROT[dir];
  const teeRouting = new Map<Direction, Direction>([[opposite(dir), dir]]);
  overrides.set(`${teeEntry[0]},${teeEntry[1]}`, { def: TEE_NES, rotation: teeRot, routing: teeRouting });
  overrides.set(`${teeExit[0]},${teeExit[1]}`,   { def: TEE_NES, rotation: teeRot, routing: teeRouting });
  claimed.add(`${teeEntry[0]},${teeEntry[1]}`);
  claimed.add(`${teeExit[0]},${teeExit[1]}`);
  // Branch corners.
  const cornerRots = branchCornerRotations(dir);
  extraTiles.push({ gx: entryCorner[0], gz: entryCorner[1], def: CURVE_NE, rotation: cornerRots.entrySide });
  extraTiles.push({ gx: exitCorner[0],  gz: exitCorner[1],  def: CURVE_NE, rotation: cornerRots.exitSide });
  claimed.add(`${entryCorner[0]},${entryCorner[1]}`);
  claimed.add(`${exitCorner[0]},${exitCorner[1]}`);
  // Branch interior: elevated when long enough (always — every track
  // should have some vertical variety; bridges on the main loop are
  // the other source).
  const branchAxis = opposite(dir);
  const elevate = interior.length >= 3;
  if (elevate) {
    const up = interior[0]!;
    const dn = interior[interior.length - 1]!;
    extraTiles.push({ gx: up[0], gz: up[1], def: RAMP_NS, rotation: RAMP_UP_ROT[branchAxis] });
    extraTiles.push({ gx: dn[0], gz: dn[1], def: RAMP_NS, rotation: RAMP_DOWN_ROT[branchAxis] });
    for (let k = 1; k < interior.length - 1; k++) {
      const [cx, cz] = interior[k]!;
      extraTiles.push({ gx: cx, gz: cz, def: ELEVATED_STRAIGHT_NS, rotation: ELEVATED_ROT[branchAxis] });
    }
  } else {
    const rot = straightRotForAxis(branchAxis);
    for (const [cx, cz] of interior) {
      extraTiles.push({ gx: cx, gz: cz, def: STRAIGHT_NS, rotation: rot });
    }
  }
  for (const [x, z] of interior) claimed.add(`${x},${z}`);
  // Nodes.
  nodeCells.push({ gx: teeEntry[0], gz: teeEntry[1], kind: 'junction', label: junctionLabel() });
  nodeCells.push({ gx: teeExit[0], gz: teeExit[1], kind: 'junction', label: junctionLabel() });
  if (interior.length > 0) {
    const mid = interior[Math.floor(interior.length / 2)]!;
    nodeCells.push({ gx: mid[0], gz: mid[1], kind: 'station', label: stationLabel() });
  }
  return true;
}

function tryPlaceSpur(
  run: { dir: Direction; cells: Array<readonly [number, number]> },
  rng: () => number,
  walkSet: ReadonlySet<string>,
  claimed: Set<string>,
  overrides: Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>,
  extraTiles: Array<{ gx: number; gz: number; def: TrackTileDef; rotation: Rotation }>,
  nodeCells: Array<{ gx: number; gz: number; kind: NodeKind; label: string }>,
  stationLabel: () => string,
  junctionLabel: () => string,
): boolean {
  const dir = run.dir;
  const branchDir = PERP_CCW[dir];
  const [bdx, bdz] = dirVector(branchDir);
  const teeCell = run.cells[Math.floor(run.cells.length / 2)]!;
  const spurLen = 2 + Math.floor(rng() * 2); // 2-3 cells
  const spurCells: Array<readonly [number, number]> = [];
  for (let k = 1; k <= spurLen; k++) {
    spurCells.push([teeCell[0] + bdx * k, teeCell[1] + bdz * k]);
  }
  for (const [x, z] of spurCells) {
    if (walkSet.has(`${x},${z}`) || claimed.has(`${x},${z}`)) return false;
    if (Math.abs(x) > 5 || Math.abs(z) > 5) return false;
  }
  const teeRot = TEE_RUN_ROT[dir];
  const teeRouting = new Map<Direction, Direction>([[opposite(dir), dir]]);
  overrides.set(`${teeCell[0]},${teeCell[1]}`, { def: TEE_NES, rotation: teeRot, routing: teeRouting });
  claimed.add(`${teeCell[0]},${teeCell[1]}`);
  const spurRot = straightRotForAxis(branchDir);
  for (const [cx, cz] of spurCells) {
    extraTiles.push({ gx: cx, gz: cz, def: STRAIGHT_NS, rotation: spurRot });
    claimed.add(`${cx},${cz}`);
  }
  nodeCells.push({ gx: teeCell[0], gz: teeCell[1], kind: 'junction', label: junctionLabel() });
  const end = spurCells[spurCells.length - 1]!;
  nodeCells.push({ gx: end[0], gz: end[1], kind: 'station', label: stationLabel() });
  return true;
}

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
  claimed.add(`${up[0]},${up[1]}`);
  claimed.add(`${el[0]},${el[1]}`);
  claimed.add(`${dn[0]},${dn[1]}`);
}
