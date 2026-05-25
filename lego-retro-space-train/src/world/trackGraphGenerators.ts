import {
  CURVE_NE,
  Direction,
  Rotation,
  STRAIGHT_NS,
  TEE_NES,
  TrackTileDef,
} from './trackTile';
import { TrackLayout, placePolygonLoop } from './trackLayout';
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

export function generatePassingSiding(
  rng: () => number = Math.random,
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
  // In-between straights along the branch, E-W direction.
  for (let x = teeWestX + 1; x < teeEastX; x++) {
    layout.place(x, branchZ, STRAIGHT_NS, 1); // rot 1 → E/W ports
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
