import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TRACK_INNER, TRACK_OUTER } from '../world/constants';

export interface StationPlatformOptions {
  position?: THREE.Vector3Tuple;
  heading?: number;
}

export class StationPlatform implements Entity {
  readonly object3d: THREE.Group;

  constructor(private readonly opts: StationPlatformOptions = {}) {
    this.object3d = this.build();
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const fallbackX = -((TRACK_OUTER + TRACK_INNER) / 2);
    g.position.fromArray(this.opts.position ?? [fallbackX, 0.32, 2.35]);
    g.rotation.y = this.opts.heading ?? 0;

    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.55), MAT.gray);
    deck.position.y = 0;
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    const lip = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.12), MAT.yellow);
    lip.position.set(0, 0.15, -0.78);
    lip.castShadow = true;
    g.add(lip);

    for (const sx of [-0.7, 0.7]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.12), MAT.grayDark);
      post.position.set(sx, 0.48, 0.65);
      post.castShadow = true;
      g.add(post);
    }

    const rail = new THREE.Mesh(new THREE.BoxGeometry(1.65, 0.11, 0.12), MAT.grayDark);
    rail.position.set(0, 0.83, 0.65);
    rail.castShadow = true;
    g.add(rail);

    const console = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.34, 0.2), MAT.blueDark);
    console.position.set(-0.45, 0.35, 0.63);
    console.castShadow = true;
    g.add(console);

    for (const [i, mat] of [MAT.greenLED, MAT.redLED, MAT.yellowTrans].entries()) {
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.03), mat);
      light.position.set(-0.64 + i * 0.18, 0.45, 0.74);
      g.add(light);
    }

    return g;
  }
}
