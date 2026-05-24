import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { TRACK_Y } from '../world/constants';

export interface TrackVehicleOptions {
  path: THREE.CatmullRomCurve3;
  /** Loops per second. */
  speed?: number;
  /** Initial position along the path, in [0, 1). */
  t?: number;
  /** Vertical offset above the track surface. */
  yOffset?: number;
}

/**
 * Base class for any vehicle that follows a closed curve.
 * Subclasses implement `build()` to produce their mesh hierarchy.
 * Forward direction in the local mesh is +X.
 */
export abstract class TrackVehicle implements Entity {
  readonly object3d: THREE.Group;
  protected readonly path: THREE.CatmullRomCurve3;
  speed: number;
  t: number;
  yOffset: number;
  laps = 0;

  constructor(opts: TrackVehicleOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.06;
    this.t = opts.t ?? 0;
    this.yOffset = opts.yOffset ?? 0.18;
    this.object3d = this.build();
  }

  /** Build the mesh hierarchy. Origin at vehicle's pivot, forward = +X. */
  protected abstract build(): THREE.Group;

  update(dt: number): void {
    const prev = this.t;
    this.t = (this.t + this.speed * dt) % 1;
    if (this.t < prev && dt > 0) this.laps++;
    const pos = this.path.getPointAt(this.t);
    const tan = this.path.getTangentAt(this.t);
    this.object3d.position.set(pos.x, TRACK_Y + this.yOffset, pos.z);
    this.object3d.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
  }
}
