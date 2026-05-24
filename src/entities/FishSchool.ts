import * as THREE from 'three';
import { Entity } from '../sim/Entity';

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
  private time = 0;

  // Scratch vectors reused per-frame to avoid GC churn.
  private readonly sepAccum = new THREE.Vector3();
  private readonly aliAccum = new THREE.Vector3();
  private readonly cohAccum = new THREE.Vector3();
  private readonly toCentre = new THREE.Vector3();
  private readonly steer = new THREE.Vector3();
  private readonly diff = new THREE.Vector3();

  constructor(opts: FishSchoolOptions) {
    this.centre = new THREE.Vector3().fromArray(opts.centre ?? [0, 4, 0]);
    this.boundRadius = opts.boundRadius ?? 6;
    this.cruiseSpeed = opts.speed ?? 1.4;
    this.separationWeight = opts.separationWeight ?? 1.6;
    this.alignmentWeight = opts.alignmentWeight ?? 1.0;
    this.cohesionWeight = opts.cohesionWeight ?? 0.8;
    this.neighbourRadius = opts.neighbourRadius ?? 1.4;

    const count = opts.count ?? 28;
    const fishLength = opts.fishLength ?? 0.32;
    const geo = buildFishGeometry(fishLength);

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

      // Apply steering as acceleration; clamp velocity to cruise speed.
      a.velocity.addScaledVector(this.steer, dt * 1.4);
      const speed = a.velocity.length();
      if (speed > this.cruiseSpeed) {
        a.velocity.multiplyScalar(this.cruiseSpeed / speed);
      } else if (speed < this.cruiseSpeed * 0.6) {
        // Don't let fish coast to a near-stop
        a.velocity.setLength(this.cruiseSpeed * 0.6);
      }

      // Integrate position
      a.mesh.position.addScaledVector(a.velocity, dt);

      // Orient mesh along velocity; tail wags via small per-fish rotation.
      const lookAt = a.mesh.position.clone().add(a.velocity);
      a.mesh.lookAt(lookAt);
      const wag = Math.sin(this.time * 8 + a.phase) * 0.18;
      a.mesh.rotation.z += wag;
    }
  }
}

/**
 * Tiny fish mesh — a flat body that points along +Z (so lookAt() faces it
 * correctly toward the velocity direction). Body is two triangles in a kite
 * shape (wider in the middle, narrow at nose and tail), plus a small tail
 * fin at the back.
 */
function buildFishGeometry(length: number): THREE.BufferGeometry {
  const halfL = length / 2;
  const halfW = length * 0.18;

  const geo = new THREE.BufferGeometry();
  // 5 vertices: nose, mid-left, mid-right, tail-base, tail-tip (small offset for tail)
  const positions = new Float32Array([
    0,  0,  halfL,         // 0 nose
    -halfW, 0,  0,          // 1 mid-left
     halfW, 0,  0,          // 2 mid-right
     0,  0, -halfL,         // 3 tail-base
     0,  length * 0.18, -halfL * 1.35, // 4 tail-tip (slight upward sweep)
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([
    0, 1, 2,    // top body triangle (with nose)
    2, 1, 3,    // back body triangle
    3, 4, 2,    // tail-right
    3, 1, 4,    // tail-left
  ]);
  geo.computeVertexNormals();
  return geo;
}
