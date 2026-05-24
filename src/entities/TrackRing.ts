import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TRACK_Y } from '../world/constants';
import { TrackRoute, getTrackRoute } from '../world/TrackPath';

const TRACK_DECK_MAT = MAT.gray.clone();
TRACK_DECK_MAT.side = THREE.DoubleSide;

const TRACK_RAIL_MAT = MAT.grayDark.clone();
TRACK_RAIL_MAT.side = THREE.DoubleSide;

export interface TrackRingOptions {
  routeId?: string;
}

export class TrackRing implements Entity {
  readonly object3d: THREE.Group;
  private readonly route: TrackRoute;

  constructor(opts: TrackRingOptions = {}) {
    this.route = getTrackRoute(opts.routeId);
    this.object3d = this.build();
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const samples = 160;
    const deckGeo = buildTrackStrip(this.route.path, samples, 0.78, TRACK_Y, 0);
    const deck = new THREE.Mesh(deckGeo, TRACK_DECK_MAT);
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    for (const offset of [-0.24, 0.24]) {
      const railGeo = buildTrackStrip(this.route.path, samples, 0.08, TRACK_Y + 0.075, offset);
      const rail = new THREE.Mesh(railGeo, TRACK_RAIL_MAT);
      rail.castShadow = true;
      g.add(rail);
    }

    for (let i = 0; i < samples; i += 12) {
      const a = this.route.path.getPointAt(i / samples);
      if (a.y > 0.22) {
        const supportHeight = a.y + TRACK_Y;
        const support = new THREE.Mesh(
          new THREE.BoxGeometry(0.16, supportHeight, 0.16),
          MAT.blueDark,
        );
        support.position.set(a.x, supportHeight / 2, a.z);
        support.castShadow = true;
        g.add(support);

        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.12, 0.48), MAT.blue);
        foot.position.set(a.x, 0.06, a.z);
        foot.castShadow = true;
        g.add(foot);
      }
    }

    return g;
  }
}

function buildTrackStrip(
  path: THREE.CatmullRomCurve3,
  samples: number,
  width: number,
  yOffset: number,
  lateralOffset: number,
): THREE.BufferGeometry {
  const vertices: number[] = [];
  const indices: number[] = [];

  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const pos = path.getPointAt(t);
    const tan = path.getTangentAt(t).normalize();
    const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
    const center = pos.clone().add(side.clone().multiplyScalar(lateralOffset));
    const left = center.clone().add(side.clone().multiplyScalar(width / 2));
    const right = center.clone().add(side.clone().multiplyScalar(-width / 2));

    vertices.push(left.x, left.y + yOffset, left.z, right.x, right.y + yOffset, right.z);

    if (i < samples) {
      const a = i * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}
