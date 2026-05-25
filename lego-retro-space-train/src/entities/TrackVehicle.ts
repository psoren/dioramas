import { TRACK_Y } from '../world/constants';
import { PathVehicle, PathVehicleOptions } from './PathVehicle';

export interface TrackVehicleOptions extends Omit<PathVehicleOptions, 'y'> {
  /** Vertical offset above the track surface. */
  yOffset?: number;
}

/**
 * Compatibility wrapper for vehicles on the elevated monorail track.
 */
export abstract class TrackVehicle extends PathVehicle {
  constructor(opts: TrackVehicleOptions) {
    super({ ...opts, y: TRACK_Y + (opts.yOffset ?? 0.18) });
  }
}
