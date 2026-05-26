import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { GraphEdge, GraphNode, TrackGraph } from '../world/trackGraph';

// ---------------------------------------------------------------------------
// GraphTrain — a monorail-style train that walks a TrackGraph by edges.
// State: {currentEdge, t∈[0,1], direction (1 forward, -1 backward), target}.
// On reaching an edge endpoint, picks the next edge via BFS toward target.
// On reaching the target node, swaps to the next target in `targetCycle`.
// ---------------------------------------------------------------------------

export interface GraphTrainOptions {
  graph: TrackGraph;
  /** Cycle of stations to visit. The train arrives at target i, then heads
   *  for target i+1 mod n. Needs at least 1; with 1 the train sits there. */
  targetCycle: GraphNode[];
  /** Starting node. If omitted, uses the first target's neighbor so the
   *  train begins one edge away from target #0. */
  startAt?: GraphNode;
  /** Cruise speed in world-units per second. */
  speed?: number;
  /** Pause duration on arrival at a station, in seconds. */
  dwellTime?: number;
  /** World Y-position offset for the train pivot (raises it above rails). */
  y?: number;
}

const DEFAULT_SPEED = 1.6;       // world units / second
const DEFAULT_DWELL = 1.2;       // seconds
const ACCEL = 1.8;               // units/s²
/** Radians/sec the mesh can rotate. 12 rad/s makes a 90° junction turn
 *  take ~0.13s (smooth but instant-feeling) and a 180° station reversal
 *  take ~0.26s (well inside the dwell window). */
const ROTATION_RATE = 12;

export class GraphTrain implements Entity {
  readonly object3d: THREE.Group;
  private readonly graph: TrackGraph;
  private readonly targetCycle: GraphNode[];
  private targetIdx: number;
  private readonly cruiseSpeed: number;
  private currentSpeed = 0;
  private readonly dwellTime: number;
  private dwellRemaining = 0;
  private readonly y: number;
  // Path state
  private currentEdge: GraphEdge;
  private t: number;         // [0, 1] along curve.
  private direction: 1 | -1; // 1: from→to, -1: to→from.
  /** Eased mesh rotation. Lags `targetRotation` by ROTATION_SMOOTHING so
   *  the visual rotation doesn't snap 180° when the train reverses at a
   *  station — it slowly spins around during the dwell. */
  private meshRotation = 0;
  // Routing happens per-node in pickBestEdge — no cached plan needed.

  constructor(opts: GraphTrainOptions) {
    if (opts.targetCycle.length === 0) throw new Error('GraphTrain needs at least one target');
    this.graph = opts.graph;
    this.targetCycle = opts.targetCycle;
    this.targetIdx = 0;
    this.cruiseSpeed = opts.speed ?? DEFAULT_SPEED;
    this.dwellTime = opts.dwellTime ?? DEFAULT_DWELL;
    this.y = opts.y ?? 0.16;

    // Place the train somewhere sensible:
    //   - If startAt is given, start at that node.
    //   - Otherwise, pick the from-side of the first edge incident at target #0.
    // If the train starts AT its first target, treat it as "just arrived":
    // advance targetIdx to the NEXT target and dwell. Otherwise the train
    // would walk to the first node, see "not at target", route back, and
    // bounce on the spur before crossing the junction.
    const startNode = opts.startAt ?? this.pickInitialNode(this.targetCycle[0]!);
    if (startNode === this.targetCycle[0]! && this.targetCycle.length > 1) {
      this.targetIdx = 1;
      this.dwellRemaining = this.dwellTime;
    }
    const targetNow = this.currentTargetNode();
    const initialPath = this.graph.shortestPath(startNode, targetNow);
    if (initialPath === null || initialPath.length === 0) {
      // Train coincides with current target (single-target cycle, or
      // startNode === targetNow after wrap). Sit on an incident edge.
      const edge = targetNow.edges[0];
      if (!edge) throw new Error(`Target ${targetNow.id} has no edges to sit on`);
      this.currentEdge = edge;
      this.t = edge.from === targetNow ? 0 : 1;
      this.direction = edge.from === targetNow ? 1 : -1;
      this.dwellRemaining = this.dwellTime;
    } else {
      const firstEdge = initialPath[0]!;
      this.currentEdge = firstEdge;
      // Direction: leaving startNode.
      if (firstEdge.from === startNode) {
        this.t = 0;
        this.direction = 1;
      } else {
        this.t = 1;
        this.direction = -1;
      }
    }

    this.object3d = this.build();
    this.refreshPose();
  }

