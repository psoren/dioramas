import * as THREE from 'three';

/** Sun above + ambient blue fill + cyan rim — underwater-tuned palette. */
export function setupLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x4a7090, 0.55));

  const sun = new THREE.DirectionalLight(0xeaf5ff, 1.1);
  sun.position.set(8, 28, 6);
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

  // Faint cyan rim from the side — catches dorsal edges of fish, coral tips.
  const rim = new THREE.DirectionalLight(0x40d0e0, 0.35);
  rim.position.set(-9, 5, -7);
  scene.add(rim);

  // Bluish bounce-fill from below.
  const fill = new THREE.HemisphereLight(0x6090c0, 0x0a3050, 0.4);
  scene.add(fill);
}
