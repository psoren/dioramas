import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface MorayEelOptions {
  /** World position of the eel's hole / head. */
  position: [number, number, number];
  /** Yaw (radians) — which way the head faces. 0 points along +X. */
  yaw?: number;
  /** Visual scale. Default 1. */
  scale?: number;
  /**
   * Predator that scares the eel — when within `scareRadius`, the head
   * retracts into the hole and stops snapping.
   */
  predator?: THREE.Object3D;
  scareRadius?: number;
  /**
   * "Targets" the eel hunts — moving fish/etc. When any are within
   * `huntRadius`, the eel snaps its jaw much more frequently.
   */
  prey?: THREE.Object3D[];
  huntRadius?: number;
}

/**
 * Moray eel — head poking out of a dark coral hole, with the upper and
 * lower jaws opening periodically. Body trails back into the hole and is
 * never fully exposed.
 *
 * Anatomy (forward = +X, in local space, before yaw):
 *  - Dark "hole" disc at the rear (the reef opening)
 *  - Body cylinder receding back into the hole
 *  - Tapered head capsule poking forward
 *  - Upper + lower jaw halves with a dark mouth wedge between them
 *  - Two tiny eyes
 *
 * Motion: gentle side-to-side head sway + periodic jaw open/close.
 */
export class MorayEel implements Entity {
  readonly object3d: THREE.Group;
  private readonly head: THREE.Group;
  private readonly lowerJaw: THREE.Mesh;
  private readonly upperJaw: THREE.Mesh;
  private readonly predator: THREE.Object3D | undefined;
  private readonly scareRadiusSq: number;
  private readonly prey: THREE.Object3D[];
  private readonly huntRadiusSq: number;
  private readonly worldPos = new THREE.Vector3();
  private readonly probePos = new THREE.Vector3();
  private retract = 0; // 0 = fully out, 1 = fully retracted into the hole
  private ambushTimer = 0; // counts down a forced lunge-out event
  private time = 0;
  private nextSnap: number;

