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
/** Default smoothing rate. Higher = punchier accel/decel; lower = mellower. */
const DEFAULT_ACCEL = 0.10; // path-units/sec per sec

export abstract class PathVehicle implements Entity {
  readonly object3d: THREE.Group;
  protected readonly path: THREE.CatmullRomCurve3;
  t: number;
  y: number;
  laps = 0;
  private cruiseSpeed: number;
  /** Current eased speed — lerps toward target each frame. */
  private currentSpeed = 0;
  /** Magnitude of speed change per second (independent of sign). */
  private readonly accel: number;
  private readonly holds = new Set<string>();

  constructor(opts: PathVehicleOptions) {
    this.path = opts.path;
    this.cruiseSpeed = opts.speed ?? 0.06;
    this.t = wrap01(opts.t ?? 0);
    this.y = opts.y ?? 0;
    this.accel = DEFAULT_ACCEL;
    this.object3d = this.build(opts);
  }

  /** Current eased speed (after holds / acceleration). */
  get speed(): number {
    return this.currentSpeed;
  }

  set speed(value: number) {
    this.cruiseSpeed = value;
  }

  /** Target speed accounting for holds. Subclasses can read this if they
   *  want to e.g. only spin wheels at cruise. */
  get targetSpeed(): number {
    return this.holds.size > 0 ? 0 : this.cruiseSpeed;
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

  /**
   * Ease `currentSpeed` toward `targetSpeed`. Subclasses that override
   * `update` MUST call this each frame, otherwise the eased speed never
   * leaves zero and the vehicle never moves.
   */
  protected advanceSpeed(dt: number): void {
    const target = this.targetSpeed;
    const delta = target - this.currentSpeed;
    const step = Math.sign(delta) * Math.min(Math.abs(delta), this.accel * dt);
    this.currentSpeed += step;
  }

  update(dt: number): void {
    this.advanceSpeed(dt);
    const prev = this.t;
    this.t = wrap01(this.t + this.currentSpeed * dt);
    if (dt > 0 && this.currentSpeed >= 0 && this.t < prev) this.laps++;
    if (dt > 0 && this.currentSpeed < 0 && this.t > prev) this.laps++;
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
