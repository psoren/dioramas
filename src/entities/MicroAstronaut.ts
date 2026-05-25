import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { buildAstronautMesh } from '../world/figures';

export interface MicroAstronautOptions {
  position: THREE.Vector3Tuple;
  heading?: number;
}

/**
 * Stationary astronaut. Waves its arms in place. For wandering pedestrians
 * see `AstronautPedestrian`.
 */
export class MicroAstronaut implements Entity {
  readonly object3d: THREE.Group;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private phase = 0;

  constructor(opts: MicroAstronautOptions) {
    const built = buildAstronautMesh();
    this.object3d = built.group;
    this.armL = built.armL;
    this.armR = built.armR;
    this.object3d.position.fromArray(opts.position);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  update(dt: number): void {
    this.phase += dt * 2.8;
    const wave = Math.sin(this.phase) * 0.35;
    this.armL.rotation.z = 0.25 + wave;
    this.armR.rotation.z = -0.25 - wave * 0.5;
  }
}
