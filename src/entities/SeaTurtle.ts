import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { placeOnPath } from '../world/pathFollow';

export interface SeaTurtleOptions {
  path: THREE.CatmullRomCurve3;
  speed?: number;
  t?: number;
}

/**
 * Sea turtle. Drifts slowly along a closed path near the upper water.
 *
 * Anatomy:
 *  - Domed shell (top) with darker scale pattern
 *  - Flat plastron below
 *  - Small head + neck protruding forward
 *  - 4 flippers (front pair larger) that flap with a sine, front-back offset
 *
 * Motion: forward translation along the path + flipper flap + gentle body roll.
 *
 * Forward: +X (so placeOnPath turns it correctly).
 */
export class SeaTurtle implements Entity {
  readonly object3d: THREE.Group;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly speed: number;
  private readonly body: THREE.Group;
  private readonly flippers: { mesh: THREE.Mesh; phase: number; isFront: boolean }[] = [];
  private t: number;
  private time = 0;

  constructor(opts: SeaTurtleOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.018;
    this.t = opts.t ?? 0;

    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.object3d.add(this.body);

    // Shell — full closed squashed sphere so there's no seam between top
    // and underside. Top half is dark green (the carapace), underside is
    // sealed by a thin lighter disc below.
    const shell = new THREE.Mesh(
      new THREE.SphereGeometry(0.6, 24, 16),
      MAT.turtleShell,
    );
    shell.scale.set(1.25, 0.45, 0.95);
    shell.position.y = 0.18;
    shell.castShadow = true;
    shell.receiveShadow = true;
    this.body.add(shell);

    // Belly disc — flat oval sealing the underside, lighter colour so the
    // turtle reads as having a plastron from below.
    const belly = new THREE.Mesh(new THREE.CircleGeometry(0.55, 24), MAT.turtleSkin);
    belly.rotation.x = Math.PI / 2; // face down
    belly.scale.set(1.25, 0.95, 1);
    belly.position.y = 0.08;
    belly.receiveShadow = true;
    this.body.add(belly);

    // Scale pattern — small darker patches on the carapace dome so it
    // doesn't read as a smooth ball.
    for (const [px, pz] of [[0, 0], [0.35, 0.15], [-0.35, 0.15], [0.35, -0.15], [-0.35, -0.15], [0, 0.3], [0, -0.3]] as const) {
      const patch = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        MAT.turtleShellPattern,
      );
      patch.scale.set(0.7, 0.08, 0.5);
      patch.position.set(px * 1.2, 0.45, pz);
      this.body.add(patch);
    }

    // Head + neck — capsule poking forward (+X)
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), MAT.turtleSkin);
    head.position.set(0.78, 0.15, 0);
    head.scale.set(1.1, 0.85, 0.85);
    head.castShadow = true;
    this.body.add(head);

    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.22, 10), MAT.turtleSkin);
    neck.rotation.z = -Math.PI / 2;
    neck.position.set(0.6, 0.12, 0);
    this.body.add(neck);

    // Tail — tiny cone
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), MAT.turtleSkin);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.65, 0.05, 0);
    this.body.add(tail);

    // Flippers — flat tapered shapes, 2 front (larger) + 2 rear.
    // Each flipper geometry is built to extend in local +X from a pivot at
    // the shoulder. The pivot's Y rotation then aims that local +X outward
    // (toward world +Z for the right side, -Z for the left side).
    const addFlipper = (x: number, z: number, length: number, width: number, isFront: boolean) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.05, z);
      this.body.add(pivot);

      const flipperGeo = new THREE.BoxGeometry(length, 0.06, width);
      // Pivot at the shoulder edge — geometry extends in local +X.
      flipperGeo.translate(length / 2, 0, 0);
      const mesh = new THREE.Mesh(flipperGeo, MAT.turtleSkin);
      mesh.castShadow = true;
      pivot.add(mesh);

      // Aim the local +X axis outward: z>0 -> rotate so +X becomes +Z (world).
      pivot.rotation.y = z > 0 ? -Math.PI / 2 : Math.PI / 2;

      this.flippers.push({ mesh: pivot as unknown as THREE.Mesh, phase: isFront ? 0 : Math.PI, isFront });
    };
    addFlipper(0.2, 0.5, 0.55, 0.22, true);    // front-right
    addFlipper(0.2, -0.5, 0.55, 0.22, true);   // front-left
    addFlipper(-0.35, 0.45, 0.4, 0.18, false); // rear-right
    addFlipper(-0.35, -0.45, 0.4, 0.18, false); // rear-left
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.t = (this.t + this.speed * dt) % 1;
    placeOnPath(this.object3d, this.path, this.t);

    // Flipper flap — front pair leads, rear pair follows (phase offset).
    // Flap is around the pivot's local Z axis (up/down).
    for (const f of this.flippers) {
      const baseRate = f.isFront ? 1.8 : 1.6;
      const amp = f.isFront ? 0.55 : 0.4;
      (f.mesh as unknown as THREE.Group).rotation.z = Math.sin(this.time * baseRate + f.phase) * amp;
    }

    // Subtle body roll
    this.body.rotation.z = Math.sin(this.time * 0.7) * 0.06;
  }
}
