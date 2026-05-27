import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface BubbleVentOptions {
  /** Position of the vent opening on the seafloor. */
  position: [number, number, number];
  /** Max bubbles alive at once. Default 24. */
  capacity?: number;
  /** Continuous low-rate emission (bubbles/sec). Default 0.4. */
  baseRate?: number;
}

interface Bubble {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  life: number; // remaining lifetime in seconds
  ageRate: number; // 1/total-life — used to scale opacity
}

/**
 * Bubble vent — small dark rock on the seafloor that emits bubbles. Emits
 * a slow trickle continuously and can be triggered for short bursts by the
 * EventScheduler.
 *
 * Bubbles rise with slight wobble, accelerate as they go, and fade out at
 * the top of their lifespan. Pool-based: a fixed-size array of meshes is
 * recycled rather than allocating per bubble.
 */
export class BubbleVent implements Entity {
  readonly object3d: THREE.Group;
  private readonly pool: Bubble[] = [];
  private readonly free: Bubble[] = [];
  private readonly origin: THREE.Vector3;
  private emissionTimer = 0;
  private burstRemaining = 0;
  private readonly baseRate: number;

  constructor(opts: BubbleVentOptions) {
    const capacity = opts.capacity ?? 24;
    this.baseRate = opts.baseRate ?? 0.4;

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.origin = new THREE.Vector3(0, 0, 0);

    // Tiny vent rock — slight dark mound at the base.
    const ventRock = new THREE.Mesh(
      new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.rock,
    );
    ventRock.scale.y = 0.45;
    ventRock.receiveShadow = true;
    this.object3d.add(ventRock);

    // Pre-allocate bubble meshes. Hide them by default; recycle on emit.
    const bubbleGeo = new THREE.SphereGeometry(1, 8, 6);
    const bubbleMat = (MAT.bubble as THREE.MeshStandardMaterial).clone();
    bubbleMat.transparent = true;
    bubbleMat.depthWrite = false;
    for (let i = 0; i < capacity; i++) {
      const mesh = new THREE.Mesh(bubbleGeo, bubbleMat);
      mesh.visible = false;
      mesh.scale.setScalar(0.06);
      this.object3d.add(mesh);
      const b: Bubble = { mesh, velocity: new THREE.Vector3(), life: 0, ageRate: 1 };
      this.pool.push(b);
      this.free.push(b);
    }
  }

  /** Called by the EventScheduler to fire a burst of N bubbles over ~1 second. */
  burst(count: number): void {
    this.burstRemaining += count;
  }

  update(dt: number): void {
    if (dt <= 0) return;

    // Continuous trickle.
    this.emissionTimer += dt;
    const interval = 1 / this.baseRate;
    while (this.emissionTimer > interval) {
      this.emissionTimer -= interval;
      this.spawn();
    }

    // Burst emission — drip out ~12 bubbles/sec until burst is exhausted.
    if (this.burstRemaining > 0) {
      const burstThisFrame = Math.min(this.burstRemaining, Math.max(1, Math.floor(dt * 12)));
      for (let i = 0; i < burstThisFrame; i++) this.spawn();
      this.burstRemaining -= burstThisFrame;
    }

    // Advance live bubbles.
    for (const b of this.pool) {
      if (!b.mesh.visible) continue;
      b.life -= dt;
      if (b.life <= 0) {
        b.mesh.visible = false;
        this.free.push(b);
        continue;
      }
      // Acceleration upward — bubbles speed up as they shrink toward the surface.
      b.velocity.y += dt * 0.4;
      // Lateral wobble.
      b.velocity.x += (Math.random() - 0.5) * dt * 0.4;
      b.velocity.z += (Math.random() - 0.5) * dt * 0.4;
      // Damp lateral so it doesn't fly off.
      b.velocity.x *= 0.96;
      b.velocity.z *= 0.96;
      b.mesh.position.addScaledVector(b.velocity, dt);

      // Bubble grows slightly as pressure drops then fades near the top.
      const ageT = 1 - b.life * b.ageRate;
      b.mesh.scale.setScalar(0.05 + ageT * 0.04);
      const mat = b.mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.55 * (1 - Math.pow(ageT, 3));
    }
  }

  private spawn(): void {
    const b = this.free.pop();
    if (!b) return;
    b.mesh.visible = true;
    b.mesh.position.copy(this.origin);
    b.velocity.set(
      (Math.random() - 0.5) * 0.05,
      0.4 + Math.random() * 0.2,
      (Math.random() - 0.5) * 0.05,
    );
    b.life = 6 + Math.random() * 2;
    b.ageRate = 1 / b.life;
  }
}
