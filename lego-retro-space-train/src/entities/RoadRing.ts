import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { roundRectPath, roundRectShape } from '../world/shapes';
import { BASE_SIZE } from '../world/constants';

export class RoadRing implements Entity {
  readonly object3d = this.build();

  private build(): THREE.Group {
    const g = new THREE.Group();
    const outer = roundRectShape(BASE_SIZE - 0.25, 0.95);
    const inner = roundRectPath(BASE_SIZE - 1.15, 0.72);
    outer.holes.push(inner);
    const geo = new THREE.ExtrudeGeometry(outer, { depth: 0.035, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    const road = new THREE.Mesh(geo, MAT.grayDark);
    road.position.y = 0.025;
    road.receiveShadow = true;
    g.add(road);

    const stripeOuter = roundRectShape(BASE_SIZE - 0.67, 0.8);
    const stripeInner = roundRectPath(BASE_SIZE - 0.73, 0.76);
    stripeOuter.holes.push(stripeInner);
    const stripeGeo = new THREE.ExtrudeGeometry(stripeOuter, { depth: 0.018, bevelEnabled: false });
    stripeGeo.rotateX(-Math.PI / 2);
    const stripe = new THREE.Mesh(stripeGeo, MAT.yellow);
    stripe.position.y = 0.065;
    g.add(stripe);

    return g;
  }
}
