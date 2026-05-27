import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface SeaUrchinOptions {
  position: [number, number, number];
  scale?: number;
  spineCount?: number;
}

/**
 * Sea urchin — small dark body covered in radial spines. Fully static.
 *
 * Spines are thin cones radiating outward from a low-poly sphere. Random
 * length per spine + uniform random direction over the upper hemisphere
 * gives it the prickly silhouette without a heavy mesh.
 */
export class SeaUrchin implements Entity {
  readonly object3d: THREE.Group;

  constructor(opts: SeaUrchinOptions) {
    const scale = opts.scale ?? 1;
    const spineCount = opts.spineCount ?? 32;

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.scale.setScalar(scale);

    // Body — squashed sphere; bottom hidden in the sand.
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 10),
      MAT.urchinBody,
    );
    body.scale.y = 0.7;
    body.castShadow = true;
    body.receiveShadow = true;
    this.object3d.add(body);

    // Spines. Each is a thin cone, with its base at the body surface and
    // tip pointing radially outward.
    const spineGeo = new THREE.ConeGeometry(0.018, 0.28, 5);
    spineGeo.translate(0, 0.14, 0); // pivot at base
    for (let i = 0; i < spineCount; i++) {
      // Uniform direction on the upper hemisphere — bias upward so spines
      // poke up out of the sand rather than down into it.
      const theta = Math.acos(Math.random() * 0.85 + 0.05);
      const phi = Math.random() * Math.PI * 2;
      const dx = Math.sin(theta) * Math.cos(phi);
      const dy = Math.cos(theta);
      const dz = Math.sin(theta) * Math.sin(phi);

      const spine = new THREE.Mesh(spineGeo, MAT.urchinSpine);
      spine.scale.setScalar(0.7 + Math.random() * 0.5);
      // Aim the cone (which points along +Y in its local frame) along (dx, dy, dz).
      const up = new THREE.Vector3(0, 1, 0);
      const target = new THREE.Vector3(dx, dy, dz).normalize();
      spine.quaternion.setFromUnitVectors(up, target);
      this.object3d.add(spine);
    }
  }
}
