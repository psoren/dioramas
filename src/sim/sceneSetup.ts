import * as THREE from 'three';

/**
 * Bright sun-from-above + warm ambient — sun-drenched tropical reef lighting.
 * Most of the colour comes top-down so the coral palette pops; the
 * hemisphere fill softly lifts the floor.
 */
export function setupLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0xbfe8f0, 0.65));

  // Main sun — coming nearly straight down with a slight tilt so shadows are short.
  const sun = new THREE.DirectionalLight(0xfff4d8, 1.9);
  sun.position.set(4, 32, 3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -22;
  sc.right = 22;
  sc.top = 22;
  sc.bottom = -22;
  sc.near = 0.5;
  sc.far = 60;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  // Bright cyan rim from one side for fish/coral edges.
  const rim = new THREE.DirectionalLight(0x80e8ff, 0.55);
  rim.position.set(-9, 6, -7);
  scene.add(rim);

  // Warm-sky-over-cool-floor hemisphere lift.
  const fill = new THREE.HemisphereLight(0x9fd8e8, 0x2080a0, 0.85);
  scene.add(fill);
}
