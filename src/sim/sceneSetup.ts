import * as THREE from 'three';

export function setupLighting(scene: THREE.Scene): void {
  scene.add(new THREE.AmbientLight(0x6680aa, 0.45));

  const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
  sun.position.set(8, 14, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -14;
  sc.right = 14;
  sc.top = 14;
  sc.bottom = -14;
  sc.near = 0.5;
  sc.far = 36;
  sun.shadow.bias = -0.0004;
  scene.add(sun);

  const fill = new THREE.DirectionalLight(0x5078d0, 0.5);
  fill.position.set(-6, 5, -7);
  scene.add(fill);

  const rim = new THREE.DirectionalLight(0xff9966, 0.25);
  rim.position.set(0, 3, -10);
  scene.add(rim);
}

