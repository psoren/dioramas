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
import { TrackLayout, portY } from './trackLayout';

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
  /** World-space position. Cell centre for normal junctions/stations; main-
   *  port boundary for TEE sub-nodes. */
  pos: THREE.Vector3;
  /** Grid cell this node sits on. */
  gridX: number;
  gridZ: number;
  /** Tile level this node sits at (0 = ground/Y=H elev, 1 = Y=2H elev, …).
   *  Multiple nodes can coexist at the same (gridX, gridZ) at different
   *  levels when stacking decks. */
  level: number;
  /** Edges incident at this node. Order is arbitrary; routing uses all. */
  edges: GraphEdge[];
  /** Display label (used by stations). */
  label?: string;
  /** For TEE sub-nodes only: the main port direction this sub-node sits at.
   *  TEE cells get split into 2 graph nodes (one per main port) so that
   *  branch edges can use a clean in-cell quarter arc (main-port boundary →
   *  lone-port boundary) instead of a centre-to-boundary bezier that bulges
   *  perpendicular to the train's motion. */
  mainSide?: Direction;
}

export interface GraphEdge {
  id: string;
  from: GraphNode;
  to: GraphNode;
  /** Single continuous centerline curve, FROM (t=0) → TO (t=1). Includes
   *  the in-cell path at each junction (straight half-tile for non-TEE
   *  nodes; in-cell quarter arc for TEE sub-nodes exiting via the lone
   *  port; zero-length when a TEE sub-node exits via its own main port,
   *  since the sub-node is already at the boundary). */
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

