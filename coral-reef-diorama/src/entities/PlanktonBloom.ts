import * as THREE from 'three';
import { Entity } from '../sim/Entity';

export interface PlanktonBloomOptions {
  /** World centre of the bloom. */
  centre: THREE.Vector3;
  /** Sphere radius the motes are scattered within. Default 2.5. */
  radius?: number;
  /** Number of motes. Default 80. */
  count?: number;
  /** Total lifetime in seconds. Fades in for 4s, holds, fades out 6s. */
  duration?: number;
  /** Tint of the bloom. Default warm yellow-white. */
  color?: THREE.ColorRepresentation;
}

/**
 * A short-lived patch of tiny glowing motes drifting through the water.
 * Reads as a passing plankton cloud catching the light. Self-disposes
 * after `duration`.
 *
 * Implementation: a single THREE.Points cloud with additive blending. Each
 * mote has its own slow random drift vector so the cloud has internal
 * motion, not just a translating sphere.
 */
export class PlanktonBloom implements Entity {
  readonly object3d: THREE.Points;
  done = false;

  private readonly mat: THREE.PointsMaterial;
  private readonly geo: THREE.BufferGeometry;
  private readonly velocities: Float32Array;
  private readonly basePos: Float32Array;
  private readonly duration: number;
  private elapsed = 0;
  private readonly drift: THREE.Vector3;

  constructor(opts: PlanktonBloomOptions) {
    const count = opts.count ?? 80;
    const radius = opts.radius ?? 2.5;
    this.duration = opts.duration ?? 22;

    const positions = new Float32Array(count * 3);
    this.basePos = new Float32Array(count * 3);
    this.velocities = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // Uniform sample inside a sphere.
      let x: number, y: number, z: number, l: number;
      do {
        x = Math.random() * 2 - 1;
        y = Math.random() * 2 - 1;
        z = Math.random() * 2 - 1;
        l = x * x + y * y + z * z;
      } while (l > 1 || l < 0.0001);
      positions[i * 3] = opts.centre.x + x * radius;
      positions[i * 3 + 1] = opts.centre.y + y * radius;
      positions[i * 3 + 2] = opts.centre.z + z * radius;
      this.basePos[i * 3] = positions[i * 3]!;
      this.basePos[i * 3 + 1] = positions[i * 3 + 1]!;
      this.basePos[i * 3 + 2] = positions[i * 3 + 2]!;
      this.velocities[i * 3] = (Math.random() - 0.5) * 0.05;
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.05;
    }

    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.mat = new THREE.PointsMaterial({
      color: opts.color ?? 0xfff5c8,
      size: 0.09,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.object3d = new THREE.Points(this.geo, this.mat);
    this.drift = new THREE.Vector3(
      (Math.random() - 0.5) * 0.08,
      (Math.random() - 0.5) * 0.03,
      (Math.random() - 0.5) * 0.08,
    );
  }

  update(dt: number): void {
    if (dt <= 0 || this.done) return;
    this.elapsed += dt;
    const t = this.elapsed / this.duration;

    // Fade in over the first 4s, fade out over the last 6s.
    const FADE_IN = 4 / this.duration;
    const FADE_OUT = 6 / this.duration;
    const alpha =
      t < FADE_IN ? t / FADE_IN
      : t > 1 - FADE_OUT ? Math.max(0, (1 - t) / FADE_OUT)
      : 1;
    this.mat.opacity = alpha * 0.85;

    // Drift the motes around their base positions + global drift.
    const positions = this.geo.attributes.position!;
    const arr = positions.array as Float32Array;
    for (let i = 0; i < positions.count; i++) {
      const ix = i * 3;
      arr[ix] = this.basePos[ix]!
        + this.velocities[ix]! * this.elapsed
        + this.drift.x * this.elapsed
        + Math.sin(this.elapsed * 0.8 + i * 0.31) * 0.12;
      arr[ix + 1] = this.basePos[ix + 1]!
        + this.velocities[ix + 1]! * this.elapsed
        + this.drift.y * this.elapsed
        + Math.cos(this.elapsed * 0.6 + i * 0.17) * 0.08;
      arr[ix + 2] = this.basePos[ix + 2]!
        + this.velocities[ix + 2]! * this.elapsed
        + this.drift.z * this.elapsed
        + Math.sin(this.elapsed * 0.7 + i * 0.23) * 0.12;
    }
    positions.needsUpdate = true;

    if (this.elapsed >= this.duration) this.done = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
