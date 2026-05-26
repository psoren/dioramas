import * as THREE from 'three';
import {
  Direction,
  RAMP_HEIGHT,
  TILE_SIZE,
  dirVector,
  effectivePorts,
  opposite,
  sampleWorldPath,
} from './trackTile';
import type { PlacedTile } from './trackTile';
import { TrackLayout } from './trackLayout';

// ---------------------------------------------------------------------------
// Track graph: nodes (junctions / stations) connected by edges (track
// segments). Built by walking a tile layout from each junction cell out
// along each port until another junction is hit.
//
// Train routing operates over this graph: at each junction, BFS the graph
// for the next edge whose endpoint is closest to the train's target.
// ---------------------------------------------------------------------------

export type NodeKind = 'junction' | 'station';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  /** World-space position (cell centre). */
  pos: THREE.Vector3;
  /** Grid cell this node sits on. */
  gridX: number;
  gridZ: number;
  /** Edges incident at this node. Order is arbitrary; routing uses all. */
  edges: GraphEdge[];
  /** Display label (used by stations). */
  label?: string;
}

export interface GraphEdge {
  id: string;
  from: GraphNode;
  to: GraphNode;
  /** Single continuous centerline curve, FROM (t=0) → TO (t=1). Includes
   *  the half-tile at each junction (straight for main ports, a smooth
   *  bezier for branch / lone ports — so a TEE renders as one straight
   *  rail through plus one curving turnout, both as parts of edge curves
   *  rather than overlapping per-junction strips). */
  curve: THREE.CatmullRomCurve3;
  /** Cached length so we don't recompute every frame. */
  length: number;
  /** In-between tile cells (excludes the endpoint junctions). Edges between
   *  adjacent junctions have an empty list. */
  midCells: ReadonlyArray<readonly [number, number]>;
  /** Effective ports used at each end (out of the from junction, into the
   *  to junction). */
  fromExitPort: Direction;
  toEntryPort: Direction;
}

export class TrackGraph {
  readonly layout: TrackLayout;
  readonly nodes: GraphNode[] = [];
  readonly edges: GraphEdge[] = [];
  private nodeCounter = 0;
  private edgeCounter = 0;

  constructor(layout: TrackLayout) {
    this.layout = layout;
  }

  addNode(kind: NodeKind, gridX: number, gridZ: number, label?: string): GraphNode {
    // Determine cell-centre Y from the underlying tile. Stations placed on
    // elevated tiles sit at RAMP_HEIGHT; ramp-centres are midway. Anything
    // else (flat tiles, no tile yet) is at Y=0.
    const tile = this.layout.get(gridX, gridZ);
    let y = 0;
    if (tile) {
      if (tile.def.kind === 'elevated-straight-ns') y = RAMP_HEIGHT;
      else if (tile.def.kind === 'ramp-ns') y = RAMP_HEIGHT / 2;
    }
    const node: GraphNode = {
      id: `${kind}-${this.nodeCounter++}`,
      kind,
      pos: new THREE.Vector3(gridX * TILE_SIZE, y, gridZ * TILE_SIZE),
      gridX,
      gridZ,
      edges: [],
      label,
    };
    this.nodes.push(node);
    return node;
  }

  addEdge(
    from: GraphNode,
    to: GraphNode,
    curve: THREE.CatmullRomCurve3,
    midCells: ReadonlyArray<readonly [number, number]>,
    fromExitPort: Direction,
    toEntryPort: Direction,
  ): GraphEdge {
    const edge: GraphEdge = {
      id: `e${this.edgeCounter++}`,
      from,
      to,
      curve,
      length: curve.getLength(),
      midCells,
      fromExitPort,
      toEntryPort,
    };
    from.edges.push(edge);
    to.edges.push(edge);
    this.edges.push(edge);
    return edge;
  }

