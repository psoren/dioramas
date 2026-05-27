import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { placeOnPath } from '../world/pathFollow';

export interface StingrayOptions {
  path: THREE.CatmullRomCurve3;
  speed?: number;
  t?: number;
  scale?: number;
}

/**
 * Stingray — flat diamond body gliding low over the sand. Smaller and more
 * grounded than the manta; whip-like tail trailing behind.
 *
 * Forward: +X. Wings rise/fall slowly (smaller flap amplitude than manta).
 */
export class Stingray implements Entity {
  readonly object3d: THREE.Group;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly speed: number;
  private readonly body: THREE.Group;
  private readonly leftWing: THREE.Group;
  private readonly rightWing: THREE.Group;
  private readonly tailSegments: THREE.Mesh[] = [];
  private t: number;
  private time = 0;

  constructor(opts: StingrayOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.02;
    this.t = opts.t ?? 0;
    const scale = opts.scale ?? 1;

    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(scale);
    this.object3d.add(this.body);

    // Body disc — flat oval, dark top + light belly.
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), MAT.rayTop);
    top.scale.set(1.1, 0.12, 0.75);
    top.castShadow = true;
    this.body.add(top);

    const belly = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 10), MAT.rayBelly);
    belly.scale.set(1.08, 0.11, 0.73);
    belly.position.y = -0.02;
    this.body.add(belly);

    // Wings — tapered plates extending laterally. Simpler than the manta;
    // built as triangles.
    const wingMat = (MAT.rayTop as THREE.MeshStandardMaterial).clone();
    wingMat.side = THREE.DoubleSide;
    const buildWing = (direction: -1 | 1): THREE.Group => {
      const g = new THREE.Group();
      const geo = new THREE.BufferGeometry();
      const span = 0.9;
      const chord = 0.5;
      const verts = new Float32Array([
         chord * 0.5,  0, 0,
        -chord * 0.5,  0, 0,
         0,            0, direction * span,
      ]);
      geo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      geo.setIndex([0, 1, 2, 0, 2, 1]);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, wingMat);
      mesh.castShadow = true;
      g.add(mesh);
      return g;
    };

    this.leftWing = buildWing(-1);
    this.leftWing.position.set(0, 0, -0.2);
    this.body.add(this.leftWing);

    this.rightWing = buildWing(+1);
    this.rightWing.position.set(0, 0, 0.2);
    this.body.add(this.rightWing);

    // Tail — segmented whip; the segments will be displaced sinusoidally so
    // the tail trails behind in a soft S-curve.
    const tailGeo = new THREE.SphereGeometry(0.03, 6, 5);
    const TAIL_SEGMENTS = 14;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const seg = new THREE.Mesh(tailGeo, MAT.rayTop);
      const u = i / (TAIL_SEGMENTS - 1);
      seg.position.set(-0.55 - u * 1.1, 0, 0);
      seg.scale.setScalar(1 - u * 0.8);
      seg.castShadow = true;
      this.body.add(seg);
      this.tailSegments.push(seg);
    }

    // Two tiny eyes set into the top.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.3 });
    for (const z of [-0.12, 0.12]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), eyeMat);
      eye.position.set(0.3, 0.07, z);
      this.body.add(eye);
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.t = (this.t + this.speed * dt) % 1;
    placeOnPath(this.object3d, this.path, this.t);

    // Small wing flap.
    const flap = Math.sin(this.time * 1.6) * 0.35;
    this.leftWing.rotation.x = flap;
    this.rightWing.rotation.x = -flap;

    // Tail wave — each segment offset based on its distance from the body.
    for (let i = 0; i < this.tailSegments.length; i++) {
      const u = i / (this.tailSegments.length - 1);
      const seg = this.tailSegments[i]!;
      // Side-to-side undulation, larger at the tip.
      seg.position.z = Math.sin(this.time * 2.4 - u * 4) * u * 0.18;
      seg.position.y = Math.sin(this.time * 1.8 - u * 3) * u * 0.04;
    }
  }
}
