import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { placeOnPath } from '../world/pathFollow';
import { WorldState } from '../world/WorldState';

export interface PatrolSharkOptions {
  path: THREE.CatmullRomCurve3;
  speed?: number;
  t?: number;
  scale?: number;
  /** WorldState — read for hunt-mode speed multiplier. */
  worldState?: WorldState;
}

/**
 * Patrol shark. Slow, ominous loop on a closed Catmull-Rom path.
 *
 * Anatomy (forward = +X):
 *  - Streamlined elongated body — gray top, light belly
 *  - Dorsal fin (top)
 *  - Two pectoral fins angled outward
 *  - Tall caudal (tail) fin that wags as a sine of time
 *  - Small pelvic + anal fins for silhouette
 *
 * Motion: forward translation along the path + tail wag + subtle body yaw
 * that follows the tail so the swim looks driven by the tail, not floating.
 */
export class PatrolShark implements Entity {
  readonly object3d: THREE.Group;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly speed: number;
  private readonly body: THREE.Group;
  private readonly tail: THREE.Group;
  private readonly worldState: WorldState | undefined;
  private t: number;
  private time = 0;

  constructor(opts: PatrolSharkOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.02;
    this.t = opts.t ?? 0;
    this.worldState = opts.worldState;
    const scale = opts.scale ?? 1;

    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(scale);
    this.object3d.add(this.body);

    // --- Main body: stretched ellipsoid, gray top + light belly halves.
    // Two stacked half-spheres avoid a visible seam between top and belly.
    // Lengthened (x = 3.2) so the head tapers naturally to a point — no
    // separate snout cone, which previously stuck out wider than the body
    // at the join and read as a beak.
    const bodyTop = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 22, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.sharkGray,
    );
    bodyTop.scale.set(3.2, 0.55, 0.7);
    bodyTop.castShadow = true;
    this.body.add(bodyTop);

