import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { WorldState } from '../world/WorldState';

export interface JellyfishOptions {
  position?: THREE.Vector3Tuple;
  /** Vertical range in world units the jelly drifts up and down through. */
  driftRange?: number;
  /** Visual scale multiplier. Default 1. */
  scale?: number;
  /** WorldState — bell emissive boosts at night. */
  worldState?: WorldState;
}

interface Tendril {
  segments: THREE.Mesh[];
  phase: number;
}

/**
 * Jellyfish. Pulses its bell, drifts vertically, drags long translucent
 * tendrils behind.
 *
 * Anatomy:
 *  - Bell: hemispheric dome, translucent pink, pulses larger/smaller on a
 *    sine that also drives vertical drift (contraction = thrust up).
 *  - Frill: a ring of small bumps around the bell rim.
 *  - Tendrils: long thin segments hanging below, drifting with phase-offset
 *    sines so each tendril bends in a different lazy curve.
 *
 * Motion: vertical sinusoidal drift (rise on bell contraction, fall on
 * relaxation), almost no horizontal motion — jellyfish are passive drifters.
 */
export class Jellyfish implements Entity {
  readonly object3d: THREE.Group;
  private readonly bell: THREE.Mesh;
  private readonly tendrils: Tendril[] = [];
  private readonly basePos: THREE.Vector3;
  private readonly driftRange: number;
  private readonly worldState: WorldState | undefined;
  private readonly bellMat: THREE.MeshStandardMaterial;
  private readonly baseEmissiveIntensity: number;
  private time = 0;

  constructor(opts: JellyfishOptions = {}) {
    this.object3d = new THREE.Group();
    this.object3d.position.fromArray(opts.position ?? [0, 6, 0]);
    this.basePos = this.object3d.position.clone();
    this.driftRange = opts.driftRange ?? 2.0;
    this.worldState = opts.worldState;
    const scale = opts.scale ?? 1;
    this.object3d.scale.setScalar(scale);

    // Bell — half sphere, translucent. Clone material so per-jelly emissive
    // can be modulated at night without affecting other jellies.
    const bellGeo = new THREE.SphereGeometry(0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    this.bellMat = (MAT.jellyfishBell as THREE.MeshStandardMaterial).clone();
    this.baseEmissiveIntensity = this.bellMat.emissiveIntensity;
    this.bell = new THREE.Mesh(bellGeo, this.bellMat);
    this.bell.scale.set(1.0, 0.85, 1.0);
    this.object3d.add(this.bell);

    // Frill — small spheres around the bell rim. Share the cloned bell
    // material so the emissive boost lights them together.
    const frillCount = 12;
    for (let i = 0; i < frillCount; i++) {
      const a = (i / frillCount) * Math.PI * 2;
      const lump = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), this.bellMat);
      lump.position.set(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5);
      this.bell.add(lump);
    }

    // Tendrils — each is a stack of small cylinders hung from the bell rim,
    // each segment offset slightly to form a curved chain that we can wiggle.
    const tendrilCount = 8;
    const segmentCount = 12;
    const segmentLen = 0.18;
    for (let i = 0; i < tendrilCount; i++) {
      const azimuth = (i / tendrilCount) * Math.PI * 2;
      const x = Math.cos(azimuth) * 0.42;
      const z = Math.sin(azimuth) * 0.42;

      const segments: THREE.Mesh[] = [];
      let parent: THREE.Object3D = this.object3d;

      // First segment hangs from the bell.
      for (let s = 0; s < segmentCount; s++) {
        const tendrilGeo = new THREE.CylinderGeometry(0.022, 0.018, segmentLen, 6);
        tendrilGeo.translate(0, -segmentLen / 2, 0);
        const seg = new THREE.Mesh(tendrilGeo, MAT.jellyfishTendril);
        if (s === 0) {
          seg.position.set(x, -0.05, z);
        } else {
          seg.position.set(0, -segmentLen, 0);
        }
        parent.add(seg);
        parent = seg;
        segments.push(seg);
      }

      this.tendrils.push({ segments, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Bell pulse — contract on the rising half of the sine, relax on the
    // falling half. This drives vertical drift: contraction pushes us up.
    const pulse = Math.sin(this.time * 1.2);
    const contracted = Math.max(0, pulse);
    const bellScaleXZ = 1 - contracted * 0.18;
    const bellScaleY = 0.85 + contracted * 0.25;
    this.bell.scale.set(bellScaleXZ, bellScaleY, bellScaleXZ);

    // Drift: integrate a velocity that's positive during contraction, slight
    // negative drag the rest of the time so we settle without floating away.
    const driftCentre = this.basePos.y;
    const targetY = driftCentre + Math.sin(this.time * 0.6) * this.driftRange * 0.5;
    this.object3d.position.y += (targetY - this.object3d.position.y) * dt * 0.8;

    // Horizontal drift carries the jelly with the current.
    if (this.worldState) {
      this.object3d.position.x += this.worldState.current.x * dt;
      this.object3d.position.z += this.worldState.current.z * dt;
    }

    // Brighten emissive at night — chromatophore glow.
    if (this.worldState) {
      const nightness = 1 - this.worldState.dayNess;
      this.bellMat.emissiveIntensity =
        this.baseEmissiveIntensity * (1 + nightness * 2.5);
    }

    // Tendril sway — each segment bends a little, additive down the chain.
    // Because segments are nested, bending one rotates everything below it,
    // which gives the natural cumulative-curve feel.
    for (const t of this.tendrils) {
      for (let s = 0; s < t.segments.length; s++) {
        const seg = t.segments[s]!;
        const phaseShift = s * 0.4 + t.phase;
        const sway = Math.sin(this.time * 1.8 + phaseShift) * 0.12;
        const drift = Math.cos(this.time * 1.1 + phaseShift) * 0.10;
        seg.rotation.x = drift;
        seg.rotation.z = sway;
      }
    }
  }
}
