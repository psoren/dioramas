import * as THREE from 'three';
import { Entity } from '../sim/Entity';

export interface PathVehicleOptions {
  path: THREE.CatmullRomCurve3;
  /** Loops per second. Negative values run the path in reverse. */
  speed?: number;
  /** Initial position along the path, in [0, 1). */
  t?: number;
  /** World-space y position for the vehicle pivot. */
  y?: number;
}

/**
 * Base class for any vehicle that follows a closed curve.
 * Subclasses build their mesh with forward direction along +X.
 */
export abstract class PathVehicle implements Entity {
  readonly object3d: THREE.Group;
  protected readonly path: THREE.CatmullRomCurve3;
  t: number;
  y: number;
  laps = 0;
  private cruiseSpeed: number;
  private readonly holds = new Set<string>();

  constructor(opts: PathVehicleOptions) {
    this.path = opts.path;
    this.cruiseSpeed = opts.speed ?? 0.06;
    this.t = wrap01(opts.t ?? 0);
    this.y = opts.y ?? 0;
    this.object3d = this.build(opts);
  }

  get speed(): number {
    return this.holds.size > 0 ? 0 : this.cruiseSpeed;
  }

  set speed(value: number) {
    this.cruiseSpeed = value;
  }

  hold(reason: string): void {
    this.holds.add(reason);
  }

  release(reason: string): void {
    this.holds.delete(reason);
  }

  isHeld(reason?: string): boolean {
    return reason ? this.holds.has(reason) : this.holds.size > 0;
  }

  /** Build the mesh hierarchy. Origin at vehicle's pivot, forward = +X. */
  protected abstract build(opts: PathVehicleOptions): THREE.Group;

  update(dt: number): void {
    const prev = this.t;
    this.t = wrap01(this.t + this.speed * dt);
    if (dt > 0 && this.speed >= 0 && this.t < prev) this.laps++;
    if (dt > 0 && this.speed < 0 && this.t > prev) this.laps++;
    placeOnPath(this.object3d, this.path, this.t, this.y);
  }
}

export function placeOnPath(
  object3d: THREE.Object3D,
  path: THREE.CatmullRomCurve3,
  t: number,
  y: number,
): void {
  const u = wrap01(t);
  const pos = path.getPointAt(u);
  const tan = path.getTangentAt(u);
  object3d.position.set(pos.x, pos.y + y, pos.z);
  object3d.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
}

export function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}
