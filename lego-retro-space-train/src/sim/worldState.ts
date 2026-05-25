import * as THREE from 'three';

/**
 * Cross-entity ambient state. Entities can read these to react to global
 * conditions (day/night, sun position) without needing direct refs to the
 * systems that produce them.
 *
 * Producers (write):
 *   - DayNightCycle: updates `dayNess` and `sunDir` every frame
 *
 * Consumers (read):
 *   - ApartmentBuilding: window emissive responds to `dayNess`
 *   - SolarFarm: panels track `sunDir`
 *   - (any future entity that should look different at night)
 *
 * Default values are "full daylight" so anything that boots without a
 * DayNightCycle still renders sensibly.
 */
export const worldState = {
  /** 0 = full lunar night, 1 = high noon. */
  dayNess: 1.0,
  /** Current sun direction (unit vector). */
  sunDir: new THREE.Vector3(0.55, 0.85, 0.35).normalize(),
};
