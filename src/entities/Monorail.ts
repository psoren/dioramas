import * as THREE from 'three';
import { TrackVehicle, TrackVehicleOptions } from './TrackVehicle';
import { MAT } from '../world/materials';

/**
 * The white-and-trans-blue monorail pod. Forward direction is +X.
 */
export class Monorail extends TrackVehicle {
  constructor(opts: TrackVehicleOptions) {
    super(opts);
  }

  protected build(_opts: TrackVehicleOptions): THREE.Group {
    const g = new THREE.Group();

    // Front car (white)
    const front = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.55, 0.7), MAT.white);
    front.position.set(0.35, 0.32, 0);
    front.castShadow = true;
    g.add(front);

    // Nose
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.42, 0.65), MAT.white);
    nose.position.set(0.95, 0.27, 0);
    nose.castShadow = true;
    g.add(nose);

    // Headlight
    const headlight = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.12, 0.5),
      MAT.yellowTrans,
    );
    headlight.position.set(1.1, 0.32, 0);
    g.add(headlight);

    // Connector
    const conn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.2, 0.3), MAT.grayDark);
    conn.position.set(-0.3, 0.3, 0);
    g.add(conn);

    // Rear (blue trans passenger pod)
    const rear = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.65), MAT.blueTrans);
    rear.position.set(-0.75, 0.32, 0);
    rear.castShadow = true;
    g.add(rear);

    // Rear cap (white)
    const cap = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.5, 0.65), MAT.white);
    cap.position.set(-1.15, 0.32, 0);
    cap.castShadow = true;
    g.add(cap);

    // Bogies underneath
    const bogieGeo = new THREE.BoxGeometry(0.6, 0.15, 0.4);
    for (const x of [0.4, -0.85]) {
      const b = new THREE.Mesh(bogieGeo, MAT.grayDark);
      b.position.set(x, 0.05, 0);
      g.add(b);
    }

    return g;
  }
}
