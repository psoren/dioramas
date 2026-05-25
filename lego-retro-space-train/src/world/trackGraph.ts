import * as THREE from 'three';
import {
  Direction,
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
  /** Centerline curve. Always parameterised from `from` (t=0) to `to` (t=1). */
  curve: THREE.CatmullRomCurve3;
  /** Cached length so we don't recompute every frame. */
  length: number;
  /** In-between tile cells (excludes the endpoint junctions). Edges between
   *  adjacent junctions have an empty list. */
  midCells: ReadonlyArray<readonly [number, number]>;
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
    const node: GraphNode = {
      id: `${kind}-${this.nodeCounter++}`,
      kind,
      pos: new THREE.Vector3(gridX * TILE_SIZE, 0, gridZ * TILE_SIZE),
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
  ): GraphEdge {
    const edge: GraphEdge = {
      id: `e${this.edgeCounter++}`,
      from,
      to,
      curve,
      length: curve.getLength(),
      midCells,
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
      const traced = traceEdgeFromPort(layout, node.gridX, node.gridZ, port, junctionSet);
      visitedPort.add(`${traced.toGx},${traced.toGz}:${traced.toEntry}`);
      const toNode = graph.nodeAt(traced.toGx, traced.toGz);
      if (!toNode) throw new Error(`edge endpoint (${traced.toGx},${traced.toGz}) is not a registered node`);
      const curve = buildEdgeCurve(layout, node, port, toNode, traced.toEntry, traced.midCells);
      graph.addEdge(node, toNode, curve, traced.midCells);
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

/** Build the curve from one junction's centre through the midCells to the
 *  other junction's centre. Junction tiles contribute a half-tile straight
 *  each end; in-between tiles contribute their full centerline sample. */
function buildEdgeCurve(
  layout: TrackLayout,
  from: GraphNode,
  exitPort: Direction,
  to: GraphNode,
  entryPort: Direction,
  midCells: ReadonlyArray<readonly [number, number]>,
): THREE.CatmullRomCurve3 {
  const SAMPLES_PER_TILE = 12;
  const points: THREE.Vector3[] = [];

  // Half-tile from `from` centre out to the cell boundary in exitPort dir.
  const fromCenter = new THREE.Vector3(from.gridX * TILE_SIZE, 0, from.gridZ * TILE_SIZE);
  const [fdx, fdz] = dirVector(exitPort);
  const fromBoundary = new THREE.Vector3(
    fromCenter.x + (fdx * TILE_SIZE) / 2,
    0,
    fromCenter.z + (fdz * TILE_SIZE) / 2,
  );
  points.push(fromCenter.clone());
  points.push(fromBoundary);

  // Walk midCells with directional info reconstructed from the geometry.
  // First entry direction is opposite(exitPort).
  let entry = opposite(exitPort);
  let prevGx = from.gridX + fdx;
  let prevGz = from.gridZ + fdz;
  void prevGx; void prevGz;
  for (let i = 0; i < midCells.length; i++) {
    const [gx, gz] = midCells[i]!;
    const tile = layout.get(gx, gz);
    if (!tile) throw new Error(`midcell (${gx},${gz}) missing`);
    const ports = effectivePorts(tile);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    const seg = sampleWorldPath(tile, entry, exit, SAMPLES_PER_TILE);
    // Skip the first sample of each tile — it duplicates the previous tile's
    // last sample (or the from-boundary for tile 0). Drop the last sample of
    // each tile too so the next tile's first sample isn't duplicated either,
    // EXCEPT for the very last midcell where we want the boundary point.
    for (let k = 1; k < seg.length - 1; k++) points.push(seg[k]!);
    if (i === midCells.length - 1) points.push(seg[seg.length - 1]!);
    entry = opposite(exit);
  }

  // Half-tile from `to` cell boundary in entryPort dir to centre.
  const toCenter = new THREE.Vector3(to.gridX * TILE_SIZE, 0, to.gridZ * TILE_SIZE);
  const [tdx, tdz] = dirVector(entryPort);
  const toBoundary = new THREE.Vector3(
    toCenter.x + (tdx * TILE_SIZE) / 2,
    0,
    toCenter.z + (tdz * TILE_SIZE) / 2,
  );
  // If midCells was empty, fromBoundary == toBoundary (same seam between
  // adjacent junctions); avoid pushing duplicate.
  if (midCells.length === 0) {
    points.push(toCenter);
  } else {
    points.push(toBoundary);
    points.push(toCenter);
  }

  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}
