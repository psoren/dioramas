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

export function setupStarfield(scene: THREE.Scene, count = 1200): void {
  const g = new THREE.BufferGeometry();
  const positions: number[] = [];
  const colors: number[] = [];
  for (let i = 0; i < count; i++) {
    const r = 55 + Math.random() * 40;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions.push(
      r * Math.sin(phi) * Math.cos(theta),
      r * Math.cos(phi) * 0.7 + 6,
      r * Math.sin(phi) * Math.sin(theta),
    );
    const t = Math.random();
    colors.push(0.7 + t * 0.3, 0.8 + t * 0.2, 1.0);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.PointsMaterial({
    size: 0.18,
    vertexColors: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(g, m));
}
