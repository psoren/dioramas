import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { applyShadows } from '../world/motion';
import { worldState } from '../sim/worldState';

export interface SolarFarmOptions {
  position: THREE.Vector3Tuple;
  heading?: number;
  /** Rows / cols of panels. Defaults 3 × 5 = 15 panels. */
  rows?: number;
  cols?: number;
  /** Spacing between panel centres. */
  spacing?: number;
}

const PANEL_W = 0.85;
const PANEL_D = 0.55;
const PANEL_T = 0.04;
const STAND_H = 0.5;

const PANEL_MAT = new THREE.MeshStandardMaterial({
  color: 0x12244e,
  emissive: 0x0a1428,
  emissiveIntensity: 0.15,
  roughness: 0.35,
  metalness: 0.55,
});

const FRAME_MAT = new THREE.MeshStandardMaterial({
  color: 0xc8ccd2,
  roughness: 0.5,
  metalness: 0.6,
});

/**
 * Grid of solar panels that tilt to face the current sun direction. Each
 * panel pivots around its support pole — when the sun arcs across the sky
 * during the day/night cycle, the whole farm follows it. Panels stay frozen
 * at sunset (no point chasing a sun below the horizon).
 *
 * Panel surface normal points in local +Y at rest. We slerp the quaternion
 * each frame toward one that aligns +Y with `worldState.sunDir`.
 */
export class SolarFarm implements Entity {
  readonly object3d: THREE.Group;
  private readonly panels: THREE.Group[] = [];
  private readonly tempQuat = new THREE.Quaternion();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);

  constructor(opts: SolarFarmOptions) {
    const rows = opts.rows ?? 3;
    const cols = opts.cols ?? 5;
    const spacing = opts.spacing ?? 1.2;
    this.object3d = this.build(rows, cols, spacing);
    this.object3d.position.fromArray(opts.position);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  update(_dt: number): void {
    // If sun is well below horizon, don't track — panels rest pointing up.
    const sun = worldState.sunDir;
    if (sun.y < 0.05) {
      this.tempQuat.identity();
    } else {
      this.tempQuat.setFromUnitVectors(this.upAxis, sun);
    }
    for (const p of this.panels) {
      p.quaternion.slerp(this.tempQuat, 0.04);
    }
  }

  private build(rows: number, cols: number, spacing: number): THREE.Group {
    const g = new THREE.Group();
    const xOffset = -(cols - 1) * spacing * 0.5;
    const zOffset = -(rows - 1) * spacing * 0.5;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const slot = new THREE.Group();
        slot.position.set(xOffset + c * spacing, 0, zOffset + r * spacing);
        g.add(slot);

        const stand = new THREE.Mesh(
          new THREE.CylinderGeometry(0.05, 0.05, STAND_H, 8),
          MAT.grayDark,
        );
        stand.position.y = STAND_H / 2;
        slot.add(stand);

        // Pivot group at the top of the stand — the panel pivots from this.
        const pivot = new THREE.Group();
        pivot.position.y = STAND_H;
        slot.add(pivot);

        const panel = new THREE.Mesh(
          new THREE.BoxGeometry(PANEL_W, PANEL_T, PANEL_D),
          PANEL_MAT,
        );
        panel.position.y = PANEL_T / 2;
        pivot.add(panel);

        // Thin frame border so the panel reads as a real fixture.
        const frame = new THREE.Mesh(
          new THREE.BoxGeometry(PANEL_W + 0.06, PANEL_T + 0.01, PANEL_D + 0.06),
          FRAME_MAT,
        );
        frame.position.y = PANEL_T / 2 - 0.005;
        pivot.add(frame);
        // Render the dark blue panel on top by pushing the frame slightly back.
        frame.renderOrder = -1;

        this.panels.push(pivot);
      }
    }

    applyShadows(g);
    return g;
  }
}
