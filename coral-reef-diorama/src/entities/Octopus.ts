import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface OctopusOptions {
  position: [number, number, number];
  yaw?: number;
  scale?: number;
}

interface Tentacle {
  segments: THREE.Mesh[];
  baseAngle: number; // direction around the body
  phase: number;
}

/**
 * Octopus — sits on a rock. Bulbous head + 8 tapered tentacles that wave
 * in a phased sine. Body material is cloned so we can shift its colour
 * slowly over time, suggesting the famous chromatophore camouflage.
 *
 * Tentacles are built from short stacked sphere segments curved out then
 * down, like a draped octopus crawling on its prey.
 */
export class Octopus implements Entity {
  readonly object3d: THREE.Group;
  private readonly tentacles: Tentacle[] = [];
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly tentacleMat: THREE.MeshStandardMaterial;
  private readonly inkMat: THREE.MeshStandardMaterial;
  private inkPuff: THREE.Mesh | null = null;
  private inkAge = 0;
  // Relocation state — when set, the object3d.position interpolates from
  // `relocateFrom` to `relocateTo` over `relocateDuration`.
  private relocateFrom: THREE.Vector3 | null = null;
  private relocateTo: THREE.Vector3 | null = null;
  private relocateT = 0;
  private relocateDuration = 0;
  private time = 0;

  constructor(opts: OctopusOptions) {
    const scale = opts.scale ?? 1;

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.rotation.y = opts.yaw ?? 0;
    this.object3d.scale.setScalar(scale);

    // Clone so the slow colour shift is per-instance.
    this.bodyMat = (MAT.octopusBody as THREE.MeshStandardMaterial).clone();
    this.tentacleMat = (MAT.octopusBody as THREE.MeshStandardMaterial).clone();

    // Ink-puff material — dark cloud, transparent + additive-off so it
    // occludes rather than glows.
    this.inkMat = new THREE.MeshStandardMaterial({
      color: 0x0a0c1a,
      transparent: true,
      opacity: 0.6,
      roughness: 1.0,
      depthWrite: false,
    });

    // Head/mantle — bulbous teardrop.
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 12), this.bodyMat);
    head.scale.set(1, 1.15, 1);
    head.position.y = 0.55;
    head.castShadow = true;
    this.object3d.add(head);

    // Eyes — two small dark spheres on the front of the mantle.
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x101010, roughness: 0.3 });
    for (const x of [-0.18, 0.18]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), eyeMat);
      eye.position.set(x, 0.55, 0.32);
      this.object3d.add(eye);
    }
    // Eye lids — small hemispheres in body colour above each eye for the
    // signature "horned" octopus look.
    for (const x of [-0.18, 0.18]) {
      const lid = new THREE.Mesh(
        new THREE.SphereGeometry(0.09, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        this.bodyMat,
      );
      lid.position.set(x, 0.65, 0.28);
      lid.scale.set(1, 0.7, 1);
      this.object3d.add(lid);
    }

    // 8 tentacles. Each is a stack of small spheres that curve outward
    // along a sine path. Their pivot is at the underside of the mantle.
    const TENTACLE_COUNT = 8;
    const SEGMENTS = 8;
    const tentacleGeo = new THREE.SphereGeometry(0.085, 8, 6);
    for (let t = 0; t < TENTACLE_COUNT; t++) {
      const baseAngle = (t / TENTACLE_COUNT) * Math.PI * 2;
      const dirX = Math.cos(baseAngle);
      const dirZ = Math.sin(baseAngle);
      const segs: THREE.Mesh[] = [];
      for (let s = 0; s < SEGMENTS; s++) {
        const u = s / (SEGMENTS - 1);
        const seg = new THREE.Mesh(tentacleGeo, this.tentacleMat);
        // Spread outward from the body and curve down toward the substrate.
        const r = 0.32 + u * 0.55;
        const x = dirX * r;
        const z = dirZ * r;
        // y curves from mantle base (~0.3) downward to ~0.05 at the tip.
        const y = 0.32 - u * u * 0.3;
        seg.position.set(x, y, z);
        seg.scale.setScalar(1 - u * 0.55);
        seg.castShadow = true;
        this.object3d.add(seg);
        segs.push(seg);
      }
      this.tentacles.push({ segments: segs, baseAngle, phase: Math.random() * Math.PI * 2 });
    }
  }

  /**
   * Jet to a new position, dropping an ink puff at the old one. Position
   * lerps over `duration` seconds.
   */
  relocate(target: [number, number, number], duration = 2.4): void {
    this.relocateFrom = this.object3d.position.clone();
    this.relocateTo = new THREE.Vector3(target[0], target[1], target[2]);
    this.relocateT = 0;
    this.relocateDuration = duration;

    // Drop an ink puff at the current position — added to the parent scene
    // via the object3d's parent so it persists once we move on.
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), this.inkMat.clone());
    puff.position.copy(this.object3d.position);
    puff.scale.setScalar(0.4);
    this.object3d.parent?.add(puff);
    this.inkPuff = puff;
    this.inkAge = 0;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Relocation interpolation — quadratic ease-in-out along a slight arc.
    if (this.relocateTo && this.relocateFrom) {
      this.relocateT += dt / this.relocateDuration;
      const t = Math.min(1, this.relocateT);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
      this.object3d.position.lerpVectors(this.relocateFrom, this.relocateTo, e);
      // Slight upward arc.
      this.object3d.position.y += Math.sin(t * Math.PI) * 0.4;
      if (t >= 1) {
        this.relocateFrom = null;
        this.relocateTo = null;
      }
    }

    // Ink puff fade — grow + dissipate over ~3s.
    if (this.inkPuff) {
      this.inkAge += dt;
      const u = this.inkAge / 3;
      this.inkPuff.scale.setScalar(0.4 + u * 1.4);
      const mat = this.inkPuff.material as THREE.MeshStandardMaterial;
      mat.opacity = 0.6 * Math.max(0, 1 - u);
      if (u >= 1) {
        this.inkPuff.parent?.remove(this.inkPuff);
        mat.dispose();
        (this.inkPuff.geometry as THREE.BufferGeometry).dispose();
        this.inkPuff = null;
      }
    }

    // Tentacle wave — each tentacle has its own phase; each segment lags
    // the previous so the wave travels outward along the limb.
    for (const tnt of this.tentacles) {
      const dirX = Math.cos(tnt.baseAngle);
      const dirZ = Math.sin(tnt.baseAngle);
      const perpX = -dirZ;
      const perpZ = dirX;
      for (let s = 0; s < tnt.segments.length; s++) {
        const u = s / (tnt.segments.length - 1);
        const wave = Math.sin(this.time * 1.6 + tnt.phase - u * 2.2) * u * 0.18;
        // Push the segment perpendicular to its outward direction, plus a
        // small vertical undulation so the limb feels boneless.
        const seg = tnt.segments[s]!;
        const r = 0.32 + u * 0.55;
        seg.position.x = dirX * r + perpX * wave;
        seg.position.z = dirZ * r + perpZ * wave;
        seg.position.y = (0.32 - u * u * 0.3) + Math.sin(this.time * 1.6 + tnt.phase + u * 3) * 0.04 * u;
      }
    }

    // Slow chromatophore colour shift — pink/red -> purple -> orange, ~30s cycle.
    const hue = 0.93 + Math.sin(this.time * 0.05) * 0.08; // around pink
    const sat = 0.55;
    const light = 0.45 + Math.sin(this.time * 0.03) * 0.1;
    this.bodyMat.color.setHSL(((hue % 1) + 1) % 1, sat, light);
    this.tentacleMat.color.copy(this.bodyMat.color);
  }
}