  private pickInitialNode(_target: GraphNode): GraphNode {
    // Prefer the OTHER cycle target if we have one, so the train has somewhere
    // to go from the start.
    if (this.targetCycle.length > 1) {
      const i = (this.targetIdx + 1) % this.targetCycle.length;
      return this.targetCycle[i]!;
    }
    // Fallback: first non-target node.
    const candidate = this.graph.nodes.find((n) => n !== this.targetCycle[0]);
    return candidate ?? this.targetCycle[0]!;
  }

  private currentTargetNode(): GraphNode {
    return this.targetCycle[this.targetIdx]!;
  }

  /** Node we're currently moving toward along currentEdge. */
  private headingNode(): GraphNode {
    return this.direction === 1 ? this.currentEdge.to : this.currentEdge.from;
  }

  private advanceSpeed(dt: number): void {
    const target = this.dwellRemaining > 0 ? 0 : this.cruiseSpeed;
    const delta = target - this.currentSpeed;
    const step = Math.sign(delta) * Math.min(Math.abs(delta), ACCEL * dt);
    this.currentSpeed += step;
  }

  update(dt: number): void {
    if (this.dwellRemaining > 0) {
      this.dwellRemaining = Math.max(0, this.dwellRemaining - dt);
    }
    this.advanceSpeed(dt);
    if (this.currentSpeed <= 0) {
      this.refreshPose(dt);
      return;
    }
    // World-units to advance this frame.
    let remaining = this.currentSpeed * dt;
    // Eat the remaining distance one edge at a time. A long dt could in
    // principle bridge multiple short edges; the loop handles that.
    while (remaining > 1e-6) {
      const remainingOnEdge = this.direction === 1
        ? (1 - this.t) * this.currentEdge.length
        : this.t * this.currentEdge.length;
      if (remaining < remainingOnEdge) {
        // Stay on current edge.
        const deltaT = (remaining / this.currentEdge.length) * this.direction;
        this.t += deltaT;
        remaining = 0;
      } else {
        // Reach end of current edge, advance to next.
        remaining -= remainingOnEdge;
        const arrivedAt = this.headingNode();
        if (!this.advanceAtNode(arrivedAt)) {
          // Nothing further to do (no plan); stop here.
          break;
        }
      }
    }
    this.refreshPose(dt);
  }

  /** Called when the train reaches a node. Updates currentEdge/t/direction
   *  for the NEXT edge. Returns false if the train should stop. */
  /** When multiple edges from a node lead to equally-short paths to the
   *  current target, pick one randomly so the train doesn't always take
   *  the same route. (BFS by edge count gives ties; we break them here.) */
  private pickBestEdge(from: GraphNode, target: GraphNode): GraphEdge | null {
    // Score each outgoing edge by BFS distance from the OTHER endpoint to
    // target. Pick among the minimum scores randomly.
    const scored: Array<{ edge: GraphEdge; dist: number }> = [];
    for (const e of from.edges) {
      const other = e.from === from ? e.to : e.from;
      if (other === target) { scored.push({ edge: e, dist: 0 }); continue; }
      const path = this.graph.shortestPath(other, target);
      if (path === null) continue;
      scored.push({ edge: e, dist: path.length });
    }
    if (scored.length === 0) return null;
    const minDist = Math.min(...scored.map((s) => s.dist));
    const best = scored.filter((s) => s.dist === minDist);
    return best[Math.floor(Math.random() * best.length)]!.edge;
  }

