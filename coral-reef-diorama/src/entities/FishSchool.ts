import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { WorldState } from '../world/WorldState';

export interface FishSchoolOptions {
  count?: number;
  /** World-space centre the school drifts around. */
  centre?: THREE.Vector3Tuple;
  /** Soft bound radius — past this the fish are pushed back toward centre. */
  boundRadius?: number;
  /** Material for the fish bodies. */
  material: THREE.Material;
  /** Body length in world units. */
  fishLength?: number;
  /** Cruise speed in units/sec. */
  speed?: number;
  /** Optional tweaks to the boids weights. */
  separationWeight?: number;
  alignmentWeight?: number;
  cohesionWeight?: number;
  /** Neighbour distance for alignment/cohesion (separation uses 0.5× this). */
  neighbourRadius?: number;
  /**
   * Body shape:
   *  - 'flat'    (default) — wide-from-above kite, like a typical herring
   *  - 'upright' — tall-from-side kite, like a tang or angelfish
   */
  bodyShape?: 'flat' | 'upright';
  /** Half-cross-section / length ratio. Higher = chunkier fish. Default 0.18. */
  bodyAspect?: number;
  /**
   * Predator Object3Ds the school should flee. When any fish is within
   * `fleeRadius` of a predator's world position, it gets a strong repulsion
   * force away from it.
   */
  predators?: THREE.Object3D[];
  /** How close a predator can get before fish flee. Default 3.0. */
  fleeRadius?: number;
  /**
   * Static obstacles (typically reef centres) the school should avoid. Each
   * obstacle is a sphere — fish within (radius + buffer) get a repulsion
   * force away from the centre.
   */
  obstacles?: Array<{ position: THREE.Vector3Tuple; radius: number }>;
  /**
   * Optional WorldState reference. If provided, the school reads the
   * global current vector, scales speed by night-ness, and boosts flee
   * force during shark-hunt events.
   */
  worldState?: WorldState;
}

interface Fish {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  /** Random phase so tails don't all wag in unison. */
  phase: number;
}

/**
 * A school of fish driven by hand-rolled 3D boids: separation + alignment +
 * cohesion + a soft "return to centre" force at the bound. Each fish points
 * along its velocity and its tail wags as a sine of speed.
 *
 * Boids parameters are intentionally exposed via options so the caller can
 * give different schools different temperaments (jittery silver minnows vs.
 * languid blue tang). Schools don't see each other — they operate in
 * isolation, so neighbour searches stay O(n^2) within a school which is
 * fine at our counts (≤40 each).
 */
export class FishSchool implements Entity {
  readonly object3d = new THREE.Group();
  private readonly fish: Fish[] = [];
  private readonly centre: THREE.Vector3;
  private readonly boundRadius: number;
  private readonly cruiseSpeed: number;
  private readonly separationWeight: number;
  private readonly alignmentWeight: number;
  private readonly cohesionWeight: number;
  private readonly neighbourRadius: number;
  private readonly predators: THREE.Object3D[];
  private readonly fleeRadius: number;
  private readonly obstacles: Array<{ position: THREE.Vector3; radius: number }>;
  private readonly worldState: WorldState | undefined;
  private time = 0;

  // Scratch vectors reused per-frame to avoid GC churn.
  private readonly sepAccum = new THREE.Vector3();
  private readonly aliAccum = new THREE.Vector3();
  private readonly cohAccum = new THREE.Vector3();
  private readonly toCentre = new THREE.Vector3();
  private readonly steer = new THREE.Vector3();
  private readonly diff = new THREE.Vector3();
  private readonly fleeVec = new THREE.Vector3();
  private readonly predPos = new THREE.Vector3();
  private readonly lookAtTarget = new THREE.Vector3();

