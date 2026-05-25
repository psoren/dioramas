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

  // From-junction half-tile (centre → boundary).
  const fromTile = layout.get(from.gridX, from.gridZ);
  if (!fromTile) throw new Error(`from-junction (${from.gridX},${from.gridZ}) missing tile`);
  appendJunctionHalf(points, fromTile, from, exitPort, to, /*startAtCenter=*/ true);

  // Mid cells.
  let entry = opposite(exitPort);
  for (let i = 0; i < midCells.length; i++) {
    const [gx, gz] = midCells[i]!;
    const tile = layout.get(gx, gz);
    if (!tile) throw new Error(`midcell (${gx},${gz}) missing`);
    const ports = effectivePorts(tile);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    const seg = sampleWorldPath(tile, entry, exit, SAMPLES_PER_TILE);
    // Skip the first sample of each midcell — it duplicates the previous
    // segment's last sample (either the from-half's boundary or the
    // previous midcell's last sample).
    for (let k = 1; k < seg.length; k++) points.push(seg[k]!);
    entry = opposite(exit);
  }

  // To-junction half-tile (boundary → centre). Built centre-to-boundary then
  // reversed, so the bezier tangent calculation uses the same orientation.
  const toTile = layout.get(to.gridX, to.gridZ);
  if (!toTile) throw new Error(`to-junction (${to.gridX},${to.gridZ}) missing tile`);
  const headLen = points.length;
  appendJunctionHalf(points, toTile, to, entryPort, from, /*startAtCenter=*/ true);
  // Reverse only the just-appended chunk so it runs boundary→centre. Drop
  // its first point (boundary) since it duplicates the last mid-cell sample
  // (or the from-half boundary if there are no mid cells).
  const tail = points.splice(headLen);
  tail.reverse();
  // tail now starts at boundary, ends at centre. Drop boundary if it
  // duplicates the previous point.
  const prev = points[points.length - 1];
  if (prev && prev.distanceTo(tail[0]!) < 1e-6) tail.shift();
  points.push(...tail);

  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

/** Append samples from cell centre out to a port boundary. Straight for
 *  main ports, cubic bezier for lone ports. */
function appendJunctionHalf(
  points: THREE.Vector3[],
  tile: { gridX: number; gridZ: number; def: { kind: string }; rotation: number } & { def: any },
  node: GraphNode,
  port: Direction,
  otherNode: GraphNode,
  startAtCenter: boolean,
): void {
  void startAtCenter;
  const cellY = node.pos.y;
  const cellCenter = new THREE.Vector3(tile.gridX * TILE_SIZE, cellY, tile.gridZ * TILE_SIZE);
  const [dx, dz] = dirVector(port);
  const boundary = new THREE.Vector3(
    cellCenter.x + (dx * TILE_SIZE) / 2,
    cellY,
    cellCenter.z + (dz * TILE_SIZE) / 2,
  );
  const ports = effectivePorts(tile as never);
  const isLone = !ports.includes(opposite(port));
  const N = isLone ? 20 : 6;
  if (!isLone) {
    // Straight: linear interpolation, centre → boundary.
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
  // Bezier: tangent at centre points toward the other junction (so two
  // joined edges through the same junction form one continuous main rail),
  // tangent at boundary points out along the port direction.
  const toward = new THREE.Vector3().subVectors(otherNode.pos, node.pos);
  toward.y = 0;
  const tlen = toward.length() || 1;
  toward.divideScalar(tlen);
  const t1 = TILE_SIZE * 0.32;
  const c1 = new THREE.Vector3(
    cellCenter.x + toward.x * t1,
    cellY,
    cellCenter.z + toward.z * t1,
  );
  const t2 = TILE_SIZE * 0.32;
  const c2 = new THREE.Vector3(
    boundary.x - dx * t2,
    cellY,
    boundary.z - dz * t2,
  );
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const u = 1 - t;
    const x = u*u*u*cellCenter.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*boundary.x;
    const z = u*u*u*cellCenter.z + 3*u*u*t*c1.z + 3*u*t*t*c2.z + t*t*t*boundary.z;
    points.push(new THREE.Vector3(x, cellY, z));
  }
}
