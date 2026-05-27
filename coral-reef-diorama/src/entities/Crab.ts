import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { placeOnPath } from '../world/pathFollow';

export interface CrabOptions {
  path: THREE.CatmullRomCurve3;
  speed?: number;
  t?: number;
  scale?: number;
}

/**
 * Crab — walks along a closed path on the seafloor. Round body, two
 * forward-pointing claws, two stalk eyes, 8 legs cycling in a wave.
 *
 * Forward (along the path tangent) = +X in local space. Legs animate by
 * lifting/dropping in a phased sine — alternating sides for a believable
 * gait. The body rocks slightly with each step.
 */
export class Crab implements Entity {
  readonly object3d: THREE.Group;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly speed: number;
  private readonly body: THREE.Group;
  private readonly legs: { mesh: THREE.Group; phase: number }[] = [];
  private t: number;
  private time = 0;

  constructor(opts: CrabOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.04;
    this.t = opts.t ?? 0;
    const scale = opts.scale ?? 1;

    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(scale);
    this.object3d.add(this.body);

    // Shell — squashed dome, pointed slightly forward.
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.32, 14, 10), MAT.crabShell);
    shell.scale.set(1.4, 0.5, 1.0);
    shell.position.y = 0.18;
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.body.add(shell);

    // Belly disc — light underside.
    const belly = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      MAT.crabClaw,
    );
    belly.scale.set(1.35, 0.3, 1.0);
    belly.position.y = 0.12;
    this.body.add(belly);

    // Stalk eyes — thin cylinders with little black spheres on top.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.3 });
    for (const z of [-0.1, 0.1]) {
      const stalk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.018, 0.018, 0.12, 6),
        MAT.crabShell,
      );
      stalk.position.set(0.32, 0.3, z);
      this.body.add(stalk);
      const eyeball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), eyeMat);
      eyeball.position.set(0.32, 0.38, z);
      this.body.add(eyeball);
    }

    // Claws — pointed forward, each a "pincer" of two cones meeting at a tip.
    for (const z of [-0.22, 0.22]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.4, 0.13, z);
      this.body.add(pivot);

      // Arm — short connector from shoulder to claw base.
      const arm = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6),
        MAT.crabLeg,
      );
      arm.rotation.z = -Math.PI / 2;
      arm.position.x = 0.09;
      pivot.add(arm);

      // Claw body — a chunky pincer-shaped ellipsoid.
      const clawBody = new THREE.Mesh(
        new THREE.SphereGeometry(0.13, 12, 8),
        MAT.crabClaw,
      );
      clawBody.scale.set(1.4, 0.7, 0.7);
      clawBody.position.x = 0.28;
      clawBody.castShadow = true;
      pivot.add(clawBody);

      // Pincer tips — two small cones at the front.
      for (const yOff of [-0.045, 0.045]) {
        const tip = new THREE.Mesh(
          new THREE.ConeGeometry(0.04, 0.13, 6),
          MAT.crabClaw,
        );
        tip.rotation.z = -Math.PI / 2;
        tip.position.set(0.45, yOff, 0);
        pivot.add(tip);
      }

      // Splay the claws slightly outward.
      pivot.rotation.y = (z > 0 ? 1 : -1) * 0.25;
    }

    // 8 legs — 4 each side. Each leg is a bent shape: thigh + shin. We
    // build them as a Group with two cylinders so we can tilt the whole
    // leg for the step cycle.
    const sides = [-1, 1];
    for (const side of sides) {
      for (let i = 0; i < 4; i++) {
        const legGroup = new THREE.Group();
        // Anchor on the side of the body, walking from front to back.
        const xPos = 0.2 - i * 0.15;
        const zPos = side * 0.22;
        legGroup.position.set(xPos, 0.12, zPos);
        legGroup.rotation.y = side > 0 ? 0 : Math.PI; // mirror left side
        this.body.add(legGroup);

        // Thigh — angled out and down from the body.
        const thigh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.03, 0.22, 6),
          MAT.crabLeg,
        );
        thigh.position.set(0, -0.05, 0.1);
        thigh.rotation.x = Math.PI / 3;
        thigh.castShadow = true;
        legGroup.add(thigh);

        // Shin — meets the thigh at a knee, points down to the sand.
        const shin = new THREE.Mesh(
          new THREE.CylinderGeometry(0.02, 0.024, 0.22, 6),
          MAT.crabLeg,
        );
        shin.position.set(0, -0.18, 0.21);
        shin.rotation.x = -Math.PI / 8;
        shin.castShadow = true;
        legGroup.add(shin);

        // Phase: alternate side + travel front-to-back.
        const phase = (i * Math.PI / 2) + (side > 0 ? 0 : Math.PI);
        this.legs.push({ mesh: legGroup, phase });
      }
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.t = (this.t + this.speed * dt) % 1;
    placeOnPath(this.object3d, this.path, this.t);

    // Leg cycle — each leg lifts and drops in a phased sine.
    const cycleRate = 6.0; // legs move much faster than body translates
    for (const l of this.legs) {
      const wave = Math.sin(this.time * cycleRate + l.phase);
      // Lift the leg up when wave is positive, drop when negative.
      l.mesh.position.y = 0.12 + Math.max(0, wave) * 0.06;
      l.mesh.rotation.z = wave * 0.18;
    }

    // Subtle body bob with each step pair.
    this.body.position.y = Math.abs(Math.sin(this.time * cycleRate)) * 0.025;
  }
}
