import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export interface MicroAstronautOptions {
  position: THREE.Vector3Tuple;
  heading?: number;
}

export class MicroAstronaut implements Entity {
  readonly object3d: THREE.Group;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private phase = 0;

  constructor(opts: MicroAstronautOptions) {
    const built = this.build();
    this.object3d = built.group;
    this.armL = built.armL;
    this.armR = built.armR;
    this.object3d.position.fromArray(opts.position);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  update(dt: number): void {
    this.phase += dt * 2.8;
    const wave = Math.sin(this.phase) * 0.35;
    this.armL.rotation.z = 0.25 + wave;
    this.armR.rotation.z = -0.25 - wave * 0.5;
  }

  private build(): { group: THREE.Group; armL: THREE.Mesh; armR: THREE.Mesh } {
    const g = new THREE.Group();

    const legs = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.16), MAT.white);
    legs.position.y = 0.13;
    legs.castShadow = true;
    g.add(legs);

    const torso = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.32, 0.18), MAT.white);
    torso.position.y = 0.42;
    torso.castShadow = true;
    g.add(torso);

    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.04), MAT.blueTrans);
    visor.position.set(0, 0.67, 0.11);
    g.add(visor);

    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 10), MAT.white);
    helmet.position.y = 0.68;
    helmet.castShadow = true;
    g.add(helmet);

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.28, 0.08), MAT.gray);
    pack.position.set(0, 0.45, -0.14);
    pack.castShadow = true;
    g.add(pack);

    const armGeo = new THREE.BoxGeometry(0.08, 0.28, 0.08);
    const armL = new THREE.Mesh(armGeo, MAT.white);
    armL.position.set(-0.2, 0.43, 0);
    armL.castShadow = true;
    g.add(armL);

    const armR = new THREE.Mesh(armGeo, MAT.white);
    armR.position.set(0.2, 0.43, 0);
    armR.castShadow = true;
    g.add(armR);

    const logo = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.02), MAT.redLED);
    logo.position.set(0, 0.45, 0.1);
    g.add(logo);

    return { group: g, armL, armR };
  }
}
