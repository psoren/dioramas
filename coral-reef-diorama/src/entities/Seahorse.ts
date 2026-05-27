import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface SeahorseOptions {
  /** World position the seahorse drifts around. */
  position: [number, number, number];
  /** Vertical drift range (peak-to-peak). Default 0.6. */
  driftRange?: number;
  scale?: number;
}

/**
 * Seahorse — curled body that hangs vertically near coral, bobs up/down,
 * and rocks slightly. Mostly stationary so it reads as a tiny ornament
 * rather than a creature swimming through.
 *
 * Body is a chain of small spheres along a hooked curve (head -> belly ->
 * curled tail). A small dorsal fin flutters. No paths — pure local motion.
 */
export class Seahorse implements Entity {
  readonly object3d: THREE.Group;
  private readonly basePosition: THREE.Vector3;
  private readonly driftRange: number;
  private readonly dorsal: THREE.Mesh;
  private time = 0;
  private readonly phase = Math.random() * Math.PI * 2;

  constructor(opts: SeahorseOptions) {
    const scale = opts.scale ?? 1;
    this.driftRange = opts.driftRange ?? 0.6;

    this.object3d = new THREE.Group();
    this.basePosition = new THREE.Vector3().fromArray(opts.position);
    this.object3d.position.copy(this.basePosition);
    this.object3d.scale.setScalar(scale);

    const bodyGeo = new THREE.SphereGeometry(0.07, 8, 6);

    // Body chain along a "?" curve. y starts high (head), curves down and
    // around to a curled tail at the bottom.
    const SEGMENTS = 16;
    for (let i = 0; i < SEGMENTS; i++) {
      const u = i / (SEGMENTS - 1);
      // Parametric curve: head at top (+Y), neck/belly straight, tail curls
      // back into a partial spiral.
      let x: number, y: number;
      if (u < 0.55) {
        // straight section — head, neck, belly
        y = 0.6 - u * 0.9;
        x = Math.sin(u * Math.PI) * 0.08; // slight body curve
      } else {
        // tail curl — spiral inward
        const ut = (u - 0.55) / 0.45; // 0..1 in tail
        const angle = ut * Math.PI * 1.6;
        const radius = 0.18 * (1 - ut * 0.4);
        x = 0.04 + Math.sin(angle) * radius;
        y = -0.05 - radius + Math.cos(angle) * radius;
      }
      const seg = new THREE.Mesh(bodyGeo, MAT.seahorseBody);
      seg.position.set(x, y, 0);
      // Taper from head (big) -> tail (small).
      const scale = 1 - u * 0.55;
      seg.scale.setScalar(scale);
      seg.castShadow = true;
      this.object3d.add(seg);
    }

    // Head bump — slightly bigger sphere with a small "snout" cylinder.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), MAT.seahorseBody);
    head.position.set(0, 0.62, 0);
    head.scale.set(1, 0.95, 1);
    this.object3d.add(head);

    const snout = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.04, 0.14, 6),
      MAT.seahorseBody,
    );
    snout.rotation.z = Math.PI / 2;
    snout.position.set(0.1, 0.6, 0);
    this.object3d.add(snout);

    // Eye on each side.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.3 });
    for (const z of [-0.07, 0.07]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 5), eyeMat);
      eye.position.set(0.04, 0.64, z);
      this.object3d.add(eye);
    }

    // Coronet (signature top knob).
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.08, 6), MAT.seahorseBody);
    crown.position.set(-0.04, 0.72, 0);
    crown.rotation.z = 0.3;
    this.object3d.add(crown);

    // Dorsal fin — small fluttering blade behind the upper body.
    const dorsalGeo = new THREE.PlaneGeometry(0.18, 0.08);
    const dorsalMat = (MAT.seahorseBody as THREE.MeshStandardMaterial).clone();
    dorsalMat.side = THREE.DoubleSide;
    this.dorsal = new THREE.Mesh(dorsalGeo, dorsalMat);
    this.dorsal.position.set(-0.08, 0.4, 0);
    this.dorsal.rotation.y = Math.PI / 2;
    this.object3d.add(this.dorsal);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Slow vertical bob.
    this.object3d.position.y =
      this.basePosition.y + Math.sin(this.time * 0.6 + this.phase) * this.driftRange * 0.5;
    // Gentle rocking around the vertical axis.
    this.object3d.rotation.z = Math.sin(this.time * 0.4 + this.phase) * 0.1;

    // Dorsal flutter — much faster.
    this.dorsal.rotation.x = Math.sin(this.time * 14) * 0.45;
  }
}
