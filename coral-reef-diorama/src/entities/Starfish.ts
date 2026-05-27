import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface StarfishOptions {
  position: [number, number, number];
  yaw?: number;
  scale?: number;
  /** Phase offset (radians) so multiple starfish curl out of sync. */
  phase?: number;
}

const ARM_COUNT = 5;

/**
 * Starfish — flat 5-armed star sitting on the sand or a rock. Each arm
 * curls slowly via a sine on its tip rotation. Tiny, ambient.
 *
 * Built as a central disc + ARM_COUNT arm pivots radiating outward. Each
 * arm is a tapered box hinged at the centre so curling rotates the tip up.
 *
 * Geometry lies in the XZ plane (flat against whatever it's sitting on).
 */
export class Starfish implements Entity {
  readonly object3d: THREE.Group;
  private readonly arms: THREE.Group[] = [];
  private readonly phase: number;
  private time = 0;

  constructor(opts: StarfishOptions) {
    const scale = opts.scale ?? 1;
    this.phase = opts.phase ?? 0;

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.rotation.y = opts.yaw ?? 0;
    this.object3d.scale.setScalar(scale);

    // Central disc — slightly raised hub that the arms sprout from.
    const hub = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.starfishOrange,
    );
    hub.scale.set(1, 0.35, 1);
    hub.castShadow = true;
    hub.receiveShadow = true;
    this.object3d.add(hub);

    // Arms — each is a pivot at the hub; the arm geometry extends in local +X
    // and tapers toward the tip.
    const armLength = 0.35;
    const armWidth = 0.13;
    const armThickness = 0.08;
    for (let i = 0; i < ARM_COUNT; i++) {
      const pivot = new THREE.Group();
      pivot.rotation.y = (i / ARM_COUNT) * Math.PI * 2;
      this.object3d.add(pivot);

      // Build a tapered "arm" by cloning a base box and squashing its tip.
      // We use a small custom geometry so the tip is narrower than the root.
      const geo = new THREE.BufferGeometry();
      const verts = new Float32Array([
        // Bottom face (y=0)
        0, 0, -armWidth / 2,
        armLength, 0, -armWidth * 0.15,
        armLength, 0, armWidth * 0.15,
        0, 0, armWidth / 2,
        // Top face (y=thickness, tapers down at the tip)
        0, armThickness, -armWidth / 2,
        armLength, armThickness * 0.3, -armWidth * 0.15,
        armLength, armThickness * 0.3, armWidth * 0.15,
        0, armThickness, armWidth / 2,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex([
        // Bottom
        0, 1, 2, 0, 2, 3,
        // Top
        4, 6, 5, 4, 7, 6,
        // Sides
        0, 4, 5, 0, 5, 1,
        1, 5, 6, 1, 6, 2,
        2, 6, 7, 2, 7, 3,
        3, 7, 4, 3, 4, 0,
      ]);
      geo.computeVertexNormals();

      const arm = new THREE.Mesh(geo, MAT.starfishOrange);
      arm.castShadow = true;
      pivot.add(arm);

      this.arms.push(pivot);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Slow arm curl — each arm tips upward by a small sine. Phase offset
    // per arm so curls travel around the star instead of flapping in unison.
    for (let i = 0; i < this.arms.length; i++) {
      const arm = this.arms[i]!;
      const localPhase = (i / this.arms.length) * Math.PI * 2;
      // Rotate around the pivot's local Z so the arm tip lifts in +Y.
      arm.rotation.z = -0.12 - Math.sin(this.time * 0.6 + this.phase + localPhase) * 0.18;
    }
  }
}