  constructor(opts: FishSchoolOptions) {
    this.centre = new THREE.Vector3().fromArray(opts.centre ?? [0, 4, 0]);
    this.boundRadius = opts.boundRadius ?? 6;
    this.cruiseSpeed = opts.speed ?? 1.4;
    this.separationWeight = opts.separationWeight ?? 1.6;
    this.alignmentWeight = opts.alignmentWeight ?? 1.0;
    this.cohesionWeight = opts.cohesionWeight ?? 0.8;
    this.neighbourRadius = opts.neighbourRadius ?? 1.4;
    this.predators = opts.predators ?? [];
    this.fleeRadius = opts.fleeRadius ?? 3.0;
    this.obstacles = (opts.obstacles ?? []).map(o => ({
      position: new THREE.Vector3().fromArray(o.position),
      radius: o.radius,
    }));
    this.worldState = opts.worldState;

    const count = opts.count ?? 28;
    const fishLength = opts.fishLength ?? 0.32;
    const geo = buildFishGeometry(fishLength, opts.bodyAspect ?? 0.18, opts.bodyShape ?? 'flat');

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(geo, opts.material);
      mesh.castShadow = true;
      // Random initial position inside the bound
      const offset = new THREE.Vector3(
        (Math.random() - 0.5) * 2 * this.boundRadius * 0.6,
        (Math.random() - 0.5) * 2 * this.boundRadius * 0.4,
        (Math.random() - 0.5) * 2 * this.boundRadius * 0.6,
      );
      mesh.position.copy(this.centre).add(offset);
      // Random initial velocity
      const velocity = new THREE.Vector3(
        Math.random() - 0.5,
        (Math.random() - 0.5) * 0.3,
        Math.random() - 0.5,
      ).normalize().multiplyScalar(this.cruiseSpeed);
      this.object3d.add(mesh);
      this.fish.push({ mesh, velocity, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    const sepRadius = this.neighbourRadius * 0.55;
    const sepRadiusSq = sepRadius * sepRadius;
    const neighbourRadiusSq = this.neighbourRadius * this.neighbourRadius;

    // Read shared world state once per frame.
    const ws = this.worldState;
    const dayNess = ws ? ws.dayNess : 1;
    // Slow + tighten at night — schools "sleep" near the reef.
    const nightFactor = 0.35 + 0.65 * dayNess; // 0.35 at midnight, 1 at noon
    const effectiveCruise = this.cruiseSpeed * nightFactor;
    const huntBoost = ws && ws.sharkHunt.active ? ws.sharkHunt.intensity : 0;
    const currentX = ws ? ws.current.x : 0;
    const currentZ = ws ? ws.current.z : 0;

    for (let i = 0; i < this.fish.length; i++) {
      const a = this.fish[i]!;
      this.sepAccum.set(0, 0, 0);
      this.aliAccum.set(0, 0, 0);
      this.cohAccum.set(0, 0, 0);
      let aliCount = 0;
      let cohCount = 0;

      for (let j = 0; j < this.fish.length; j++) {
        if (i === j) continue;
        const b = this.fish[j]!;
        this.diff.copy(a.mesh.position).sub(b.mesh.position);
        const dSq = this.diff.lengthSq();
        if (dSq <= 0.0001) continue;

        if (dSq < sepRadiusSq) {
          // Separation: push away, weighted by 1/distance
          this.sepAccum.addScaledVector(this.diff.normalize(), 1 / Math.sqrt(dSq));
        }
        if (dSq < neighbourRadiusSq) {
          this.aliAccum.add(b.velocity);
          this.cohAccum.add(b.mesh.position);
          aliCount++;
          cohCount++;
        }
      }

      this.steer.set(0, 0, 0);

      if (this.sepAccum.lengthSq() > 0) {
        this.sepAccum.normalize().multiplyScalar(this.cruiseSpeed);
        this.sepAccum.sub(a.velocity);
        this.steer.addScaledVector(this.sepAccum, this.separationWeight);
      }
      if (aliCount > 0) {
        this.aliAccum.divideScalar(aliCount).setLength(this.cruiseSpeed).sub(a.velocity);
        this.steer.addScaledVector(this.aliAccum, this.alignmentWeight);
      }
      if (cohCount > 0) {
        this.cohAccum.divideScalar(cohCount).sub(a.mesh.position).setLength(this.cruiseSpeed).sub(a.velocity);
        this.steer.addScaledVector(this.cohAccum, this.cohesionWeight);
      }

      // Soft bound: gently pull back toward centre when outside the bound radius.
      this.toCentre.copy(this.centre).sub(a.mesh.position);
      const distFromCentre = this.toCentre.length();
      if (distFromCentre > this.boundRadius) {
        const pullStrength = (distFromCentre - this.boundRadius) * 0.8;
        this.toCentre.setLength(this.cruiseSpeed).sub(a.velocity);
        this.steer.addScaledVector(this.toCentre, pullStrength);
      }

      // Predator flee: strong repulsion if any predator is within fleeRadius.
      // Radius and force both expand during an active hunt event.
      const effFleeRadius = this.fleeRadius * (1 + huntBoost * 0.8);
      for (const pred of this.predators) {
        this.predPos.setFromMatrixPosition(pred.matrixWorld);
        this.fleeVec.copy(a.mesh.position).sub(this.predPos);
        const dPred = this.fleeVec.length();
        if (dPred > 0 && dPred < effFleeRadius) {
          const intensity = (1 - dPred / effFleeRadius) ** 2;
          this.fleeVec.setLength(this.cruiseSpeed * 1.8).sub(a.velocity);
          this.steer.addScaledVector(this.fleeVec, (4.0 + huntBoost * 5) * intensity);
        }
      }

      // Obstacle (reef) repulsion: push away from sphere centres.
      for (const ob of this.obstacles) {
        this.fleeVec.copy(a.mesh.position).sub(ob.position);
        const dOb = this.fleeVec.length();
        const buffer = ob.radius + 0.4;
        if (dOb > 0 && dOb < buffer) {
          const intensity = (1 - dOb / buffer);
          this.fleeVec.setLength(this.cruiseSpeed).sub(a.velocity);
          this.steer.addScaledVector(this.fleeVec, 3.0 * intensity);
        }
      }

      // Drift current pushes everyone slightly along the global current vector.
      if (currentX !== 0 || currentZ !== 0) {
        a.velocity.x += currentX * dt;
        a.velocity.z += currentZ * dt;
      }

      // Apply steering as acceleration; clamp velocity to effective cruise.
      // Effective cruise is reduced at night and elevated during a hunt.
      a.velocity.addScaledVector(this.steer, dt * 1.4);
      const huntFactor = 1 + huntBoost * 0.8;
      const cruiseHi = effectiveCruise * huntFactor;
      const speed = a.velocity.length();
      if (speed > cruiseHi) {
        a.velocity.multiplyScalar(cruiseHi / speed);
      } else if (speed < cruiseHi * 0.6) {
        a.velocity.setLength(cruiseHi * 0.6);
      }

      // Integrate position
      a.mesh.position.addScaledVector(a.velocity, dt);

      // Orient mesh along velocity; tail wags via small per-fish rotation.
      this.lookAtTarget.copy(a.mesh.position).add(a.velocity);
      a.mesh.lookAt(this.lookAtTarget);
      const wag = Math.sin(this.time * 8 + a.phase) * 0.18;
      a.mesh.rotation.z += wag;
    }
  }
}

/**
 * Fish mesh — a 3D body that points along +Z. Body is a low-poly ellipsoid
 * (two cone-fans joined at a midbody ring) with a flat caudal fin sticking
 * out the back.
 *
 * `aspect` controls cross-section / length (chunkiness). `shape='flat'` puts
 * the wide axis along X (typical fish viewed from above). `shape='upright'`
 * puts the wide axis along Y — a tang/angelfish silhouette where the body
 * is tall and thin.
 *
 * Caudal fin is always in the vertical (YZ) plane regardless of body shape —
 * real fish caudal fins are vertical even on tall tangs, since the fin moves
 * side-to-side to swim.
 */
function buildFishGeometry(
  length: number,
  aspect: number,
  shape: 'flat' | 'upright',
): THREE.BufferGeometry {
  const halfL = length / 2;
  // Wide and narrow body radii. For flat fish, wide is X; for upright, wide is Y.
  const wide = length * aspect;
  const narrow = wide * 0.55;
  const rx = shape === 'flat' ? wide : narrow;
  const ry = shape === 'flat' ? narrow : wide;

  // Caudal fin proportions.
  const finLen = length * 0.28;
  const finHalfHeight = Math.max(rx, ry) * 1.5;
  const finTipBend = length * 0.08; // slight off-axis flick

  const SEGMENTS = 10; // around the body cross-section

  const positions: number[] = [];
  const indices: number[] = [];

  // 0: nose tip (front of body).
  positions.push(0, 0, halfL);
  const NOSE = 0;

  // 1..SEGMENTS: ring of vertices around the body midpoint (z=0).
  const RING_START = 1;
  for (let i = 0; i < SEGMENTS; i++) {
    const t = (i / SEGMENTS) * Math.PI * 2;
    positions.push(Math.cos(t) * rx, Math.sin(t) * ry, 0);
  }

  // Tail-base: rear of the body, where the caudal fin attaches.
  const TAIL_BASE = RING_START + SEGMENTS;
  positions.push(0, 0, -halfL);

  // Caudal fin vertices: top, bottom, trailing tip.
  const TAIL_TOP = TAIL_BASE + 1;
  const TAIL_BOTTOM = TAIL_BASE + 2;
  const TAIL_TIP = TAIL_BASE + 3;
  positions.push(0,  finHalfHeight, -halfL - finLen * 0.25);
  positions.push(0, -finHalfHeight, -halfL - finLen * 0.25);
  positions.push(finTipBend, 0, -halfL - finLen);

  // Body — nose fan (nose to each ring pair). Winding chosen so the outward
  // normal points away from the body's central axis.
  for (let i = 0; i < SEGMENTS; i++) {
    const a = RING_START + i;
    const b = RING_START + ((i + 1) % SEGMENTS);
    indices.push(NOSE, a, b);
  }

  // Body — tail-base fan (each ring pair to the tail base).
  for (let i = 0; i < SEGMENTS; i++) {
    const a = RING_START + i;
    const b = RING_START + ((i + 1) % SEGMENTS);
    indices.push(TAIL_BASE, b, a);
  }

  // Caudal fin — flat kite, drawn with both windings so it's double-sided
  // without needing a separate material setting.
  indices.push(TAIL_BASE, TAIL_TOP, TAIL_TIP);
  indices.push(TAIL_BASE, TAIL_TIP, TAIL_BOTTOM);
  indices.push(TAIL_BASE, TAIL_TIP, TAIL_TOP);
  indices.push(TAIL_BASE, TAIL_BOTTOM, TAIL_TIP);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
