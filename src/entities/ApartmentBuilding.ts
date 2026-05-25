import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { applyShadows } from '../world/motion';
import { worldState } from '../sim/worldState';

export interface ApartmentBuildingOptions {
  position: THREE.Vector3Tuple;
  heading?: number;
  /** Number of floors. Default 4. */
  floors?: number;
}

const FLOOR_H = 0.7;
const BODY_W = 2.0;
const BODY_D = 1.6;

/**
 * Residential tower for the lunar settlement. Windows glow at night and
 * dim during the day (residents work the dayshift outside). Exposes a
 * `doorPosition` in world space so pedestrians know where to walk to
 * "go home and sleep".
 *
 * Forward (door side) is local +X.
 */
export class ApartmentBuilding implements Entity {
  readonly object3d: THREE.Group;
  readonly doorPosition = new THREE.Vector3();
  private readonly windowMat: THREE.MeshStandardMaterial;

  constructor(opts: ApartmentBuildingOptions) {
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0xfff0a0,
      emissive: 0xffd060,
      emissiveIntensity: 0.05,
      roughness: 0.4,
      metalness: 0,
    });

    const floors = opts.floors ?? 4;
    this.object3d = this.build(floors);
    this.object3d.position.fromArray(opts.position);
    this.object3d.rotation.y = opts.heading ?? 0;

    // Compute world-space door position from local (front face, ground level).
    const localDoor = new THREE.Vector3(BODY_W / 2 + 0.25, opts.position[1], 0);
    this.object3d.updateMatrixWorld(true);
    this.doorPosition.copy(localDoor).applyMatrix4(this.object3d.matrixWorld);
  }

  update(_dt: number): void {
    const nightness = 1 - worldState.dayNess;
    this.windowMat.emissiveIntensity = 0.05 + nightness * 1.6;
  }

  private build(floors: number): THREE.Group {
    const g = new THREE.Group();
    const H = FLOOR_H * floors;

    const body = new THREE.Mesh(new THREE.BoxGeometry(BODY_W, H, BODY_D), MAT.white);
    body.position.y = H / 2;
    g.add(body);

    // Recessed entrance strip + flat roof slab
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_W + 0.2, 0.18, BODY_D + 0.2),
      MAT.grayDark,
    );
    plinth.position.y = 0.09;
    g.add(plinth);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(BODY_W + 0.1, 0.12, BODY_D + 0.1),
      MAT.grayDark,
    );
    roof.position.y = H + 0.06;
    g.add(roof);

    // Windows on the front face (+X), back face (-X), and side faces (±Z).
    const WIN_W = 0.22;
    const WIN_H = 0.28;
    const PANEL_DEPTH = 0.04;

    for (let floor = 0; floor < floors; floor++) {
      const floorY = floor * FLOOR_H + FLOOR_H * 0.55;
      // Front + back (excluding the door column on the ground floor's front).
      for (const x of [BODY_W / 2, -BODY_W / 2]) {
        const sign = x > 0 ? 1 : -1;
        for (const z of [-0.55, 0, 0.55]) {
          // Skip the centre window on the ground floor of the front to make
          // room for the door.
          if (floor === 0 && sign > 0 && z === 0) continue;
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(PANEL_DEPTH, WIN_H, WIN_W),
            this.windowMat,
          );
          win.position.set(x + sign * PANEL_DEPTH / 2, floorY, z);
          g.add(win);
        }
      }
      // Sides (±Z).
      for (const z of [-BODY_D / 2, BODY_D / 2]) {
        const sign = z > 0 ? 1 : -1;
        for (const x of [-0.55, 0, 0.55]) {
          const win = new THREE.Mesh(
            new THREE.BoxGeometry(WIN_W, WIN_H, PANEL_DEPTH),
            this.windowMat,
          );
          win.position.set(x, floorY, z + sign * PANEL_DEPTH / 2);
          g.add(win);
        }
      }
    }

    // Front door + small canopy.
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.5, 0.36),
      MAT.blueTrans,
    );
    door.position.set(BODY_W / 2 + 0.03, 0.28, 0);
    g.add(door);

    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.05, 0.5),
      MAT.grayDark,
    );
    canopy.position.set(BODY_W / 2 + 0.15, 0.6, 0);
    g.add(canopy);

    // Rooftop comms mast with a red beacon.
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.7, 6),
      MAT.gray,
    );
    mast.position.set(0.7, H + 0.42, 0);
    g.add(mast);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      MAT.redLED,
    );
    beacon.position.set(0.7, H + 0.78, 0);
    g.add(beacon);

    applyShadows(g);
    return g;
  }
}
