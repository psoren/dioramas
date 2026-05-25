import * as THREE from 'three';
import { Entity } from '../sim/Entity';

const POOL_SIZE = 4;
const SPAWN_RADIUS = 90;
const TARGET_RADIUS = 30;
const FALL_HEIGHT = 50;
const SPEED = 28; // units/sec
const MIN_INTERVAL = 6;
const MAX_INTERVAL = 16;

const MAT_METEOR = new THREE.MeshStandardMaterial({
  color: 0xfff0d0,
  emissive: 0xffd590,
  emissiveIntensity: 2.4,
  transparent: true,
  opacity: 0.9,
});

interface Meteor {
  mesh: THREE.Mesh;
  velocity: THREE.Vector3;
  ttl: number;     // seconds remaining alive
  cooldown: number; // seconds until next spawn
}

/**
 * Pool of meteors that periodically streak across the starfield. Each meteor
 * is a stretched glowing cylinder pointing along its velocity vector. When a
 * meteor expires, it waits a random delay and respawns from a fresh random
 * direction.
 */
export class MeteorShower implements Entity {
  readonly object3d = new THREE.Group();
  private readonly meteors: Meteor[] = [];

  constructor() {
    for (let i = 0; i < POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.12, 2.2, 8), MAT_METEOR);
      mesh.visible = false;
      this.object3d.add(mesh);
      this.meteors.push({
        mesh,
        velocity: new THREE.Vector3(),
        ttl: 0,
        cooldown: Math.random() * MAX_INTERVAL,
      });
    }
  }

  update(dt: number): void {
    for (const m of this.meteors) {
      if (m.ttl > 0) {
        m.mesh.position.addScaledVector(m.velocity, dt);
        m.ttl -= dt;
        if (m.ttl <= 0) {
          m.mesh.visible = false;
          m.cooldown = MIN_INTERVAL + Math.random() * (MAX_INTERVAL - MIN_INTERVAL);
        }
      } else {
        m.cooldown -= dt;
        if (m.cooldown <= 0) this.spawn(m);
      }
    }
  }

  private spawn(m: Meteor): void {
    // Spawn at a random point on a hemisphere above the scene, aim at a random
    // point in a small target sphere around the plate.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI * 0.35; // shallow downward angle
    const start = new THREE.Vector3(
      SPAWN_RADIUS * Math.sin(phi) * Math.cos(theta),
      FALL_HEIGHT + Math.random() * 10,
      SPAWN_RADIUS * Math.sin(phi) * Math.sin(theta),
    );
    const target = new THREE.Vector3(
      (Math.random() - 0.5) * TARGET_RADIUS,
      4 + Math.random() * 6,
      (Math.random() - 0.5) * TARGET_RADIUS,
    );
    const direction = target.clone().sub(start).normalize();

    m.mesh.position.copy(start);
    m.mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction);
    m.velocity.copy(direction).multiplyScalar(SPEED);
    const distance = start.distanceTo(target);
    m.ttl = distance / SPEED;
    m.mesh.visible = true;
  }
}
