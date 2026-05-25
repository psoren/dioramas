import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { roundRectShape } from '../world/shapes';
import { BASE_SIZE, BASE_CORNER_R } from '../world/constants';

export class BasePlate implements Entity {
  readonly object3d: THREE.Group;

  constructor() {
    this.object3d = this.build();
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    const shape = roundRectShape(BASE_SIZE, BASE_CORNER_R);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth: 0.45,
      bevelEnabled: true,
      bevelSize: 0.04,
      bevelThickness: 0.04,
      bevelSegments: 2,
    });
    geo.rotateX(-Math.PI / 2);
    const plate = new THREE.Mesh(geo, MAT.blue);
    plate.position.y = -0.45;
    plate.receiveShadow = true;
    plate.castShadow = true;
    g.add(plate);

    // Corner studs (LEGO bumps) — placed just inside each plate corner.
    const studGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14);
    const studOffset = BASE_SIZE - 1.2;
    const corners: Array<[number, number]> = [
      [studOffset, studOffset],
      [-studOffset, studOffset],
      [-studOffset, -studOffset],
      [studOffset, -studOffset],
    ];
    for (const [cx, cz] of corners) {
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          const m = new THREE.Mesh(studGeo, MAT.blue);
          m.position.set(
            cx - Math.sign(cx) * i * 0.6,
            0.06,
            cz - Math.sign(cz) * j * 0.6,
          );
          m.castShadow = true;
          g.add(m);
        }
      }
    }

    return g;
  }
}