    const bodyBottom = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 22, 14, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2),
      MAT.sharkBelly,
    );
    bodyBottom.scale.set(3.2, 0.55, 0.7);
    bodyBottom.castShadow = true;
    this.body.add(bodyBottom);

    // Eyes — tiny dark dots sitting on the head's flank, slightly forward
    // of the body's midpoint. Tucked against the body so they sit flush.
    for (const z of [-0.18, 0.18]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 8, 6),
        new THREE.MeshStandardMaterial({ color: 0x0a0a0a, roughness: 0.3 }),
      );
      eye.position.set(1.05, 0.1, z);
      this.body.add(eye);
    }

    // Mouth slit — a thin dark crescent set into the underside of the head.
    // Curved by sitting a thin torus segment flush with the belly contour.
    const mouthGeo = new THREE.TorusGeometry(0.18, 0.022, 6, 18, Math.PI);
    const mouthMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.6 });
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.rotation.x = Math.PI / 2; // lay flat
    mouth.rotation.z = Math.PI; // arc opens forward
    mouth.scale.set(1.1, 1, 0.7); // slim crescent
    mouth.position.set(1.2, -0.13, 0);
    this.body.add(mouth);

    // Gill slits — three short dark lines on each flank, just behind the eye.
    const gillMat = new THREE.MeshStandardMaterial({ color: 0x2a2e34, roughness: 0.7 });
    for (const z of [-0.21, 0.21]) {
      for (let g = 0; g < 3; g++) {
        const gill = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.18, 0.01), gillMat);
        gill.position.set(0.55 - g * 0.12, 0.0, z);
        this.body.add(gill);
      }
    }

    // Dorsal fin — classic triangular shark fin, leaning slightly back.
    const dorsalGeo = new THREE.BufferGeometry();
    dorsalGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0.3, 0, 0,    // front-base
          -0.5, 0, 0,   // back-base
          -0.25, 0.6, 0, // tip (leaning back)
        ],
        3,
      ),
    );
    dorsalGeo.setIndex([0, 1, 2, 0, 2, 1]); // both sides
    dorsalGeo.computeVertexNormals();
    const dorsalMat = (MAT.sharkGray as THREE.MeshStandardMaterial).clone();
    dorsalMat.side = THREE.DoubleSide;
    const dorsal = new THREE.Mesh(dorsalGeo, dorsalMat);
    dorsal.position.set(0.05, 0.28, 0);
    dorsal.castShadow = true;
    this.body.add(dorsal);

    // Pectoral fins — flat triangles, one per side, angled outward + down.
    const pecGeo = new THREE.BufferGeometry();
    pecGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0.15, 0, 0,    // front-root
          -0.2, 0, 0,    // back-root
          -0.1, 0, 0.7,  // tip (out to +Z)
        ],
        3,
      ),
    );
    pecGeo.setIndex([0, 1, 2, 0, 2, 1]);
    pecGeo.computeVertexNormals();
    const pecMat = (MAT.sharkGray as THREE.MeshStandardMaterial).clone();
    pecMat.side = THREE.DoubleSide;

    const pecRight = new THREE.Mesh(pecGeo, pecMat);
    pecRight.position.set(0.5, -0.05, 0.25);
    pecRight.rotation.x = -0.25; // tip droops
    pecRight.castShadow = true;
    this.body.add(pecRight);

    const pecLeft = new THREE.Mesh(pecGeo, pecMat);
    pecLeft.position.set(0.5, -0.05, -0.25);
    pecLeft.rotation.x = 0.25;
    pecLeft.scale.z = -1; // mirror to -Z
    pecLeft.castShadow = true;
    this.body.add(pecLeft);

    // Pelvic fins — smaller, further back.
    const pelvicGeo = pecGeo.clone();
    pelvicGeo.scale(0.55, 1, 0.55);
    const pelvicRight = new THREE.Mesh(pelvicGeo, pecMat);
    pelvicRight.position.set(-0.85, -0.18, 0.18);
    pelvicRight.rotation.x = -0.3;
    this.body.add(pelvicRight);
    const pelvicLeft = new THREE.Mesh(pelvicGeo, pecMat);
    pelvicLeft.position.set(-0.85, -0.18, -0.18);
    pelvicLeft.rotation.x = 0.3;
    pelvicLeft.scale.z = -1;
    this.body.add(pelvicLeft);

    // Anal fin — tiny ventral fin near the tail.
    const anal = new THREE.Mesh(dorsalGeo.clone(), dorsalMat);
    anal.position.set(-1.35, -0.22, 0);
    anal.scale.set(0.4, -0.35, 0.4); // flip downward
    this.body.add(anal);

    // Tail — a pivot at the body's rear hub so the whole caudal fin can wag.
    this.tail = new THREE.Group();
    this.tail.position.set(-1.55, 0, 0);
    this.body.add(this.tail);

    // Caudal fin — taller upper lobe + shorter lower lobe (heterocercal).
    const caudalGeo = new THREE.BufferGeometry();
    caudalGeo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          // Upper lobe
          0.1, 0, 0,
          -0.45, 0.75, 0,
          -0.55, 0.1, 0,
          // Lower lobe
          0.1, 0, 0,
          -0.5, -0.35, 0,
          -0.55, -0.05, 0,
        ],
        3,
      ),
    );
    caudalGeo.setIndex([0, 1, 2, 0, 2, 1, 3, 4, 5, 3, 5, 4]);
    caudalGeo.computeVertexNormals();
    const caudal = new THREE.Mesh(caudalGeo, dorsalMat);
    caudal.castShadow = true;
    this.tail.add(caudal);

    // Caudal peduncle — thin connector between body and tail.
    const peduncle = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.08, 0.35, 8),
      MAT.sharkGray,
    );
    peduncle.rotation.z = Math.PI / 2;
    peduncle.position.set(0.18, 0, 0);
    this.tail.add(peduncle);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Speed multiplier from active hunt event — shark surges along its path.
    const ws = this.worldState;
    const huntMul = ws ? ws.sharkHunt.speedMultiplier : 1;
    this.t = (this.t + this.speed * huntMul * dt) % 1;
    placeOnPath(this.object3d, this.path, this.t);

    // Tail wag — left/right around Y at the peduncle pivot. Wags faster
    // when hunting (driving the speed surge).
    const wagRate = 2.4 * huntMul;
    const wag = Math.sin(this.time * wagRate);
    this.tail.rotation.y = wag * Math.min(0.7, 0.55 * huntMul);

    // Body counter-yaw — small, lagging so it reads as driven by the tail.
    this.body.rotation.y = -Math.sin(this.time * wagRate - 0.6) * 0.08 * huntMul;
  }
}
