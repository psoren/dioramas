import * as THREE from 'three';
import { Entity } from '../sim/Entity';

const EARTH_RADIUS = 8;
const EARTH_POSITION = new THREE.Vector3(-30, 45, -40);
const ROTATION_SPEED = 0.015; // rad/sec

const MAT_EARTH = new THREE.MeshStandardMaterial({
  color: 0x2a5fb0,
  emissive: 0x101830,
  emissiveIntensity: 0.6,
  roughness: 0.85,
  metalness: 0,
});

const MAT_CLOUD = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  emissive: 0xc0d0e0,
  emissiveIntensity: 0.35,
  transparent: true,
  opacity: 0.9,
  roughness: 0.95,
});

const MAT_CONTINENT = new THREE.MeshStandardMaterial({
  color: 0x6c8c4a,
  emissive: 0x1a2410,
  emissiveIntensity: 0.5,
  roughness: 0.95,
});

/**
 * A big blue Earth hanging above-and-behind the moon scene. Slowly rotates.
 * Built large enough to read clearly from any camera distance, but placed far
 * enough away that orbiting around the plate doesn't lose sight of it.
 */
export class Earth implements Entity {
  readonly object3d: THREE.Group;
  private readonly globe: THREE.Group;

  constructor() {
    this.object3d = new THREE.Group();
    this.object3d.position.copy(EARTH_POSITION);

    this.globe = new THREE.Group();
    this.object3d.add(this.globe);

    // Main ocean sphere
    const ocean = new THREE.Mesh(new THREE.SphereGeometry(EARTH_RADIUS, 48, 32), MAT_EARTH);
    this.globe.add(ocean);

    // A handful of continent-shaped bumps slightly above ocean radius
    const rng = mulberry32(20260101);
    for (let i = 0; i < 11; i++) {
      const continent = new THREE.Mesh(
        new THREE.SphereGeometry(
          EARTH_RADIUS * (0.18 + rng() * 0.22),
          16, 12,
          0, Math.PI * 2,
          0, Math.PI,
        ),
        MAT_CONTINENT,
      );
      const phi = rng() * Math.PI * 2;
      const theta = Math.acos(2 * rng() - 1);
      const r = EARTH_RADIUS * 1.005;
      continent.position.set(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.cos(theta),
        r * Math.sin(theta) * Math.sin(phi),
      );
      continent.scale.set(1, 0.4, 1);
      continent.lookAt(0, 0, 0);
      this.globe.add(continent);
    }

    // Cloud bands
    for (let i = 0; i < 14; i++) {
      const cloud = new THREE.Mesh(
        new THREE.SphereGeometry(
          EARTH_RADIUS * (0.10 + rng() * 0.18),
          12, 10,
          0, Math.PI * 2,
          0, Math.PI,
        ),
        MAT_CLOUD,
      );
      const phi = rng() * Math.PI * 2;
      const theta = Math.acos(2 * rng() - 1);
      const r = EARTH_RADIUS * 1.04;
      cloud.position.set(
        r * Math.sin(theta) * Math.cos(phi),
        r * Math.cos(theta),
        r * Math.sin(theta) * Math.sin(phi),
      );
      cloud.scale.set(1.4, 0.35, 1.4);
      cloud.lookAt(0, 0, 0);
      this.globe.add(cloud);
    }
  }

  update(dt: number): void {
    this.globe.rotation.y += dt * ROTATION_SPEED;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