  addNode(
    kind: NodeKind,
    gridX: number,
    gridZ: number,
    label?: string,
    mainSide?: Direction,
    tile?: PlacedTile,
  ): GraphNode {
    // Determine cell-centre Y from the underlying tile. Caller may pass a
    // specific tile (under-slot tiles, decor tiles aren't reachable via
    // layout.get); otherwise we fall back to the primary at this cell.
    const t = tile ?? this.layout.get(gridX, gridZ);
    let y = 0;
    let level = 0;
    if (t) {
      level = t.level ?? 0;
      const yLift = level * RAMP_HEIGHT;
      if (
        t.def.kind === 'elevated-straight-ns'
        || t.def.kind === 'elevated-curve-ne'
        || t.def.kind === 'elevated-tee-nes'
      ) {
        y = RAMP_HEIGHT + yLift;
      } else if (t.def.kind === 'ramp-ns') {
        y = RAMP_HEIGHT / 2 + yLift;
      } else {
        y = yLift;
      }
    }
    let px = gridX * TILE_SIZE;
    let pz = gridZ * TILE_SIZE;
    if (mainSide) {
      // TEE sub-node: sit at the main-port boundary (cell centre + half-tile
      // offset toward the main port). Lets in-cell branch curves be a clean
      // quarter arc instead of a centre-anchored bezier.
      const [mdx, mdz] = dirVector(mainSide);
      px += (mdx * TILE_SIZE) / 2;
      pz += (mdz * TILE_SIZE) / 2;
    }
    const node: GraphNode = {
      id: `${kind}-${this.nodeCounter++}${mainSide ? `:${mainSide}` : ''}${level > 0 ? `@L${level}` : ''}`,
      kind,
      pos: new THREE.Vector3(px, y, pz),
      gridX,
      gridZ,
      level,
      edges: [],
      label,
      mainSide,
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

  /** Compute an Eulerian-style tour that visits every edge at least
   *  once. Used to drive a train so coverage approaches 100% — instead
   *  of bouncing between a few stations on shortest paths (which leaves
   *  most edges unvisited), the train walks the tour node-by-node and
   *  hits every edge.
   *
   *  Algorithm: standard Chinese-postman heuristic.
   *    1. Find odd-degree nodes. (For Eulerian circuit they all need to
   *       be even-degree.)
   *    2. Greedy-pair them by shortest-path distance and duplicate the
   *       edges on each pairing's path → multigraph where every node
   *       has even degree.
   *    3. Hierholzer's algorithm: walk edges, marking each visit. When
   *       no unvisited edge from current node, pop into the tour.
   *
   *  Returns a list of nodes in visitation order. Consecutive nodes in
   *  the returned list are always directly edge-connected, so passing
   *  it as a train's targetCycle makes the train walk edge-by-edge. */
  eulerianTour(): GraphNode[] {
    if (this.nodes.length === 0) return [];
    // Multigraph adjacency, keyed by unique edge-instance id so
    // duplicate edges are distinguishable for visited-tracking.
    interface MEdge { id: number; to: GraphNode; }
    let nextId = 0;
    const adj = new Map<GraphNode, MEdge[]>();
    for (const n of this.nodes) adj.set(n, []);
    const addBoth = (from: GraphNode, to: GraphNode) => {
      const id = nextId++;
      adj.get(from)!.push({ id, to });
      adj.get(to)!.push({ id, to: from });
    };
    for (const e of this.edges) addBoth(e.from, e.to);
    // Pair odd-degree nodes greedily by hop distance.
    const remaining = new Set(this.nodes.filter((n) => adj.get(n)!.length % 2 === 1));
    while (remaining.size >= 2) {
      const arr = [...remaining];
      const a = arr[0]!;
      let bestB: GraphNode | null = null;
      let bestPath: GraphEdge[] | null = null;
      for (let i = 1; i < arr.length; i++) {
        const path = this.shortestPath(a, arr[i]!);
        if (path && (!bestPath || path.length < bestPath.length)) {
          bestB = arr[i]!;
          bestPath = path;
        }
      }
      if (!bestB || !bestPath) break;
      // Duplicate every edge on the pair's shortest path.
      let cur: GraphNode = a;
      for (const e of bestPath) {
        const next = e.from === cur ? e.to : e.from;
        addBoth(cur, next);
        cur = next;
      }
      remaining.delete(a);
      remaining.delete(bestB);
    }
    // Hierholzer's algorithm starting from any non-isolated node.
    const start = this.nodes.find((n) => adj.get(n)!.length > 0);
    if (!start) return [];
    const visited = new Set<number>();
    const stack: GraphNode[] = [start];
    const tour: GraphNode[] = [];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const out = adj.get(top)!;
      let pick: MEdge | null = null;
      for (const e of out) {
        if (!visited.has(e.id)) { pick = e; break; }
      }
      if (pick) {
        visited.add(pick.id);
        stack.push(pick.to);
      } else {
        tour.push(top);
        stack.pop();
      }
    }
    return tour.reverse();
  }

  /** Find a node by its grid cell. Returns the first node found (any cell
   *  can host multiple sub-nodes for TEEs). Use `subNodesAt` to enumerate. */
  nodeAt(gridX: number, gridZ: number): GraphNode | null {
    for (const node of this.nodes) {
      if (node.gridX === gridX && node.gridZ === gridZ) return node;
    }
    return null;
  }

  /** All nodes at the given grid cell. 0, 1, or 2 per level (for TEEs);
   *  cells stacking multiple decks can have nodes at multiple levels.
   *  Pass `level` to filter to that deck only. */
  subNodesAt(gridX: number, gridZ: number, level?: number): GraphNode[] {
    return this.nodes.filter((n) =>
      n.gridX === gridX
      && n.gridZ === gridZ
      && (level === undefined || n.level === level),
    );
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
export interface BuildGraphOptions {
  /** Pass to layout.getAtVia at every trace step. When true the trace
   *  prefers the PRIMARY tile at ambiguous transitions (multi-Y cells)
   *  — used to build the elevated graph that ramps up through parallel
   *  overpasses. Default behavior (false) stays on the straight-through
   *  layer (ground at Y=0). */
  preferPrimary?: boolean;
}

export function buildGraphFromLayout(
  layout: TrackLayout,
  junctionCells: ReadonlyArray<{ gx: number; gz: number; kind: NodeKind; label?: string; tile?: PlacedTile }>,
  opts?: BuildGraphOptions,
): TrackGraph {
  const graph = new TrackGraph(layout);
  const junctionSet = new Set<string>();

  // Phase 1: create nodes. TEE cells (3 ports with 2 main + 1 lone) get split
  // into TWO sub-nodes at their main-port boundaries; everything else gets
  // one node at the cell centre. Caller may pass an explicit tile reference
  // (under-slot tiles aren't reachable via layout.get); otherwise the primary
  // is used as a fallback.
  for (const j of junctionCells) {
    junctionSet.add(`${j.gx},${j.gz}`);
    const tile = j.tile ?? layout.get(j.gx, j.gz);
    if (!tile) throw new Error(`junction cell (${j.gx},${j.gz}) has no tile`);
    const ports = effectivePorts(tile);
    const mains = mainPortsOf(ports);
    const isTEE = ports.length === 3 && mains.length === 2;
    if (isTEE) {
      const subs: GraphNode[] = [];
      for (const m of mains) {
        subs.push(graph.addNode(j.kind, j.gx, j.gz, j.label, m, tile));
      }
      // Main-through edge inside the TEE cell: straight from one main-port
      // boundary to the other through the cell centre.
      const curve = buildStraightCurve(subs[0]!.pos, subs[1]!.pos);
      graph.addEdge(subs[0]!, subs[1]!, curve, [], mains[1]!, mains[0]!);
    } else {
      graph.addNode(j.kind, j.gx, j.gz, j.label, undefined, tile);
    }
  }

  // Phase 2: cross-cell edges. Iterate junctionCells directly (not just
  // by cell key) so per-level junctions on the same cell are visited
  // independently. visitedPort keys include the level so a Y=H trace
  // and a Y=2H trace from the same cell+port aren't deduped together.
  const visitedPort = new Set<string>();
  for (const j of junctionCells) {
    const gx = j.gx;
    const gz = j.gz;
    const tile = j.tile ?? layout.get(gx, gz);
    if (!tile) continue;
    const level = tile.level ?? 0;
    const ports = effectivePorts(tile);
    for (const port of ports) {
      const key = `${gx},${gz}:${port}:L${level}`;
      if (visitedPort.has(key)) continue;
      visitedPort.add(key);
      // Dead-end check at the port's own Y level — getAt picks the right
      // layer (primary or under) for the trace's starting Y, so stacked
      // cells don't false-positive as dead ends.
      const startY = portY(tile, port);
      const [pdx, pdz] = dirVector(port);
      if (!layout.getAt(gx + pdx, gz + pdz, startY)) continue;
      const traced = traceEdgeFromPort(layout, gx, gz, port, startY, junctionSet, opts);
      if (!traced) continue; // graceful dead end — Pass 4 port off-deck
      // Map exitY → level for the destination cell. Elev tiles use
      // (1+level)*RAMP_HEIGHT, so level = round(exitY/RAMP_HEIGHT) - 1
      // for the elev/upper-deck range; clamp to 0 for ground.
      const toLevel = Math.max(0, Math.round(traced.exitY / RAMP_HEIGHT) - 1);
      visitedPort.add(`${traced.toGx},${traced.toGz}:${traced.toEntry}:L${toLevel}`);

      const fromSubs = subNodesUsingPort(graph, gx, gz, port, level);
      const toSubs = subNodesUsingPort(graph, traced.toGx, traced.toGz, traced.toEntry, toLevel);
      if (fromSubs.length === 0 || toSubs.length === 0) {
        // The destination cell IS a junction but not at this level —
        // skip (this is a multi-layer mismatch, not a bug to crash on).
        continue;
      }
      for (const fromNode of fromSubs) {
        for (const toNode of toSubs) {
          let curve: THREE.CatmullRomCurve3;
          try {
            curve = buildEdgeCurve(
              layout, fromNode, port, toNode, traced.toEntry, traced.midCells, opts,
            );
          } catch {
            // Multi-layer trace can produce edges whose curve-sampling
            // hits a tile mismatch (e.g. a curve in a layer the trace
            // walked but the curve builder can't reach). Skip rather
            // than failing the whole graph build.
            continue;
          }
          graph.addEdge(
            fromNode, toNode, curve, traced.midCells, port, traced.toEntry,
          );
        }
      }
    }
  }
  return graph;
}

/** Which sub-node(s) of cell (gx, gz) use the given port.
 *
 *  - Non-TEE cell (1 node): always [that node].
 *  - TEE cell (2 sub-nodes): if `port` is one sub-node's mainSide, return
 *    only that sub-node. If `port` is the lone port, both sub-nodes can
 *    use it (one branch curve per sub-node passes through the lone-port
 *    boundary), so return both.
 */
function subNodesUsingPort(graph: TrackGraph, gx: number, gz: number, port: Direction, level: number): GraphNode[] {
  // Filter to the right deck first (cells stacking Y=H + Y=2H junctions
  // would otherwise return both and the edge would cross decks wrong).
  const subs = graph.subNodesAt(gx, gz, level);
  if (subs.length <= 1) return subs;
  const owned = subs.filter((s) => s.mainSide === port);
  if (owned.length > 0) return owned;
  // Lone port: any sub-node can reach it via in-cell arc.
  return subs;
}

/** Build a straight CatmullRom curve between two world points. */
function buildStraightCurve(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const points: THREE.Vector3[] = [];
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(new THREE.Vector3().lerpVectors(a, b, t));
  }
  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

/** Sample a contiguous run of ramp cells (same rotation) as ONE cosine
 *  S-curve over the whole run. The XZ values come straight from each
 *  tile's samplePath (which is linear); Y is overridden so the slope is
 *  zero at the run's entry and exit and peaks once in the middle —
 *  matches the previous single-cell cosine ease when L=1, and avoids the
 *  "wave at every seam" artifact when L>1. */
function sampleRampRun(
  layout: TrackLayout,
  midCells: ReadonlyArray<readonly [number, number]>,
  startIdx: number,
  endIdx: number,
  startEntry: Direction,
  startY: number,
  samplesPerTile: number,
): { points: THREE.Vector3[]; exitEntry: Direction; exitY: number } {
  const L = endIdx - startIdx + 1;
  const points: THREE.Vector3[] = [];
  let entry = startEntry;
  // First, determine the run's TOTAL Y change so the S-curve has the
  // right endpoint. Each cell adds ±RAMP_HEIGHT depending on which way
  // the train is going (= portY(tile, exit) - portY(tile, entry)).
  let totalDelta = 0;
  {
    let probeEntry = startEntry;
    for (let k = startIdx; k <= endIdx; k++) {
      const tile = layout.get(midCells[k]![0], midCells[k]![1])!;
      const ports = effectivePorts(tile);
      const exit = ports[0] === probeEntry ? ports[1]! : ports[0]!;
      totalDelta += portY(tile, exit) - portY(tile, probeEntry);
      probeEntry = opposite(exit);
    }
  }
  const endY = startY + totalDelta;
  // Sample each cell, overriding Y with the run-wide S-curve. Run param
  // u ∈ [0, L]; y(u) = startY + (Δ/2) * (1 - cos(π u / L)). Slope is 0 at
  // u=0 and u=L, peak at u=L/2.
  for (let k = startIdx; k <= endIdx; k++) {
    const tile = layout.get(midCells[k]![0], midCells[k]![1])!;
    const ports = effectivePorts(tile);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    const seg = sampleWorldPath(tile, entry, exit, samplesPerTile);
    const cellOffset = k - startIdx;
    const includeFirst = k === startIdx;
    for (let s = includeFirst ? 0 : 1; s < seg.length; s++) {
      const cellT = s / samplesPerTile;
      const u = cellOffset + cellT;
      const eased = startY + (totalDelta / 2) * (1 - Math.cos((Math.PI * u) / L));
      const p = seg[s]!;
      points.push(new THREE.Vector3(p.x, eased, p.z));
    }
    entry = opposite(exit);
  }
  return { points, exitEntry: entry, exitY: endY };
}

/** Among a tile's effective ports, the "main" ports are those whose opposite
 *  is also in the set (paired through-routes). For a TEE this is the
 *  through-pair (e.g. N/S for a TEE_NES). For a CROSS, all four. For a
 *  STRAIGHT both. For a station's single port: empty. */
function mainPortsOf(ports: readonly Direction[]): Direction[] {
  return ports.filter((p) => ports.includes(opposite(p)));
}

/** Walk outward from a junction along the given exit port. The walker is
 *  Y-aware so it can pass UNDER a stacked elevated tile (using the
 *  ground-level under-tile) or OVER (the elevated primary tile) — picks
 *  whichever tile has a port at the current Y. */
function traceEdgeFromPort(
  layout: TrackLayout,
  fromGx: number,
  fromGz: number,
  exitPort: Direction,
  startY: number,
  junctionSet: ReadonlySet<string>,
  opts?: BuildGraphOptions,
): {
  midCells: Array<readonly [number, number]>;
  toGx: number;
  toGz: number;
  toEntry: Direction;
  exitY: number;
} | null {
  const [dx0, dz0] = dirVector(exitPort);
  let cx = fromGx + dx0;
  let cz = fromGz + dz0;
  let entry = opposite(exitPort);
  let currentY = startY;
  const mid: Array<readonly [number, number]> = [];
  for (let safety = 0; safety < 512; safety++) {
    const key = `${cx},${cz}`;
    if (junctionSet.has(key)) return { midCells: mid, toGx: cx, toGz: cz, toEntry: entry, exitY: currentY };
    const tile = layout.getAtVia(cx, cz, currentY, entry, { preferPrimary: opts?.preferPrimary });
    // Graceful dead-end: when a multi-layer trace walks off the deck (e.g.
    // a Pass-4 port enters Pass-1 territory that has no Y=2H content),
    // return null and let the caller skip this edge. Throwing here used
    // to crash the whole graph build for L2 layouts.
    if (!tile) return null;
    const ports = effectivePorts(tile);
    if (ports.length !== 2) {
      // Hit an undeclared multi-port tile — treat as graceful dead end
      // (this happens when Pass 4 places a tee that wasn't picked up as
      // a junction at this Y level for whatever reason).
      return null;
    }
    if (!ports.includes(entry)) {
      // Y mismatch: getAtVia picked a tile but its ports at this Y don't
      // include the entry direction. Graceful dead-end again.
      return null;
    }
    mid.push([cx, cz]);
    const exit = ports[0] === entry ? ports[1]! : ports[0]!;
    currentY = portY(tile, exit);
    const [dx, dz] = dirVector(exit);
    cx += dx;
    cz += dz;
    entry = opposite(exit);
  }
  return null; // 512-step safety bail — graceful instead of throwing
}

/** Build a single continuous curve from one node's position through all
 *  mid cells to the other node's position.
 *
 *  Source / destination in-cell geometry depends on the node kind:
 *
 *  - Non-TEE node (at cell centre): straight half-tile from centre to the
 *    exit-port boundary (existing behaviour).
 *
 *  - TEE sub-node (at main-port boundary): the node already sits at the
 *    cell boundary, so the in-cell portion is determined by which port the
 *    edge uses:
 *      * Exiting via the sub-node's own main port: zero in-cell traversal
 *        (the boundary IS the node).
 *      * Exiting via the lone port: a quarter-arc through the cell from
 *        the sub-node's main-port boundary to the lone-port boundary.
 *        Uses the tile's own samplePath — monotone in both grid axes, no
 *        bulge, no wiggle for either main approach.
 *      * Exiting via the sibling sub-node's main port: only inside-cell
 *        main-through edges hit this path; built separately as a straight
 *        line in buildGraphFromLayout.
 */
function buildEdgeCurve(
  layout: TrackLayout,
  from: GraphNode,
  exitPort: Direction,
  to: GraphNode,
  entryPort: Direction,
  midCells: ReadonlyArray<readonly [number, number]>,
  opts?: BuildGraphOptions,
): THREE.CatmullRomCurve3 {
  const SAMPLES_PER_TILE = 20;
  const points: THREE.Vector3[] = [];

  // Level-aware tile lookup — multi-deck cells stack a Pass-1 primary +
  // a Pass-4 under-slot tile at different levels. Pick the layer that
  // matches the node's level so the curve uses the right Y.
  const tileAtNode = (n: GraphNode): PlacedTile | undefined => {
    const primary = layout.get(n.gridX, n.gridZ);
    if (primary && (primary.level ?? 0) === n.level) return primary;
    const under = layout.getUnder(n.gridX, n.gridZ);
    if (under && (under.level ?? 0) === n.level) return under;
    return primary ?? under;
  };
  const fromTile = tileAtNode(from);
  if (!fromTile) throw new Error(`from-junction (${from.gridX},${from.gridZ}) missing tile`);
  const toTile = tileAtNode(to);
  if (!toTile) throw new Error(`to-junction (${to.gridX},${to.gridZ}) missing tile`);

  appendJunctionHalf(points, fromTile, from, exitPort);

  // Mid cells — Y-aware lookup so a stacked under-pass cell uses the
  // correct tile. getAtVia (with the same preferPrimary as the trace
  // that emitted this edge) picks the matching layer when both
  // primary + under straddle currentY at the entry side. Consecutive
  // ramp cells with matching rotation are collapsed into one "ramp
  // run" and re-sampled with a single cosine S-curve so multi-cell
  // ramps stay wave-free.
  let entry = opposite(exitPort);
  let currentY = portY(fromTile, exitPort);
  let i = 0;
  while (i < midCells.length) {
    const [gx, gz] = midCells[i]!;
    // No more layout.get fallback — that returned the wrong (primary)
    // tile at multi-layer cells and ran us into bogus port pairs like
    // "curve-ne W->N". If getAtVia can't pick a layer, the trace
    // shouldn't have included this midcell.
    const tile = layout.getAtVia(gx, gz, currentY, entry, { preferPrimary: opts?.preferPrimary });
    if (!tile) throw new Error(`midcell (${gx},${gz}) y=${currentY} entry=${entry} no matching layer`);
    if (tile.def.kind === 'ramp-ns') {
      // Find the run end: consecutive ramp cells with the same rotation.
      let runEnd = i;
      while (runEnd + 1 < midCells.length) {
        const nextCell = midCells[runEnd + 1]!;
        const nextTile = layout.get(nextCell[0], nextCell[1]);
        if (!nextTile || nextTile.def.kind !== 'ramp-ns') break;
        if (nextTile.rotation !== tile.rotation) break;
        runEnd++;
      }
      const result = sampleRampRun(
        layout, midCells, i, runEnd, entry, currentY, SAMPLES_PER_TILE,
      );
      for (const p of result.points) points.push(p);
      entry = result.exitEntry;
      currentY = result.exitY;
      i = runEnd + 1;
    } else {
      const ports = effectivePorts(tile);
      const exit = ports[0] === entry ? ports[1]! : ports[0]!;
      const seg = sampleWorldPath(tile, entry, exit, SAMPLES_PER_TILE);
      for (let k = 1; k < seg.length; k++) points.push(seg[k]!);
      currentY = portY(tile, exit);
      entry = opposite(exit);
      i++;
    }
  }

  // To-junction half built node→boundary then reversed.
  const headLen = points.length;
  appendJunctionHalf(points, toTile, to, entryPort);
  const tail = points.splice(headLen);
  tail.reverse();
  const prev = points[points.length - 1];
  if (prev && prev.distanceTo(tail[0]!) < 1e-6) tail.shift();
  points.push(...tail);

  // CatmullRomCurve3 needs ≥ 4 control points to evaluate every segment
  // without reading off the end of the array. When two TEE sub-nodes are
  // directly adjacent and the edge goes main-port-to-main-port, this
  // builder produces only 2 points (one per appendJunctionHalf's mainSide
  // branch). Pad by interpolating between the first and last points up
  // to 4 samples so getPoint() can sample safely.
  if (points.length < 4) {
    const first = points[0]!;
    const last = points[points.length - 1]!;
    const padded: THREE.Vector3[] = [];
    const PAD_N = 4;
    for (let i = 0; i <= PAD_N; i++) {
      const t = i / PAD_N;
      padded.push(new THREE.Vector3().lerpVectors(first, last, t));
    }
    return new THREE.CatmullRomCurve3(padded, false, 'centripetal');
  }

  return new THREE.CatmullRomCurve3(points, false, 'centripetal');
}

/** Append samples from `node`'s position out to `port`'s boundary inside
 *  the same cell. The shape depends on the node kind:
 *
 *  - TEE sub-node exiting its OWN main port: degenerate; node is already
 *    at the port boundary. Just push a single sample.
 *
 *  - TEE sub-node exiting the LONE port: in-cell quarter arc from the
 *    sub-node's main-port boundary to the lone-port boundary, sampled
 *    from the tile's samplePath. Monotone in both axes.
 *
 *  - Non-TEE node: linear half-tile from cell centre to the port boundary.
 *    Used for stations and non-junction-cell stubs.
 */
function appendJunctionHalf(
  points: THREE.Vector3[],
  tile: PlacedTile,
  node: GraphNode,
  port: Direction,
): void {
  const cellY = node.pos.y;
  if (node.mainSide) {
    // TEE sub-node.
    if (node.mainSide === port) {
      // Exiting via own main port: node sits AT the boundary, no traversal.
      points.push(node.pos.clone());
      return;
    }
    // Quarter arc through the cell from main-port boundary to `port`
    // boundary. The tile's samplePath returns world-coord points already.
    const arc = sampleWorldPath(tile, node.mainSide, port, 16);
    for (const p of arc) points.push(p);
    return;
  }
  // Non-TEE node: straight from centre to boundary.
  const cellCenter = new THREE.Vector3(node.gridX * TILE_SIZE, cellY, node.gridZ * TILE_SIZE);
  const [dx, dz] = dirVector(port);
  const boundary = new THREE.Vector3(
    cellCenter.x + (dx * TILE_SIZE) / 2,
    cellY,
    cellCenter.z + (dz * TILE_SIZE) / 2,
  );
  const N = 6;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    points.push(new THREE.Vector3(
      cellCenter.x + (boundary.x - cellCenter.x) * t,
      cellY,
      cellCenter.z + (boundary.z - cellCenter.z) * t,
    ));
  }
}
