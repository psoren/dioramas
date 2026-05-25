import type * as THREE from 'three';

/**
 * Everything in the simulation implements this. Add a new entity by writing
 * a class that implements this interface, then `sim.add(new Thing())`.
 */
export interface Entity {
  /** The root Object3D that gets added to the scene. */
  readonly object3d: THREE.Object3D;

  /**
   * Called once per frame. `dt` is the time delta in seconds, already
   * scaled by `sim.speedMultiplier` and zeroed when the sim is paused.
   * Omit if your entity is purely static.
   */
  update?(dt: number): void;

  /** Called when removed from the sim. Free GPU resources here. */
  dispose?(): void;
}
