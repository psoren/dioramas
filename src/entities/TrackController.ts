import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TrackIntersectionDef, getTrackRoute } from '../world/TrackPath';
import { MonorailTrain } from './MonorailTrain';

export interface TrackControllerOptions {
  routeId?: string;
  trains: MonorailTrain[];
}

export class TrackController implements Entity {
  readonly object3d: THREE.Group;
  private readonly intersections: TrackIntersectionDef[];

  constructor(private readonly opts: TrackControllerOptions) {
    this.intersections = getTrackRoute(opts.routeId).intersections;
    this.object3d = this.build();
  }

  update(): void {
    for (const intersection of this.intersections) {
      this.updateIntersection(intersection);
    }
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    for (const intersection of this.intersections) {
      const pos = new THREE.Vector3().fromArray(intersection.position);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.08, 0.6), MAT.grayDark);
      base.position.set(pos.x, pos.y + 0.08, pos.z);
      base.castShadow = true;
      g.add(base);

      for (const sx of [-0.32, 0.32]) {
        const mast = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.08), MAT.grayDark);
        mast.position.set(pos.x + sx, pos.y + 0.42, pos.z + 0.32);
        mast.castShadow = true;
        g.add(mast);

        const light = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.05), MAT.redLED);
        light.position.set(pos.x + sx, pos.y + 0.75, pos.z + 0.38);
        light.userData.intersectionId = intersection.id;
        g.add(light);
      }
    }
    return g;
  }

  private updateIntersection(intersection: TrackIntersectionDef): void {
    const reason = `intersection:${intersection.id}`;
    const trains = this.opts.trains;
    const states = trains.map((train) => ({
      train,
      activeDistance: nearestAbsDistance(train.t, intersection.tValues),
      approachDistance: nearestForwardDistance(train.t, intersection.tValues),
    }));

    const active = states
      .filter((state) => state.activeDistance < intersection.activeRadius)
      .sort((a, b) => a.activeDistance - b.activeDistance)[0];
    const approaching = states
      .filter((state) => state.approachDistance < intersection.approachDistance)
      .sort((a, b) => a.approachDistance - b.approachDistance);
    const owner = active ?? approaching[0];

    for (const state of states) {
      if (owner && state !== owner && state.approachDistance < intersection.approachDistance) {
        state.train.hold(reason);
      } else {
        state.train.release(reason);
      }
    }

    for (const child of this.object3d.children) {
      if (child.userData.intersectionId === intersection.id) {
        child.visible = Boolean(owner);
      }
    }
  }
}

function nearestAbsDistance(t: number, tValues: number[]): number {
  return Math.min(...tValues.map((value) => Math.abs(shortestDelta01(t, value))));
}

function nearestForwardDistance(t: number, tValues: number[]): number {
  return Math.min(...tValues.map((value) => forwardDelta01(t, value)));
}

function shortestDelta01(a: number, b: number): number {
  return (((a - b + 0.5) % 1) + 1) % 1 - 0.5;
}

function forwardDelta01(from: number, to: number): number {
  return ((to - from) % 1 + 1) % 1;
}
