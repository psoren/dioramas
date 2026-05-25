import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { BASE_SIZE } from '../world/constants';

const MOON_RADIUS = 60;
const MOON_Y = -0.5;
const CRATER_COUNT = 28;
const ROCK_COUNT = 24;
// Inner radius for craters + rocks: outside the baseplate's farthest
// corner (`sqrt(2) * BASE_SIZE` for a square plate) plus a small margin
// so nothing pokes through the blue.
const SCATTER_INNER = Math.SQRT2 * BASE_SIZE + 2;

/**
 * Flat moon surface around the plate. A big gray disc with scattered crater
 * markings and small rocks so the world doesn't read as "plate floating in
 * empty space". The blue baseplate sits on top.
 */
export class MoonSurface implements Entity {
  readonly object3d = this.build();

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Main surface disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(MOON_RADIUS, 64),
      MAT.moonSurface,
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = MOON_Y;
    disc.receiveShadow = true;
    g.add(disc);

    // Scatter craters (darker shallow rings) — deterministic placement so
    // they don't jitter between sessions.
    const rng = mulberry32(20260524);
    for (let i = 0; i < CRATER_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = SCATTER_INNER + rng() * (MOON_RADIUS - SCATTER_INNER - 2);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const craterR = 1.2 + rng() * 3.5;
      const crater = new THREE.Mesh(
        new THREE.CircleGeometry(craterR, 24),
        MAT.moonCrater,
      );
      crater.rotation.x = -Math.PI / 2;
      crater.position.set(x, MOON_Y + 0.01, z);
      crater.receiveShadow = true;
      g.add(crater);
    }

    // Scatter little moon rocks
    for (let i = 0; i < ROCK_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = SCATTER_INNER + rng() * (MOON_RADIUS - SCATTER_INNER - 2);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const size = 0.2 + rng() * 0.6;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        MAT.moonRock,
      );
      rock.position.set(x, MOON_Y + size * 0.5, z);
      rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);
    }

    return g;
  }
}

// Tiny deterministic RNG so the moon's craters and rocks don't move between reloads.
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
