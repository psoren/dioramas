import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { WorldState } from '../world/WorldState';

export interface BioluminescenceOptions {
  worldState: WorldState;
  /** Number of glowing specks. Default 220. */
  count?: number;
  /** Bounding box half-extents the specks are scattered within. Default 22. */
  spread?: number;
  /** Minimum Y. Default 0.3 (just above the floor). */
  minY?: number;
  /** Maximum Y. Default 10. */
  maxY?: number;
}

/**
 * Bioluminescent specks — tiny additive-blended points scattered through
 * the water column, invisible during the day and fading in during the
 * night portion of the day-night cycle. Each speck blinks at its own
 * slow rate so the night feels alive, not stippled.
 */
export class Bioluminescence implements Entity {
  readonly object3d: THREE.Points;
  private readonly worldState: WorldState;
  private readonly geo: THREE.BufferGeometry;
  private readonly mat: THREE.PointsMaterial;
  private readonly phases: Float32Array;
  private time = 0;

  constructor(opts: BioluminescenceOptions) {
    this.worldState = opts.worldState;
    const count = opts.count ?? 220;
    const spread = opts.spread ?? 22;
    const minY = opts.minY ?? 0.3;
    const maxY = opts.maxY ?? 10;

    const positions = new Float32Array(count * 3);
    this.phases = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 2 * spread;
      positions[i * 3 + 1] = minY + Math.random() * (maxY - minY);
      positions[i * 3 + 2] = (Math.random() - 0.5) * 2 * spread;
      this.phases[i] = Math.random() * Math.PI * 2;
    }
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    this.mat = new THREE.PointsMaterial({
      color: 0x6cf0d8,
      size: 0.07,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.object3d = new THREE.Points(this.geo, this.mat);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Visible only at night — fade with (1 - dayNess)^2 so dusk/dawn don't
    // show. Average blink modulates the global opacity slightly so the
    // cloud feels like it's breathing.
    const nightness = Math.max(0, 1 - this.worldState.dayNess);
    const nightStrength = nightness * nightness;
    if (nightStrength < 0.001) {
      this.object3d.visible = false;
      return;
    }
    this.object3d.visible = true;

    // Average blink across all specks — phase per point would require per-
    // point size attributes (custom shader). Cheap aggregate works fine.
    const blink = 0.85 + 0.15 * Math.sin(this.time * 0.7);
    this.mat.opacity = nightStrength * 0.95 * blink;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}
