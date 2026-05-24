import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { CrossRouteCrossingDef } from '../world/TrackPath';
import { MonorailTrain } from './MonorailTrain';

interface TrainEntry {
  trainId: string;
  train: MonorailTrain;
  tValue: number;
}

export interface CrossRouteIntersectionOptions {
  crossing: CrossRouteCrossingDef;
  trains: TrainEntry[];
}

/**
 * Coordinates trains from DIFFERENT routes that pass through the same physical
 * point. Each train has its own `tValue` (the parameter on its route where it
 * sits at the crossing). When two or more trains approach, one gets "owner"
 * status and the others are held until the owner clears.
 *
 * Differs from `TrackController`, which assumes all trains share a route and
 * a single `tValues[]` per intersection. This one handles cross-route crossings.
 */
export class CrossRouteIntersection implements Entity {
  readonly object3d: THREE.Group;
  private readonly crossing: CrossRouteCrossingDef;
  private readonly entries: TrainEntry[];
  private readonly lights: THREE.Mesh[] = [];

  constructor(opts: CrossRouteIntersectionOptions) {
    this.crossing = opts.crossing;
    this.entries = opts.trains;
    this.object3d = this.build();
  }

  update(): void {
    const reason = `xroute:${this.crossing.id}`;

    const states = this.entries.map((entry) => ({
      entry,
      activeDistance: Math.abs(shortestDelta01(entry.train.t, entry.tValue)),
      approachDistance: forwardDelta01(entry.train.t, entry.tValue),
    }));

    const active = states
      .filter((s) => s.activeDistance < this.crossing.activeRadius)
      .sort((a, b) => a.activeDistance - b.activeDistance)[0];

    const approaching = states
      .filter((s) => s.approachDistance < this.crossing.approachDistance)
      .sort((a, b) => a.approachDistance - b.approachDistance);

    const owner = active ?? approaching[0];

    for (const s of states) {
      const inApproachZone = s.approachDistance < this.crossing.approachDistance;
      if (owner && s !== owner && inApproachZone) {
        s.entry.train.hold(reason);
      } else {
        s.entry.train.release(reason);
      }
    }

    // Visual: red lights when something owns the crossing.
    for (const light of this.lights) {
      light.visible = Boolean(owner);
    }
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const [px, py, pz] = this.crossing.position;

    const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.7), MAT.grayDark);
    base.position.set(px, py + 0.04, pz);
    base.castShadow = true;
    g.add(base);

    for (const sx of [-0.36, 0.36]) {
      const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), MAT.grayDark);
      mast.position.set(px + sx, py + 0.5, pz);
      mast.castShadow = true;
      g.add(mast);

      const light = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.06), MAT.redLED);
      light.position.set(px + sx, py + 0.95, pz);
      this.lights.push(light);
      g.add(light);
    }

    return g;
  }
}

function shortestDelta01(a: number, b: number): number {
  return (((a - b + 0.5) % 1) + 1) % 1 - 0.5;
}

function forwardDelta01(from: number, to: number): number {
  return ((to - from) % 1 + 1) % 1;
}
