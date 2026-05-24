import * as THREE from 'three';
import { MAT } from '../world/materials';
import { PathVehicle, PathVehicleOptions } from './PathVehicle';

export class SpaceTruck extends PathVehicle {
  constructor(opts: PathVehicleOptions) {
    super({ ...opts, y: opts.y ?? 0.04 });
  }

  protected build(_opts: PathVehicleOptions): THREE.Group {
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

    const cargo = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.18, 0.3), MAT.yellow);
    cargo.position.set(-0.34, 0.64, 0);
    cargo.castShadow = true;
    g.add(cargo);

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
    super.update(dt);
    const spin = dt * this.speed * 70;
    this.object3d.traverse((child) => {
      if (child.userData.wheel) child.rotation.z -= spin;
    });
  }
}
