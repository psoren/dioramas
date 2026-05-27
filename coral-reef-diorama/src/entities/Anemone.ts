import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { WorldState } from '../world/WorldState';

export interface AnemoneOptions {
  position?: THREE.Vector3Tuple;
  /** 'pink' (default), 'green'. Drives the tendril material. */
  variant?: 'pink' | 'green';
  /** Number of tendrils. Default 24. */
  tendrils?: number;
  /** Visual scale multiplier. Default 1. */
  scale?: number;
  /** WorldState — anemones close at night and lean with current. */
  worldState?: WorldState;
}

interface Tendril {
  mesh: THREE.Mesh;
  phase: number;     // sin phase offset
  amplitude: number; // radians of sway
  baseTilt: number;  // resting tilt (rad)
  azimuth: number;   // around-the-stem angle
}

/**
 * A sea anemone — squat base disc plus a ring of soft tendrils, each swaying
 * via sin(time + phaseOffset). Tendrils tilt slightly outward at rest and
 * sway around that resting tilt — should look like underwater drift, not
 * windshield-wiper motion.
 */
export class Anemone implements Entity {
  readonly object3d: THREE.Group;
  private readonly tendrils: Tendril[] = [];
  private readonly worldState: WorldState | undefined;
  private time = 0;

  constructor(opts: AnemoneOptions = {}) {
    this.worldState = opts.worldState;
    const scale = opts.scale ?? 1;
    const tendrilCount = opts.tendrils ?? 24;
    const tendrilMat = opts.variant === 'green' ? MAT.anemoneTendrilGreen : MAT.anemoneTendril;

    this.object3d = new THREE.Group();
    this.object3d.position.fromArray(opts.position ?? [0, 0, 0]);
    this.object3d.scale.setScalar(scale);

    // Base disc — squat lumpy cylinder.
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.32, 16), MAT.anemoneBase);
    base.position.y = 0.16;
    base.castShadow = true;
    base.receiveShadow = true;
    this.object3d.add(base);

    // Ring of tendrils
    const tendrilGeo = new THREE.CylinderGeometry(0.035, 0.06, 1.1, 6);
    // Pivot the geometry so y=0 is the base of the tendril, not its centre.
    tendrilGeo.translate(0, 0.55, 0);

    for (let i = 0; i < tendrilCount; i++) {
      const azimuth = (i / tendrilCount) * Math.PI * 2;
      const ring = i % 3;
      // Inner ring stands tall, outer ring leans further out.
      const baseTilt = 0.05 + ring * 0.18;
      const radius = 0.15 + ring * 0.18;

      const mesh = new THREE.Mesh(tendrilGeo, tendrilMat);
      mesh.castShadow = true;
      mesh.position.set(Math.cos(azimuth) * radius, 0.3, Math.sin(azimuth) * radius);
      mesh.rotation.set(0, -azimuth, 0);

      this.object3d.add(mesh);
      this.tendrils.push({
        mesh,
        phase: Math.random() * Math.PI * 2,
        amplitude: 0.12 + Math.random() * 0.08,
        baseTilt,
        azimuth,
      });
    }
  }

  update(dt: number): void {
    this.time += dt;
    const ws = this.worldState;
    // Close at night — multiply outward lean by dayNess so tendrils stand
    // upright in the dark.
    const openness = ws ? 0.25 + 0.75 * ws.dayNess : 1;
    const curX = ws ? ws.current.x : 0;
    const curZ = ws ? ws.current.z : 0;
    for (const t of this.tendrils) {
      const sway = Math.sin(this.time * 1.4 + t.phase) * t.amplitude;
      const drift = Math.cos(this.time * 0.8 + t.phase * 1.3) * t.amplitude * 0.6;
      // Current bias: a constant tilt component in the current direction so
      // the whole anemone leans downstream.
      t.mesh.rotation.x = Math.cos(t.azimuth) * t.baseTilt * openness + drift + curZ * 0.6;
      t.mesh.rotation.z = Math.sin(t.azimuth) * t.baseTilt * openness + sway - curX * 0.6;
    }
  }
}
