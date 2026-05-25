import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { Sim } from '../sim/Sim';

const CYCLE_SECONDS = 120; // full day-night-day cycle

// Day / night palettes — lerped via the day-ness scalar.
const DAY = {
  bg:        new THREE.Color(0x3da8c4),
  fog:       new THREE.Color(0x4cb8d0),
  sunColor:  new THREE.Color(0xfff4d8),
  sunIntensity: 1.9,
  ambient:   new THREE.Color(0xbfe8f0),
  ambientIntensity: 0.65,
  hemiSky:   new THREE.Color(0x9fd8e8),
  hemiGround:new THREE.Color(0x2080a0),
  hemiIntensity: 0.85,
  rimIntensity: 0.55,
  exposure: 1.25,
};

const NIGHT = {
  bg:        new THREE.Color(0x040a1a),
  fog:       new THREE.Color(0x071230),
  sunColor:  new THREE.Color(0x90b8e8), // moonlight
  sunIntensity: 0.25,
  ambient:   new THREE.Color(0x223048),
  ambientIntensity: 0.18,
  hemiSky:   new THREE.Color(0x1a2848),
  hemiGround:new THREE.Color(0x040818),
  hemiIntensity: 0.25,
  rimIntensity: 0.15,
  exposure: 0.85,
};

/**
 * Slowly cycles the scene through day → dusk → night → dawn → day. Finds the
 * lights and fog in the scene by walking sim.scene.children and modulates
 * them based on a single phase parameter.
 *
 * Phase is in [0, 1). dayNess = 0.5 + 0.5*cos(phase*2π), so peaks at 1 when
 * phase=0 (high noon) and 0 when phase=0.5 (midnight). The Sun also visually
 * rotates around the scene by adjusting its direction in a wide arc.
 */
export class DayNightCycle implements Entity {
  readonly object3d = new THREE.Group(); // invisible — this entity is logic-only
  private phase = 0;

  private readonly sun: THREE.DirectionalLight | null;
  private readonly ambient: THREE.AmbientLight | null;
  private readonly hemi: THREE.HemisphereLight | null;
  private readonly rim: THREE.DirectionalLight | null;

  constructor(private readonly sim: Sim) {
    let sun: THREE.DirectionalLight | null = null;
    let rim: THREE.DirectionalLight | null = null;
    let ambient: THREE.AmbientLight | null = null;
    let hemi: THREE.HemisphereLight | null = null;
    // The two DirectionalLights are sun (1.9) and rim (0.55) by initial
    // intensity — distinguish by which is brighter.
    for (const child of sim.scene.children) {
      if (child instanceof THREE.DirectionalLight) {
        if (!sun || child.intensity > sun.intensity) {
          if (sun) rim = sun;
          sun = child;
        } else {
          rim = child;
        }
      } else if (child instanceof THREE.AmbientLight) {
        ambient = child;
      } else if (child instanceof THREE.HemisphereLight) {
        hemi = child;
      }
    }
    this.sun = sun;
    this.rim = rim;
    this.ambient = ambient;
    this.hemi = hemi;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.phase = (this.phase + dt / CYCLE_SECONDS) % 1;

    // dayNess = 1 at noon (phase 0), 0 at midnight (phase 0.5).
    const dayNess = 0.5 + 0.5 * Math.cos(this.phase * Math.PI * 2);

    // Lerp colours and intensities
    if (this.sun) {
      this.sun.color.copy(NIGHT.sunColor).lerp(DAY.sunColor, dayNess);
      this.sun.intensity = lerp(NIGHT.sunIntensity, DAY.sunIntensity, dayNess);
      // Sun sweeps across the sky: position rotates around Y at altitude that
      // mirrors phase (high at noon, low at horizons).
      const sunAngle = this.phase * Math.PI * 2 + Math.PI / 2; // phase=0 → noon (top)
      const altitude = Math.max(0.1, Math.sin(sunAngle));
      const r = 30;
      this.sun.position.set(
        Math.cos(sunAngle) * r,
        altitude * 32,
        Math.sin(sunAngle) * r * 0.4,
      );
    }
    if (this.rim) {
      this.rim.intensity = lerp(NIGHT.rimIntensity, DAY.rimIntensity, dayNess);
    }
    if (this.ambient) {
      this.ambient.color.copy(NIGHT.ambient).lerp(DAY.ambient, dayNess);
      this.ambient.intensity = lerp(NIGHT.ambientIntensity, DAY.ambientIntensity, dayNess);
    }
    if (this.hemi) {
      this.hemi.color.copy(NIGHT.hemiSky).lerp(DAY.hemiSky, dayNess);
      this.hemi.groundColor.copy(NIGHT.hemiGround).lerp(DAY.hemiGround, dayNess);
      this.hemi.intensity = lerp(NIGHT.hemiIntensity, DAY.hemiIntensity, dayNess);
    }

    // Background and fog colours
    const bg = this.sim.scene.background;
    if (bg instanceof THREE.Color) bg.copy(NIGHT.bg).lerp(DAY.bg, dayNess);
    if (this.sim.scene.fog instanceof THREE.Fog) {
      this.sim.scene.fog.color.copy(NIGHT.fog).lerp(DAY.fog, dayNess);
    }

    // Renderer exposure
    this.sim.renderer.toneMappingExposure = lerp(NIGHT.exposure, DAY.exposure, dayNess);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
