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

    // Stud bumps (LEGO ratio) along the plate perimeter so the rim reads
    // as bricks, plus a denser cluster in each corner. Centre is left
    // unstudded because tracks + command centre + buildings live there.
    const studGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 14);
    const STUD_SPACING = 1.0;
    const RIM_INSET = 0.6; // stud row distance from the plate edge
    const rim = BASE_SIZE - RIM_INSET;

    const addStud = (x: number, z: number): void => {
      const m = new THREE.Mesh(studGeo, MAT.blue);
      m.position.set(x, 0.06, z);
      m.castShadow = true;
      g.add(m);
    };

    // Perimeter rim — one stud per unit along each edge.
    const steps = Math.floor(rim / STUD_SPACING);
    for (let i = -steps; i <= steps; i++) {
      const off = i * STUD_SPACING;
      // North + South edges (full row).
      addStud(off, -rim);
      addStud(off,  rim);
      // East + West edges (skip the cells already taken by the N/S row).
      if (i !== -steps && i !== steps) {
        addStud(-rim, off);
        addStud( rim, off);
      }
    }

    // Denser inner cluster at each corner (3×3 minus the corner stud).
    const clusterOffset = BASE_SIZE - 1.4;
    const corners: Array<[number, number]> = [
      [ clusterOffset,  clusterOffset],
      [-clusterOffset,  clusterOffset],
      [-clusterOffset, -clusterOffset],
      [ clusterOffset, -clusterOffset],
    ];
    for (const [cx, cz] of corners) {
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          if (i === 0 && j === 0) continue; // would coincide with rim stud
          addStud(cx - Math.sign(cx) * i * 0.7, cz - Math.sign(cz) * j * 0.7);
        }
      }
    }

    return g;
  }
}
