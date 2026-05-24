import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { roundRectShape, roundRectPath } from '../world/shapes';
import {
  TRACK_OUTER,
  TRACK_INNER,
  TRACK_CORNER_R_OUT,
  TRACK_CORNER_R_IN,
  TRACK_Y,
} from '../world/constants';

export class TrackRing implements Entity {
  readonly object3d: THREE.Group;

  constructor() {
    this.object3d = this.build();
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Main gray track surface
    const outer = roundRectShape(TRACK_OUTER, TRACK_CORNER_R_OUT);
    const inner = roundRectPath(TRACK_INNER, TRACK_CORNER_R_IN);
    outer.holes.push(inner);

    const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.10, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(geo, MAT.gray);
    ring.position.y = TRACK_Y;
    ring.receiveShadow = true;
    ring.castShadow = true;
    g.add(ring);

    // Inner rail strip (subtle darker line along the centerline)
    const railSize = (TRACK_OUTER + TRACK_INNER) / 2;
    const railHW = 0.06;
    const railOuter = roundRectShape(railSize + railHW, 0.85);
    const railInner = roundRectPath(railSize - railHW, 0.85);
    railOuter.holes.push(railInner);
    const railGeo = new THREE.ExtrudeGeometry(railOuter, {
      depth: 0.04,
      bevelEnabled: false,
    });
    railGeo.rotateX(-Math.PI / 2);
    const rail = new THREE.Mesh(railGeo, MAT.grayDark);
    rail.position.y = TRACK_Y + 0.105;
    g.add(rail);

    return g;
  }
}
