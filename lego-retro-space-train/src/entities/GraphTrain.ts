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
  /** Total cars including the locomotive. Default 4 (locomotive + 3
   *  passenger cars). */
  cars?: number;
}

const DEFAULT_SPEED = 1.6;       // world units / second
const DEFAULT_DWELL = 1.2;       // seconds
const ACCEL = 1.8;               // units/s²
/** Radians/sec the mesh can rotate. 12 rad/s makes a 90° junction turn
 *  take ~0.13s (smooth but instant-feeling) and a 180° station reversal
 *  take ~0.26s (well inside the dwell window). */
const ROTATION_RATE = 12;

/** Car articulation. Each car is placed independently along the curve
 *  trail at this arc-length distance behind the next car forward. */
const CAR_SPACING = 1.4;

interface TrailSample {
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  dist: number;
}

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
  /** Eased orientation quaternion. Slerps toward a target each frame so
   *  90° junction turns and 180° station reversals smooth out instead of
   *  snapping. Quaternion (vs Euler) so we can include curve pitch on
   *  ramps without YXZ-order gymnastics. */
  private meshRotation = new THREE.Quaternion();
  /** Cars: index 0 = locomotive, 1..N = trailing passenger cars. Each
   *  positions itself independently along the trail so the consist
   *  articulates through curves and ramps. */
  private cars: THREE.Group[] = [];
  /** Recorded head positions + orientations + cumulative arc length, used
   *  to look up each trailing car's pose. Pruned once entries are beyond
   *  the tail of the consist. */
  private trail: TrailSample[] = [];
  private trailDist = 0;
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

    const numCars = opts.cars ?? 4;
    this.object3d = this.build(numCars);
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
    // target. Pick uniformly among min-distance edges.
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
    // direction = -1 means train faces backward; flip all tangent axes
    // (including y) so a train rolling DOWN a ramp pitches nose-down too.
    const fx = this.direction === 1 ? tan.x : -tan.x;
    const fy = this.direction === 1 ? tan.y : -tan.y;
    const fz = this.direction === 1 ? tan.z : -tan.z;
    const headPos = new THREE.Vector3(pos.x, pos.y + this.y, pos.z);
    const targetQ = orientationForward(fx, fy, fz);
    // Slerp toward target at ROTATION_RATE radians/sec. Snap on first
    // pose (dt=0) so the train doesn't spin into place when first spawned.
    if (dt <= 0) {
      this.meshRotation.copy(targetQ);
    } else {
      const ang = this.meshRotation.angleTo(targetQ);
      const maxStep = ROTATION_RATE * dt;
      if (ang <= maxStep || ang < 1e-5) {
        this.meshRotation.copy(targetQ);
      } else {
        this.meshRotation.slerp(targetQ, maxStep / ang);
      }
    }

    // --- Append to trail and place each car ---
    // The trail records the head's arc-length history; each trailing car
    // looks up its pose at headDist − carIndex * CAR_SPACING.
    const lastSample = this.trail.length > 0 ? this.trail[this.trail.length - 1]! : null;
    const step = lastSample ? headPos.distanceTo(lastSample.pos) : 0;
    if (!lastSample || step > 0.01) {
      this.trailDist += step;
      this.trail.push({
        pos: headPos.clone(),
        quat: this.meshRotation.clone(),
        dist: this.trailDist,
      });
      // Keep trail length bounded — drop entries beyond the tail of the
      // longest possible consist.
      const maxTail = (this.cars.length + 1) * CAR_SPACING + 2;
      while (this.trail.length > 4 && this.trail[1]!.dist < this.trailDist - maxTail) {
        this.trail.shift();
      }
    }
    // Place each car. Car 0 is the locomotive (at the head).
    for (let i = 0; i < this.cars.length; i++) {
      const car = this.cars[i]!;
      const carDist = this.trailDist - i * CAR_SPACING;
      const sample = this.sampleTrailAt(carDist) ?? { pos: headPos, quat: this.meshRotation };
      car.position.copy(sample.pos);
      car.quaternion.copy(sample.quat);
    }
  }

  /** Find / interpolate a trail sample at the given cumulative-arc-length
   *  position. Returns null if the trail doesn't reach back that far. */
  private sampleTrailAt(targetDist: number): TrailSample | null {
    if (this.trail.length === 0) return null;
    // Most-recent first scan; trails are typically short.
    for (let i = this.trail.length - 1; i >= 0; i--) {
      const a = this.trail[i]!;
      if (a.dist <= targetDist) {
        const b = this.trail[i + 1] ?? a;
        const span = b.dist - a.dist;
        const u = span > 1e-6 ? (targetDist - a.dist) / span : 0;
        return {
          pos: new THREE.Vector3().lerpVectors(a.pos, b.pos, u),
          quat: a.quat.clone().slerp(b.quat, u),
          dist: targetDist,
        };
      }
    }
    return null;
  }

  /** Inspect helper: current heading-toward target's label. */
  currentTargetLabel(): string {
    return this.currentTargetNode().label ?? this.currentTargetNode().id;
  }

  /** The locomotive group — used by external code (e.g. a POV camera) that
   *  needs the head's world-space pose. */
  get locomotive(): THREE.Object3D {
    return this.cars[0]!;
  }

  private build(numCars: number): THREE.Group {
    // Container holds the articulated cars. Each car sets its own world
    // position + quaternion every frame; the container's transform is
    // never set (kept at identity).
    const g = new THREE.Group();
    this.cars = [];
    for (let i = 0; i < numCars; i++) {
      const car = i === 0 ? this.buildLocomotive() : this.buildPassengerCar();
      g.add(car);
      this.cars.push(car);
    }
    return g;
  }

  private buildLocomotive(): THREE.Group {
    const g = new THREE.Group();
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), MAT.white);
    front.position.set(0.0, 0.32, 0);
    front.castShadow = true;
    g.add(front);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.65), MAT.white);
    nose.position.set(0.6, 0.27, 0);
    nose.castShadow = true;
    g.add(nose);
    const headlight = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.5), MAT.yellowTrans);
    headlight.position.set(0.75, 0.32, 0);
    g.add(headlight);
    const conn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), MAT.grayDark);
    conn.position.set(-0.65, 0.3, 0);
    g.add(conn);
    const bogieGeo = new THREE.BoxGeometry(0.6, 0.15, 0.4);
    const bogie = new THREE.Mesh(bogieGeo, MAT.grayDark);
    bogie.position.set(0.0, 0.05, 0);
    g.add(bogie);
    return g;
  }

  private buildPassengerCar(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.5, 0.65), MAT.blueTrans);
    body.position.set(0, 0.32, 0);
    body.castShadow = true;
    g.add(body);
    const frontConn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), MAT.grayDark);
    frontConn.position.set(0.6, 0.3, 0);
    g.add(frontConn);
    const rearConn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), MAT.grayDark);
    rearConn.position.set(-0.6, 0.3, 0);
    g.add(rearConn);
    const bogie = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.15, 0.4), MAT.grayDark);
    bogie.position.set(0, 0.05, 0);
    g.add(bogie);
    return g;
  }
}

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/** Quaternion that rotates the train's local +X (nose) to point along
 *  (fx, fy, fz), with the train's local +Y (top) as close to world +Y as
 *  possible. Allows yaw + pitch in one shot so trains on ramps match the
 *  slope.
 *
 *  A default-oriented Three.js object has local axes matching world
 *  axes: +X right, +Y up, +Z forward-out-of-screen. With our convention
 *  that the train's nose is local +X, that means an unrotated train's
 *  right side is local +Z (= world +Z = south here). Right-hand rule
 *  for the basis: local Z = fwd × worldUp (so det = +1, a proper
 *  rotation; the reverse order gives a reflection). */
function orientationForward(fx: number, fy: number, fz: number): THREE.Quaternion {
  const fwd = new THREE.Vector3(fx, fy, fz);
  const len = fwd.length();
  if (len < 1e-6) return new THREE.Quaternion();
  fwd.divideScalar(len);
  const worldUp = new THREE.Vector3(0, 1, 0);
  const localZ = new THREE.Vector3().crossVectors(fwd, worldUp);
  if (localZ.lengthSq() < 1e-6) localZ.set(0, 0, 1); // forward is vertical
  localZ.normalize();
  const localY = new THREE.Vector3().crossVectors(localZ, fwd).normalize();
  const m = new THREE.Matrix4().makeBasis(fwd, localY, localZ);
  return new THREE.Quaternion().setFromRotationMatrix(m);
}
