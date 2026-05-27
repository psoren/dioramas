import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface SeaSpongeOptions {
  position: [number, number, number];
  scale?: number;
  variant?: 'red' | 'orange' | 'purple';
  yaw?: number;
}

/**
 * Sea sponge — cluster of upright open barrel/tube shapes. Static.
 *
 * 3-5 tubes of different sizes at slight tilts, with a darker interior cap
 * sunk into each so the opening reads as a hole rather than a closed top.
 * Visually distinct from `tubeCoral` (which is taller and thinner).
 */
export class SeaSponge implements Entity {
  readonly object3d: THREE.Group;

  constructor(opts: SeaSpongeOptions) {
    const scale = opts.scale ?? 1;
    const variant = opts.variant ?? 'red';
    const body =
      variant === 'red' ? MAT.spongeRed
      : variant === 'orange' ? MAT.spongeOrange
      : MAT.spongePurple;
    const interior = MAT.urchinBody; // dark inside

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.rotation.y = opts.yaw ?? 0;
    this.object3d.scale.setScalar(scale);

    const tubeCount = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < tubeCount; i++) {
      const h = 0.55 + Math.random() * 0.5;
      const r = 0.18 + Math.random() * 0.12;
      const wallGeo = new THREE.CylinderGeometry(r, r * 1.1, h, 14, 1, true);
      wallGeo.translate(0, h / 2, 0);
      const wall = new THREE.Mesh(wallGeo, body);
      wall.castShadow = true;
      wall.receiveShadow = true;

      // Dark interior disc set into the top.
      const interiorDisc = new THREE.Mesh(
        new THREE.CircleGeometry(r * 0.92, 14),
        interior,
      );
      interiorDisc.rotation.x = -Math.PI / 2;
      interiorDisc.position.y = h - 0.04;

      const tube = new THREE.Group();
      tube.add(wall);
      tube.add(interiorDisc);

      const angle = (i / tubeCount) * Math.PI * 2 + Math.random() * 0.5;
      const dist = (Math.random() * 0.25);
      tube.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      tube.rotation.z = (Math.random() - 0.5) * 0.2;
      tube.rotation.x = (Math.random() - 0.5) * 0.2;
      this.object3d.add(tube);
    }
  }
}
