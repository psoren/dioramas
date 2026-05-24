import * as THREE from 'three';
import { MAT } from '../world/materials';
import { TrackVehicle, TrackVehicleOptions } from './TrackVehicle';
import { placeOnPath, wrap01 } from './PathVehicle';

export interface MonorailTrainOptions extends TrackVehicleOptions {
  /** Number of passenger/cargo cars trailing the locomotive. Defaults to 2. */
  cars?: number;
  /** Inter-car spacing in path-t units. Defaults to 0.035; reduce for shorter tracks. */
  carSpacing?: number;
}

export class MonorailTrain extends TrackVehicle {
  constructor(opts: MonorailTrainOptions) {
    super({ ...opts, yOffset: opts.yOffset ?? 0.18 });
  }

  protected build(opts: MonorailTrainOptions): THREE.Group {
    const g = new THREE.Group();
    const carCount = opts.cars ?? 2;
    const spacing = opts.carSpacing ?? 0.035;
    const cars: THREE.Group[] = [this.buildLocomotive()];
    for (let i = 0; i < carCount; i++) cars.push(this.buildPassengerCar());
    for (let i = 0; i < cars.length; i++) {
      const car = cars[i]!;
      car.userData.offset = i * spacing;
      g.add(car);
    }
    return g;
  }

  update(dt: number): void {
    const prev = this.t;
    this.t = wrap01(this.t + this.speed * dt);
    if (dt > 0 && this.speed >= 0 && this.t < prev) this.laps++;
    if (dt > 0 && this.speed < 0 && this.t > prev) this.laps++;

    this.object3d.position.set(0, 0, 0);
    this.object3d.rotation.set(0, 0, 0);
    for (const car of this.object3d.children) {
      const offset = Number(car.userData.offset ?? 0);
      placeOnPath(car, this.path, this.t - Math.sign(this.speed || 1) * offset, this.y);
    }
  }

  hasCargoSpace(): boolean {
    return this.getCargoCars().some((car) => !car.userData.cargo);
  }

  cargoCount(): number {
    return this.getCargoCars().filter((car) => car.userData.cargo).length;
  }

  loadCargo(cargo: THREE.Object3D): boolean {
    const car = this.getCargoCars().find((candidate) => !candidate.userData.cargo);
    if (!car) return false;
    car.userData.cargo = cargo;
    car.add(cargo);
    cargo.position.set(0, 0.82, 0);
    cargo.rotation.set(0, 0, 0);
    return true;
  }

  unloadCargo(): THREE.Object3D | undefined {
    const car = this.getCargoCars().find((candidate) => candidate.userData.cargo);
    return car ? this.removeCargoFromCar(car) : undefined;
  }

  /** Unload the first crate whose `userData.destinationId` matches, if any. */
  unloadCargoFor(stationId: string): THREE.Object3D | undefined {
    const car = this.getCargoCars().find(
      (candidate) => (candidate.userData.cargo as THREE.Object3D | undefined)?.userData.destinationId === stationId,
    );
    return car ? this.removeCargoFromCar(car) : undefined;
  }

  private removeCargoFromCar(car: THREE.Object3D): THREE.Object3D | undefined {
    const cargo = car.userData.cargo as THREE.Object3D | undefined;
    if (!cargo) return undefined;
    car.remove(cargo);
    car.userData.cargo = undefined;
    return cargo;
  }

  getCargoDockWorldPosition(): THREE.Vector3 {
    const car = this.getCargoCars().find((candidate) => !candidate.userData.cargo)
      ?? this.getCargoCars()[0]
      ?? this.object3d;
    return car.localToWorld(new THREE.Vector3(0, 0.82, 0));
  }

  private getCargoCars(): THREE.Object3D[] {
    return this.object3d.children.filter((car) => car.userData.cargoSlot);
  }

  private buildLocomotive(): THREE.Group {
    const g = this.buildCarShell(0.95, MAT.white);
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.36, 0.58), MAT.white);
    nose.position.set(0.6, 0.31, 0);
    nose.castShadow = true;
    g.add(nose);

    const light = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.44), MAT.yellowTrans);
    light.position.set(0.75, 0.35, 0);
    g.add(light);
    return g;
  }

  private buildPassengerCar(): THREE.Group {
    const g = this.buildCarShell(0.85, MAT.blueTrans);
    g.userData.cargoSlot = true;
    return g;
  }

  private buildCarShell(length: number, bodyMat: THREE.Material): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(length, 0.46, 0.66), bodyMat);
    body.position.y = 0.34;
    body.castShadow = true;
    g.add(body);

    const roof = new THREE.Mesh(new THREE.BoxGeometry(length * 0.72, 0.12, 0.52), MAT.white);
    roof.position.y = 0.64;
    roof.castShadow = true;
    g.add(roof);

    const bogie = new THREE.Mesh(new THREE.BoxGeometry(length * 0.65, 0.14, 0.38), MAT.grayDark);
    bogie.position.y = 0.08;
    g.add(bogie);

    const frontConn = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.14, 0.22), MAT.grayDark);
    frontConn.position.set(length / 2 + 0.05, 0.24, 0);
    g.add(frontConn);

    const rearConn = frontConn.clone();
    rearConn.position.x = -length / 2 - 0.05;
    g.add(rearConn);

    return g;
  }
}
