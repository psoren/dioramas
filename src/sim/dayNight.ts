import * as THREE from 'three';

/**
 * Reusable day/night cycle plumbing. Holds the palette schema, a helper for
 * discovering standard scene lights, and the per-frame lerp routine. A scene
 * gets a real cycle by:
 *   1. Defining DAY and NIGHT palettes
 *   2. Calling `findStandardLights(scene)` once at boot
 *   3. Calling `lerpDayNight(dayNess, ...)` each frame
 *
 * `DayNightCycle` entity wraps all of that with a phase ticker.
 */

export interface DayNightPalette {
  bg: THREE.Color;
  fog: THREE.Color;
  sunColor: THREE.Color;
  sunIntensity: number;
  /** Sun direction (will be normalised). The light's position is set so it
   *  points from this direction toward the origin. */
  sunDir: THREE.Vector3;
  ambient: THREE.Color;
  ambientIntensity: number;
  fillColor: THREE.Color;
  fillIntensity: number;
  rimColor: THREE.Color;
  rimIntensity: number;
  exposure: number;
}

export interface StandardLights {
  sun: THREE.DirectionalLight | null;
  fill: THREE.DirectionalLight | null;
  rim: THREE.DirectionalLight | null;
  ambient: THREE.AmbientLight | null;
  hemi: THREE.HemisphereLight | null;
}

/**
 * Discover the standard set of lights from a scene root by walking its
 * children. Distinguishes DirectionalLights by their initial intensity:
 * brightest = sun, second = fill, dimmest = rim.
 */
export function findStandardLights(scene: THREE.Scene): StandardLights {
  const directionals: THREE.DirectionalLight[] = [];
  let ambient: THREE.AmbientLight | null = null;
  let hemi: THREE.HemisphereLight | null = null;
  for (const child of scene.children) {
    if (child instanceof THREE.DirectionalLight) directionals.push(child);
    else if (child instanceof THREE.AmbientLight) ambient = child;
    else if (child instanceof THREE.HemisphereLight) hemi = child;
  }
  directionals.sort((a, b) => b.intensity - a.intensity);
  return {
    sun: directionals[0] ?? null,
    fill: directionals[1] ?? null,
    rim: directionals[2] ?? null,
    ambient,
    hemi,
  };
}

/**
 * Lerp every modulated property between NIGHT and DAY by `dayNess` in [0,1].
 * 1 = full day, 0 = full night.
 */
export function lerpDayNight(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
  lights: StandardLights,
  night: DayNightPalette,
  day: DayNightPalette,
  dayNess: number,
  sunArcRadius = 26,
): void {
  if (lights.sun) {
    lights.sun.color.copy(night.sunColor).lerp(day.sunColor, dayNess);
    lights.sun.intensity = lerp(night.sunIntensity, day.sunIntensity, dayNess);
    // Position is the night sun direction lerped to the day sun direction,
    // scaled to a steady distance so shadow camera bounds stay valid.
    _tempDir
      .copy(night.sunDir)
      .lerp(day.sunDir, dayNess)
      .normalize()
      .multiplyScalar(sunArcRadius);
    lights.sun.position.copy(_tempDir);
  }
  if (lights.fill) {
    lights.fill.color.copy(night.fillColor).lerp(day.fillColor, dayNess);
    lights.fill.intensity = lerp(night.fillIntensity, day.fillIntensity, dayNess);
  }
  if (lights.rim) {
    lights.rim.color.copy(night.rimColor).lerp(day.rimColor, dayNess);
    lights.rim.intensity = lerp(night.rimIntensity, day.rimIntensity, dayNess);
  }
  if (lights.ambient) {
    lights.ambient.color.copy(night.ambient).lerp(day.ambient, dayNess);
    lights.ambient.intensity = lerp(night.ambientIntensity, day.ambientIntensity, dayNess);
  }
  if (scene.background instanceof THREE.Color) {
    scene.background.copy(night.bg).lerp(day.bg, dayNess);
  }
  if (scene.fog instanceof THREE.Fog) {
    scene.fog.color.copy(night.fog).lerp(day.fog, dayNess);
  }
  renderer.toneMappingExposure = lerp(night.exposure, day.exposure, dayNess);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const _tempDir = new THREE.Vector3();