  /** BFS by number of edges. Returns the edge sequence from start to
   *  target, or null if unreachable. Edge direction is preserved in the
   *  result — caller can check `edge.from === current` to know whether to
   *  traverse forward (t: 0→1) or backward (t: 1→0). */
  shortestPath(start: GraphNode, target: GraphNode): GraphEdge[] | null {
    if (start === target) return [];
    const parent = new Map<GraphNode, { node: GraphNode; edge: GraphEdge }>();
    const queue: GraphNode[] = [start];
    parent.set(start, { node: start, edge: null as never });
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === target) break;
      for (const edge of cur.edges) {
        const next = edge.from === cur ? edge.to : edge.from;
        if (parent.has(next)) continue;
        parent.set(next, { node: cur, edge });
        queue.push(next);
      }
    }
    if (!parent.has(target)) return null;
    const path: GraphEdge[] = [];
    let cur: GraphNode = target;
    while (cur !== start) {
      const p = parent.get(cur)!;
      path.push(p.edge);
      cur = p.node;
    }
    path.reverse();
    return path;
  }

  /** Find a node by its grid cell, or null if no node sits there. */
  nodeAt(gridX: number, gridZ: number): GraphNode | null {
    for (const node of this.nodes) {
      if (node.gridX === gridX && node.gridZ === gridZ) return node;
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// Building a graph from a tile layout
// ---------------------------------------------------------------------------

/**
 * Extract a graph from a placed-tile layout. `junctionCells` is the set of
 * cells that should become nodes — typically all 3+-port tiles (TEEs, etc.)
 * plus any station cells. For each port of each junction, the builder walks
 * outward along 2-port tiles until it reaches another junction; the walk
 * becomes one edge.
 *
 * Throws if a walk hits a dead end or encounters a 3+-port tile that wasn't
 * declared as a junction.
 */
export function buildGraphFromLayout(
  layout: TrackLayout,
  junctionCells: ReadonlyArray<{ gx: number; gz: number; kind: NodeKind; label?: string }>,
): TrackGraph {
  const graph = new TrackGraph(layout);
  const junctionSet = new Set<string>();
  for (const j of junctionCells) {
    junctionSet.add(`${j.gx},${j.gz}`);
    graph.addNode(j.kind, j.gx, j.gz, j.label);
  }
  // Avoid producing each edge twice (once from each endpoint).
  const visitedPort = new Set<string>(); // "gx,gz:dir"
  for (const node of graph.nodes) {
    const tile = layout.get(node.gridX, node.gridZ);
    if (!tile) throw new Error(`junction cell (${node.gridX},${node.gridZ}) has no tile`);
    const ports = effectivePorts(tile);
    for (const port of ports) {
      const key = `${node.gridX},${node.gridZ}:${port}`;
      if (visitedPort.has(key)) continue;
      visitedPort.add(key);
      // Dead-end check: if the cell beyond this port has no tile, this port
      // doesn't lead to anything (e.g. a station at the end of a spur). Skip
      // — the port is a buffer/terminator. The node ends up with one fewer
      // incident edge.
      const [pdx, pdz] = dirVector(port);
      if (!layout.get(node.gridX + pdx, node.gridZ + pdz)) continue;
      const traced = traceEdgeFromPort(layout, node.gridX, node.gridZ, port, junctionSet);
      visitedPort.add(`${traced.toGx},${traced.toGz}:${traced.toEntry}`);
      const toNode = graph.nodeAt(traced.toGx, traced.toGz);
      if (!toNode) throw new Error(`edge endpoint (${traced.toGx},${traced.toGz}) is not a registered node`);
      const curve = buildEdgeCurve(layout, node, port, toNode, traced.toEntry, traced.midCells);
      graph.addEdge(node, toNode, curve, traced.midCells, port, traced.toEntry);
    }
  }
  return graph;
}

/** Walk outward from a junction along the given exit port. Returns the cells
 *  passed through and the landing junction. */
function traceEdgeFromPort(
  layout: TrackLayout,
  fromGx: number,
  fromGz: number,
  exitPort: Direction,
  junctionSet: ReadonlySet<string>,
): {
  midCells: Array<readonly [number, number]>;
  toGx: number;
  toGz: number;
  toEntry: Direction;
} {
  const [dx0, dz0] = dirVector(exitPort);
  let cx = fromGx + dx0;
  let cz = fromGz + dz0;
  let entry = opposite(exitPort);
  const mid: Array<readonly [number, number]> = [];
  for (let safety = 0; safety < 512; safety++) {
    const key = `${cx},${cz}`;
    if (junctionSet.has(key)) return { midCells: mid, toGx: cx, toGz: cz, toEntry: entry };
    const tile = layout.get(cx, cz);
    if (!tile) throw new Error(`traceEdge hit dead end at (${cx},${cz})`);
    const ports = effectivePorts(tile);
    if (ports.length !== 2) {
      throw new Error(`traceEdge hit a ${ports.length}-port tile at (${cx},${cz}) that isn't a declared junction`);
    }
    if (!ports.includes(entry)) {
      throw new Error(`bad seam at (${cx},${cz}): entered ${entry} but ports are ${ports.join(',')}`);
    }
    mid.push([cx, cz]);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    const [dx, dz] = dirVector(exit);
    cx += dx;
    cz += dz;
    entry = opposite(exit);
  }
  throw new Error('traceEdge did not terminate in 512 steps');
}

/** Build a single continuous curve from one junction's centre through
 *  all mid cells to the other junction's centre. Junction halves are
 *  straight when the port has its opposite in the tile's port set (a
 *  "main" port — TEE main pair, CROSS, station-on-straight). For a "lone"
 *  port (no opposite in the set — TEE branch), the half-tile is a smooth
 *  cubic bezier tangent to the main axis at the centre and tangent to
 *  the port direction at the boundary. This makes a TEE render as a
 *  realistic turnout (main straight + one curving diverging rail). */
function buildEdgeCurve(
  layout: TrackLayout,
  from: GraphNode,
  exitPort: Direction,
  to: GraphNode,
  entryPort: Direction,
  midCells: ReadonlyArray<readonly [number, number]>,
): THREE.CatmullRomCurve3 {
  const SAMPLES_PER_TILE = 20;
  const points: THREE.Vector3[] = [];

  const fromTile = layout.get(from.gridX, from.gridZ);
  if (!fromTile) throw new Error(`from-junction (${from.gridX},${from.gridZ}) missing tile`);
  const toTile = layout.get(to.gridX, to.gridZ);
  if (!toTile) throw new Error(`to-junction (${to.gridX},${to.gridZ}) missing tile`);

  // For each junction half-tile, compute the "first step direction" — the
  // direction the rail continues after passing the cell boundary. Used as
  // the tangent at cell centre for the lone-port (TEE branch) bezier so the
  // rail visibly peels off the main toward where the spur extends, rather
  // than dropping straight out perpendicular like a T.
  const fromFirstStep = firstStepDirection(layout, exitPort, midCells, /*reversed=*/ false);
  const toFirstStep = firstStepDirection(layout, entryPort, midCells, /*reversed=*/ true);

  // From-junction half-tile (centre → boundary).
  appendJunctionHalf(points, fromTile, from, exitPort, fromFirstStep);

  // Mid cells.
  let entry = opposite(exitPort);
  for (let i = 0; i < midCells.length; i++) {
    const [gx, gz] = midCells[i]!;
    const tile = layout.get(gx, gz);
    if (!tile) throw new Error(`midcell (${gx},${gz}) missing`);
    const ports = effectivePorts(tile);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    const seg = sampleWorldPath(tile, entry, exit, SAMPLES_PER_TILE);
    for (let k = 1; k < seg.length; k++) points.push(seg[k]!);
    entry = opposite(exit);
  }

  // To-junction half-tile, built centre→boundary then reversed.
  const headLen = points.length;
  appendJunctionHalf(points, toTile, to, entryPort, toFirstStep);
  const tail = points.splice(headLen);
  tail.reverse();
  const prev = points[points.length - 1];
  if (prev && prev.distanceTo(tail[0]!) < 1e-6) tail.shift();
  points.push(...tail);

  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

/** Direction the rail continues after crossing the from-junction's boundary
 *  in the `port` direction. If the first mid-cell turns (e.g. a CURVE),
 *  this returns the curve's exit direction. With no mid-cells, returns the
 *  port direction itself (straight continuation into the next junction).
 *  `reversed=true` walks from the to-junction backward (last mid-cell first). */
function firstStepDirection(
  layout: TrackLayout,
  port: Direction,
  midCells: ReadonlyArray<readonly [number, number]>,
  reversed: boolean,
): Direction {
  if (midCells.length === 0) return port;
  const cell = reversed ? midCells[midCells.length - 1]! : midCells[0]!;
  const tile = layout.get(cell[0], cell[1]);
  if (!tile) return port;
  const ports = effectivePorts(tile);
  const entry = opposite(port);
  if (!ports.includes(entry)) return port;
  return ports[0] === entry ? ports[1]! : ports[0]!;
}

/** Append samples from cell centre out to a port boundary.
 *
 *  - "Main" ports (the port's opposite is also in the tile's port set —
 *    e.g. either of a TEE's through-pair, any CROSS port, a station-on-
 *    straight port) render as a STRAIGHT linear half-tile. The through
 *    rail at a TEE is a single straight line across the cell.
 *
 *  - "Lone" ports (no opposite in the tile's port set — the TEE branch
 *    port) render as a SMOOTH CUBIC BEZIER. Tangent at the cell centre
 *    points along the main axis in the direction of the first step beyond
 *    the boundary (e.g. if the spur arm runs east after a north-exit
 *    branch port, the centre tangent is east). Tangent at the boundary is
 *    the port's perpendicular direction. The result visually peels the
 *    branch off the main at an angle — like a wooden Y-switch — instead
 *    of dropping perpendicular like a T.
 */
function appendJunctionHalf(
  points: THREE.Vector3[],
  tile: PlacedTile,
  node: GraphNode,
  port: Direction,
  firstStepDir: Direction,
): void {
  const cellY = node.pos.y;
  const cellCenter = new THREE.Vector3(node.gridX * TILE_SIZE, cellY, node.gridZ * TILE_SIZE);
  const [dx, dz] = dirVector(port);
  const boundary = new THREE.Vector3(
    cellCenter.x + (dx * TILE_SIZE) / 2,
    cellY,
    cellCenter.z + (dz * TILE_SIZE) / 2,
  );
  const ports = effectivePorts(tile);
  const isLone = !ports.includes(opposite(port));
  if (!isLone) {
    // Straight half-tile: linear from centre to boundary.
    const N = 6;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      points.push(new THREE.Vector3(
        cellCenter.x + (boundary.x - cellCenter.x) * t,
        cellY,
        cellCenter.z + (boundary.z - cellCenter.z) * t,
      ));
    }
    return;
  }
  // Lone (TEE branch) half-tile: smooth cubic bezier.
  const [fdx, fdz] = dirVector(firstStepDir);
  const handle = TILE_SIZE * 0.35;
  const c0 = new THREE.Vector3(
    cellCenter.x + fdx * handle,
    cellY,
    cellCenter.z + fdz * handle,
  );
  const c1 = new THREE.Vector3(
    boundary.x - dx * handle,
    cellY,
    boundary.z - dz * handle,
  );
  const N = 16;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u*u*u*cellCenter.x + 3*u*u*t*c0.x + 3*u*t*t*c1.x + t*t*t*boundary.x;
    const z = u*u*u*cellCenter.z + 3*u*u*t*c0.z + 3*u*t*t*c1.z + t*t*t*boundary.z;
    points.push(new THREE.Vector3(x, cellY, z));
  }
}
