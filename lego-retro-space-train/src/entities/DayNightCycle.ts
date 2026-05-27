import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { Sim } from '../sim/Sim';
import {
  DayNightPalette,
  StandardLights,
  findStandardLights,
  lerpDayNight,
} from '../sim/dayNight';
import { worldState } from '../sim/worldState';

const CYCLE_SECONDS = 180; // full day → night → day

/**
 * Lunar day/night cycle. The moon has no atmosphere so the sky stays nearly
 * black always — what changes is direct sun (harsh during the day,
 * essentially gone at night) and the Earth-shine fill light from below.
 *
 * Phase=0 is high noon. dayNess = 0.5 + 0.5*cos(phase * 2π).
 */
const DAY: DayNightPalette = {
  bg:           new THREE.Color(0x05080f),
  fog:          new THREE.Color(0x05080f),
  sunColor:     new THREE.Color(0xfff2dd),
  sunIntensity: 1.4,
  sunDir:       new THREE.Vector3(0.55, 0.85, 0.35),
  ambient:      new THREE.Color(0x6680aa),
  ambientIntensity: 0.55,
  fillColor:    new THREE.Color(0x5078d0),
  fillIntensity: 0.45,
  rimColor:     new THREE.Color(0xff9966),
  rimIntensity: 0.25,
  exposure:     1.15,
};

const NIGHT: DayNightPalette = {
  bg:           new THREE.Color(0x010204),
  fog:          new THREE.Color(0x010204),
  sunColor:     new THREE.Color(0x4060a0), // moonlit when sun is below
  sunIntensity: 0.08,
  sunDir:       new THREE.Vector3(-0.55, -0.15, -0.35), // below horizon
  // Brighter ambient + strong Earthshine fill so the scene stays legible
  // at midnight — the moon never goes pitch black with Earth in the sky.
  ambient:      new THREE.Color(0x2c3a58),
  ambientIntensity: 0.35,
  fillColor:    new THREE.Color(0x5a82d0),
  fillIntensity: 0.95,
  rimColor:     new THREE.Color(0x6080b0),
  rimIntensity: 0.22,
  exposure:     1.0,
};

export class DayNightCycle implements Entity {
  readonly object3d = new THREE.Group();
  private phase = 0;
  private readonly lights: StandardLights;
  /** When non-null, the cycle is locked to this dayNess (0..1) and the
   *  phase no longer advances. Set via {@link lockTo}; clear with
   *  `lockTo(null)` to resume the auto cycle. */
  private locked: number | null = null;

  constructor(private readonly sim: Sim, startPhase = 0) {
    this.phase = startPhase;
    this.lights = findStandardLights(sim.scene);
  }

  /** Pin the scene to a fixed time-of-day. Pass null to resume cycling. */
  lockTo(dayNess: number | null): void {
    this.locked = dayNess === null ? null : Math.max(0, Math.min(1, dayNess));
    if (this.locked !== null) this.applyDayNess(this.locked);
  }

  update(dt: number): void {
    if (this.locked !== null) {
      // Even when locked, keep applying so a fresh scene/entity is lit
      // correctly. Cheap enough every frame.
      this.applyDayNess(this.locked);
      return;
    }
    if (dt <= 0) return;
    this.phase = (this.phase + dt / CYCLE_SECONDS) % 1;
    const dayNess = 0.5 + 0.5 * Math.cos(this.phase * Math.PI * 2);
    this.applyDayNess(dayNess);
  }

  private applyDayNess(dayNess: number): void {
    lerpDayNight(this.sim.scene, this.sim.renderer, this.lights, NIGHT, DAY, dayNess);
    worldState.dayNess = dayNess;
    worldState.sunDir.copy(NIGHT.sunDir).lerp(DAY.sunDir, dayNess).normalize();
  }
}
