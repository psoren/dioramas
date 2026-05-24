import * as THREE from 'three';
import { Entity } from '../sim/Entity';

interface LayerSpec {
  count: number;
  radius: [number, number];
  size: number;
  brightnessFloor: number;
  opacity: number;
  /** 0 = locked to world (full parallax), 1 = locked to camera (no parallax). */
  followFactor: number;
}

const LAYERS: readonly LayerSpec[] = [
  { count: 700, radius: [80, 100], size: 0.14, brightnessFloor: 0.55, opacity: 0.75, followFactor: 0.92 },
  { count: 350, radius: [60, 80], size: 0.20, brightnessFloor: 0.70, opacity: 0.85, followFactor: 0.55 },
  { count: 150, radius: [45, 65], size: 0.28, brightnessFloor: 0.85, opacity: 0.95, followFactor: 0.0 },
];

interface Layer {
  group: THREE.Group;
  followFactor: number;
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
}

/**
 * Layered parallax starfield. Each layer's anchor follows the camera by a
 * different factor; high-followFactor layers barely shift during orbit
 * (apparently distant), while low-factor layers sweep across the view
 * (apparently nearer). Forward direction is irrelevant — group is unrotated.
 */
export class Starfield implements Entity {
  readonly object3d = new THREE.Group();
  private readonly layers: Layer[] = [];

  constructor(private readonly camera: THREE.Camera) {
    for (const spec of LAYERS) {
      const { geometry, material, points } = buildPoints(spec);
      const group = new THREE.Group();
      group.add(points);
      this.object3d.add(group);
      this.layers.push({ group, followFactor: spec.followFactor, geometry, material });
    }
    this.update();
  }

  // Read camera position directly (not dt) so parallax updates even when paused.
  update(): void {
    const c = this.camera.position;
    for (const layer of this.layers) {
      const k = layer.followFactor;
      layer.group.position.set(c.x * k, c.y * k, c.z * k);
    }
  }

  dispose(): void {
    for (const layer of this.layers) {
      layer.geometry.dispose();
      layer.material.dispose();
    }
  }
}

function buildPoints(spec: LayerSpec): {
  geometry: THREE.BufferGeometry;
  material: THREE.PointsMaterial;
  points: THREE.Points;
} {
  const [rMin, rMax] = spec.radius;
  const positions = new Float32Array(spec.count * 3);
  const colors = new Float32Array(spec.count * 3);
  for (let i = 0; i < spec.count; i++) {
    const r = rMin + Math.random() * (rMax - rMin);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const idx = i * 3;
    positions[idx] = r * Math.sin(phi) * Math.cos(theta);
    positions[idx + 1] = r * Math.cos(phi) * 0.7 + 6;
    positions[idx + 2] = r * Math.sin(phi) * Math.sin(theta);
    const t = Math.random();
    const base = spec.brightnessFloor;
    const range = 1 - base;
    colors[idx] = base + t * range * 0.7;
    colors[idx + 1] = base + t * range * 0.85;
    colors[idx + 2] = base + t * range;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: spec.size,
    vertexColors: true,
    transparent: true,
    opacity: spec.opacity,
    sizeAttenuation: true,
    depthWrite: false,
    fog: false,
  });
  const points = new THREE.Points(geometry, material);
  return { geometry, material, points };
}
