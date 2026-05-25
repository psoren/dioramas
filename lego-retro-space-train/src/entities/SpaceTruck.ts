import * as THREE from 'three';
import { MAT } from '../world/materials';
import { PathVehicle, PathVehicleOptions } from './PathVehicle';
import { buildContainer } from '../world/figures';
import { emit } from '../sim/EventBus';

export interface CargoStop {
  /** Path parameter t in [0,1) where the truck should stop. */
  t: number;
  /** What to do at this stop. */
  action: 'load' | 'unload';
  /** Human label used in HUD/event-bus messages. */
  label?: string;
}

export interface SpaceTruckOptions extends PathVehicleOptions {
  /** Optional cargo behaviour — t-positions to pause + toggle a visible container. */
  cargoStops?: CargoStop[];
  /** Initial cargo state. Default false (empty). */
  startWithCargo?: boolean;
  /** Material for the cargo container shown on the bed. */
  cargoMaterial?: THREE.Material;
}

const STOP_DURATION = 2.0;

export class SpaceTruck extends PathVehicle {
  private cargoMesh!: THREE.Mesh;
  private cargoStops: CargoStop[] = [];
  private cargoLoaded = false;
  private stopTimer = 0;

  constructor(opts: SpaceTruckOptions) {
    super({ ...opts, y: opts.y ?? 0.04 });
    this.cargoStops = opts.cargoStops ?? [];
    this.cargoLoaded = opts.startWithCargo ?? false;
    this.cargoMesh.visible = this.cargoLoaded;
  }

  protected build(opts: SpaceTruckOptions): THREE.Group {
    const g = new THREE.Group();

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.52), MAT.grayDark);
    chassis.position.y = 0.2;
    chassis.castShadow = true;
    g.add(chassis);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.5), MAT.white);
    cab.position.set(0.24, 0.52, 0);
    cab.castShadow = true;
    g.add(cab);

    const windscreen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.23, 0.42), MAT.blueTrans);
    windscreen.position.set(0.46, 0.57, 0);
    g.add(windscreen);

    const bed = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.2, 0.46), MAT.blue);
    bed.position.set(-0.26, 0.43, 0);
    bed.castShadow = true;
    g.add(bed);

    // Cargo container — visibility toggled by load/unload stops.
    this.cargoMesh = buildContainer(opts.cargoMaterial ?? MAT.yellow);
    this.cargoMesh.position.set(-0.26, 0.73, 0);
    g.add(this.cargoMesh);

    const wheelGeo = new THREE.CylinderGeometry(0.13, 0.13, 0.09, 16);
    for (const x of [-0.32, 0.32]) {
      for (const z of [-0.31, 0.31]) {
        const wheel = new THREE.Mesh(wheelGeo, MAT.black);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.16, z);
        wheel.castShadow = true;
        wheel.userData.wheel = true;
        g.add(wheel);
      }
    }

    return g;
  }

  update(dt: number): void {
    // Tick the stop timer first so release happens before we move.
    if (this.stopTimer > 0) {
      this.stopTimer -= dt;
      if (this.stopTimer <= 0) this.release('cargo-stop');
    }

    const prevT = this.t;
    super.update(dt);

    // After moving, see if we crossed any cargo-stop's t this tick.
    if (this.stopTimer <= 0 && this.cargoStops.length > 0) {
      for (const stop of this.cargoStops) {
        if (!crossedT(prevT, this.t, stop.t)) continue;
        const wantsLoaded = stop.action === 'load';
        if (this.cargoLoaded === wantsLoaded) continue;
        this.hold('cargo-stop');
        this.stopTimer = STOP_DURATION;
        this.cargoLoaded = wantsLoaded;
        this.cargoMesh.visible = wantsLoaded;
        emit(
          stop.action === 'load' ? 'cargo-loaded' : 'cargo-delivered',
          `${stop.action === 'load' ? 'Loaded' : 'Delivered'} at ${stop.label ?? 'depot'}`,
        );
        break;
      }
    }

    const spin = dt * this.speed * 70;
    this.object3d.traverse((child) => {
      if (child.userData.wheel) child.rotation.z -= spin;
    });
  }
}

/** True iff the interval (prev, curr] (advancing along [0,1) with wrap) contains target. */
function crossedT(prev: number, curr: number, target: number): boolean {
  if (curr >= prev) return prev < target && target <= curr;
  // wrapped past 1.0
  return target > prev || target <= curr;
}