  constructor(opts: MorayEelOptions) {
    const scale = opts.scale ?? 1;
    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.rotation.y = opts.yaw ?? 0;
    this.object3d.scale.setScalar(scale);
    this.predator = opts.predator;
    const sr = opts.scareRadius ?? 4;
    this.scareRadiusSq = sr * sr;
    this.prey = opts.prey ?? [];
    const hr = opts.huntRadius ?? 2.5;
    this.huntRadiusSq = hr * hr;

    // Dark "hole" disc — sits at local origin, faces forward (+X). Reads as
    // a shadowed opening in the reef behind the eel.
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.32, 18), MAT.eelHole);
    hole.rotation.y = -Math.PI / 2; // face +X
    hole.position.set(-0.05, 0, 0);
    this.object3d.add(hole);

    // Body — short cylinder receding into the hole (in -X). Most of it is
    // hidden behind the head; the head's pivot is at +X relative to the body.
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.28, 0.7, 12),
      MAT.eelSkin,
    );
    body.rotation.z = Math.PI / 2;
    body.position.set(-0.35, 0, 0);
    body.castShadow = true;
    this.object3d.add(body);

    // Head group — pivot at the body/neck so the head can sway.
    this.head = new THREE.Group();
    this.head.position.set(0, 0, 0);
    this.object3d.add(this.head);

    // Skull dome — top half of the head, eel-skin colored.
    const skull = new THREE.Mesh(
      new THREE.SphereGeometry(0.26, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.eelSkin,
    );
    skull.scale.set(1.6, 0.7, 0.85);
    skull.position.set(0.2, 0.0, 0);
    skull.castShadow = true;
    this.head.add(skull);

    // Upper jaw — slightly wider half-ellipsoid forming the top of the mouth.
    this.upperJaw = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      MAT.eelSkin,
    );
    this.upperJaw.scale.set(1.8, 0.3, 0.85);
    this.upperJaw.position.set(0.22, -0.05, 0);
    this.head.add(this.upperJaw);

    // Mouth wedge — dark interior shown between jaws when open.
    const mouth = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.08, 0.32),
      MAT.eelMouth,
    );
    mouth.position.set(0.27, -0.1, 0);
    this.head.add(mouth);

    // Lower jaw — pivots at the back of the mouth so the front drops open.
    this.lowerJaw = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 14, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      MAT.eelBelly,
    );
    // Geometry pivot at the joint (back end) — translate so the front extends
    // in +X from the pivot, then rotate about Z at that pivot.
    this.lowerJaw.scale.set(1.6, 0.25, 0.75);
    this.lowerJaw.position.set(0.22, -0.12, 0);
    this.head.add(this.lowerJaw);

    // Eyes — tiny black dots on the top of the skull, just behind the snout.
    for (const z of [-0.13, 0.13]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }),
      );
      eye.position.set(0.12, 0.12, z);
      this.head.add(eye);
    }

    // Small nostril nubs at the snout tip.
    for (const z of [-0.05, 0.05]) {
      const nostril = new THREE.Mesh(
        new THREE.SphereGeometry(0.015, 6, 4),
        MAT.eelSkin,
      );
      nostril.position.set(0.42, 0.02, z);
      this.head.add(nostril);
    }

    // Random initial offset on the snap timer so multiple eels are out of sync.
    this.nextSnap = 3 + Math.random() * 4;
  }

  /**
   * Externally triggered ambush — the eel lunges further out of the hole
   * and snaps immediately. Lasts ~1.2 seconds. Useful for the
   * EventScheduler to make the eel feel reactive rather than periodic.
   */
  ambush(): void {
    this.ambushTimer = 1.2;
    this.nextSnap = this.time; // snap right away
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Predator near? Retract. Re-emerge slowly once the threat is past.
    this.object3d.getWorldPosition(this.worldPos);
    let scared = false;
    if (this.predator) {
      this.probePos.setFromMatrixPosition(this.predator.matrixWorld);
      if (this.probePos.distanceToSquared(this.worldPos) < this.scareRadiusSq) {
        scared = true;
      }
    }
    // Ambush forces the eel further out (negative retract — pushes past
    // the default rest position).
    if (this.ambushTimer > 0) this.ambushTimer = Math.max(0, this.ambushTimer - dt);
    const ambushing = this.ambushTimer > 0;
    const retractTarget = scared ? 1 : ambushing ? -0.5 : 0;
    this.retract += (retractTarget - this.retract) * Math.min(1, dt * 2.5);

    // Prey near? Snap more aggressively.
    let huntBoost = 0;
    for (const p of this.prey) {
      this.probePos.setFromMatrixPosition(p.matrixWorld);
      if (this.probePos.distanceToSquared(this.worldPos) < this.huntRadiusSq) {
        huntBoost = 1;
        break;
      }
    }

    // Head retracts along its local -X axis (back into the hole).
    this.head.position.x = -0.55 * this.retract;
    // Sway dampens when scared.
    const swayAmp = (1 - this.retract) * 0.18;
    this.head.rotation.y = Math.sin(this.time * 0.8) * swayAmp;
    this.head.rotation.x = Math.sin(this.time * 0.5) * swayAmp * 0.3;

    // Periodic jaw snap. Boost when hunting; freeze closed when scared.
    let openAmount = 0;
    if (!scared && this.time >= this.nextSnap) {
      const sinceSnap = this.time - this.nextSnap;
      const SNAP_DUR = 0.9;
      if (sinceSnap < SNAP_DUR) {
        const u = sinceSnap / SNAP_DUR;
        openAmount = u < 0.25 ? u / 0.25
                   : u < 0.7  ? 1.0
                   : 1.0 - (u - 0.7) / 0.3;
        openAmount = Math.max(0, Math.min(1, openAmount));
      } else {
        // Hunting halves the wait; default is 4-9 s.
        const baseWait = huntBoost > 0 ? 0.6 + Math.random() * 1.4 : 4 + Math.random() * 5;
        this.nextSnap = this.time + baseWait;
      }
    }

    const jawAngle = openAmount * 0.55 * (1 - this.retract);
    this.lowerJaw.rotation.z = -jawAngle;
    this.upperJaw.rotation.z = jawAngle * 0.3;
  }
}
