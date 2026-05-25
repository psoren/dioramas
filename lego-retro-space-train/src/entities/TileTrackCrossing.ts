import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MonorailTrain } from './MonorailTrain';
import { TileTrack } from './TileTrack';

export interface CrossingTrainSpec {
  train: MonorailTrain;
  track: TileTrack;
  /** Which cell on this train's track is the crossing point. */
  cell: [number, number];
  /** Higher priority wins the right-of-way. */
  priority: number;
}

export interface TileTrackCrossingOptions {
  id: string;
  trains: CrossingTrainSpec[];
}

/**
 * Cross-route intersection on the tile system. Each train passes through a
 * specific cell on its own track at the crossing point. The controller
 * checks each frame which trains are currently in their crossing cell;
 * lower-priority trains get held while a higher-priority one occupies.
 *
 * The "same cell" check uses each train's track-local cell coordinates
 * (each train references the crossing cell on its own track). It's the
 * manifest's job to ensure these cells line up in world space — see the
 * crossing wiring in sceneManifest.ts for the alignment rules.
 */
export class TileTrackCrossing implements Entity {
  readonly object3d = new THREE.Group();
  private readonly holdKey: string;

  constructor(private readonly opts: TileTrackCrossingOptions) {
    this.holdKey = `crossing:${opts.id}`;
  }

  update(_dt: number): void {
    const occupants = this.opts.trains.filter((spec) => this.inCrossing(spec));
    if (occupants.length === 0) {
      for (const spec of this.opts.trains) spec.train.release(this.holdKey);
      return;
    }
    const maxOccupantPriority = Math.max(...occupants.map((o) => o.priority));
    for (const spec of this.opts.trains) {
      if (spec.priority < maxOccupantPriority) spec.train.hold(this.holdKey);
      else spec.train.release(this.holdKey);
    }
  }

  private inCrossing(spec: CrossingTrainSpec): boolean {
    const span = spec.track.tileAtT(spec.train.t);
    return !!span && span.gridX === spec.cell[0] && span.gridZ === spec.cell[1];
  }
}