  private advanceAtNode(node: GraphNode): boolean {
    // Did we arrive at the current target?
    if (node === this.currentTargetNode()) {
      this.t = this.direction === 1 ? 1 : 0;
      this.targetIdx = (this.targetIdx + 1) % this.targetCycle.length;
      this.dwellRemaining = this.dwellTime;
      const next = this.pickBestEdge(node, this.currentTargetNode());
      if (next) this.enterEdge(next, node);
      return true;
    }
    // En route to target — pick the best next edge from here (ties broken
    // randomly so different traversals exercise different routes).
    const next = this.pickBestEdge(node, this.currentTargetNode());
    if (!next) return false;
    this.enterEdge(next, node);
    return true;
  }

  /** Set currentEdge + initial t/direction for entering `edge` at `fromNode`. */
  private enterEdge(edge: GraphEdge, fromNode: GraphNode): void {
    this.currentEdge = edge;
    if (edge.from === fromNode) {
      this.t = 0;
      this.direction = 1;
    } else if (edge.to === fromNode) {
      this.t = 1;
      this.direction = -1;
    } else {
      throw new Error(`enterEdge: ${fromNode.id} is not an endpoint of ${edge.id}`);
    }
  }

  private refreshPose(dt: number = 0): void {
    const u = clamp01(this.t);
    const pos = this.currentEdge.curve.getPointAt(u);
    const tan = this.currentEdge.curve.getTangentAt(u);
    // direction = -1 means train faces backward; flip tangent.
    const tx = this.direction === 1 ? tan.x : -tan.x;
    const tz = this.direction === 1 ? tan.z : -tan.z;
    this.object3d.position.set(pos.x, pos.y + this.y, pos.z);
    const targetRot = Math.atan2(tx, tz) - Math.PI / 2;
    // Always ease rotation toward the target. At 12 rad/s, a 90° junction
    // turn completes in ~0.13s — fast enough to read as crisp, but smooth
    // enough that a 90° snap doesn't look like a jump. dt=0 (initial pose)
    // still snaps so the train doesn't spin into place when first spawned.
    if (dt <= 0) {
      this.meshRotation = targetRot;
    } else {
      let delta = targetRot - this.meshRotation;
      while (delta > Math.PI) delta -= 2 * Math.PI;
      while (delta < -Math.PI) delta += 2 * Math.PI;
      const maxStep = ROTATION_RATE * dt;
      if (Math.abs(delta) <= maxStep) this.meshRotation = targetRot;
      else this.meshRotation += Math.sign(delta) * maxStep;
    }
    this.object3d.rotation.y = this.meshRotation;
  }

  /** Inspect helper: current heading-toward target's label. */
  currentTargetLabel(): string {
    return this.currentTargetNode().label ?? this.currentTargetNode().id;
  }

  private build(): THREE.Group {
    // Same proportions as Monorail but built inline to avoid the TrackVehicle
    // base-class assumptions about a single shared curve.
    const g = new THREE.Group();
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), MAT.white);
    front.position.set(0.35, 0.32, 0);
    front.castShadow = true;
    g.add(front);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.65), MAT.white);
    nose.position.set(0.95, 0.27, 0);
    nose.castShadow = true;
    g.add(nose);
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.5), MAT.yellowTrans);
    headlight.position.set(1.1, 0.32, 0);
    g.add(headlight);
    const conn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), MAT.grayDark);
    conn.position.set(-0.3, 0.3, 0);
    g.add(conn);
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.65), MAT.blueTrans);
    rear.position.set(-0.75, 0.32, 0);
    rear.castShadow = true;
    g.add(rear);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.65), MAT.white);
    cap.position.set(-1.15, 0.32, 0);
    cap.castShadow = true;
    g.add(cap);
    const bogieGeo = new THREE.BoxGeometry(0.6, 0.15, 0.4);
    for (const x of [0.4, -0.85]) {
      const b = new THREE.Mesh(bogieGeo, MAT.grayDark);
      b.position.set(x, 0.05, 0);
      g.add(b);
    }
    return g;
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
