import * as THREE from 'three';

/**
 * Shared mutable state read by many entities and written by the
 * EventScheduler + DayNightCycle. This is the spine that lets the scene's
 * various creatures and systems react to "what's happening right now"
 * without each one re-implementing a sense of global time.
 *
 * Entities should treat this as read-only unless they're explicitly the
 * authority for a field (e.g. DayNightCycle writes `dayNess`).
 */
export class WorldState {
  /** 0 = pitch night, 1 = high noon. Written by DayNightCycle each frame. */
  dayNess = 1;

  /**
   * Global water current — a small horizontal drift vector that rotates
   * slowly over minutes. Magnitude is amplified by `storm`. Read by kelp,
   * anemones, jellyfish, and the fish boids' baseline velocity bias.
   */
  current = new THREE.Vector3(0, 0, 0);

  /** 0 = calm, 1 = storm peak. Drives surface chop + current magnitude. */
  storm = 0;

  /** Whether a "shark hunt" event is currently active. */
  sharkHunt: SharkHuntState = {
    active: false,
    intensity: 0,
    targetCentre: new THREE.Vector3(),
    speedMultiplier: 1,
  };
}

export interface SharkHuntState {
  active: boolean;
  /** 0..1 — ramps up at start, holds, fades. Used by schools to scale flee. */
  intensity: number;
  /** World-space point the shark is currently steering toward. */
  targetCentre: THREE.Vector3;
  /** Speed multiplier the shark applies to its path-traversal during a hunt. */
  speedMultiplier: number;
}
