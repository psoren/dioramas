import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { mulberry32 } from '../world/seededRng';

const FLOOR_RADIUS = 60;
const FLOOR_SEGMENTS = 96;
const ROCK_COUNT = 30;
const SHELL_COUNT = 20;
const DUNE_AMPLITUDE = 0.45;
const DUNE_FREQ = 0.08;

/**
 * Sandy ocean floor — a large disc with gentle dune undulation via vertex
 * displacement plus deterministic scatter of rocks and shells.
 *
 * Forward direction is irrelevant — this entity is static and oriented by
 * its global transform.
 */
export class OceanFloor implements Entity {
  readonly object3d = this.build();

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Floor disc with vertex-displaced dunes
    const geo = new THREE.CircleGeometry(FLOOR_RADIUS, FLOOR_SEGMENTS, 0, Math.PI * 2);
    geo.rotateX(-Math.PI / 2);
    const positions = geo.attributes.position!;
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Two sine bands for low-frequency dune feel
      const y =
        Math.sin(x * DUNE_FREQ) * DUNE_AMPLITUDE +
        Math.cos(z * DUNE_FREQ * 1.3) * DUNE_AMPLITUDE * 0.7;
      positions.setY(i, y);
    }
    geo.computeVertexNormals();

    const floor = new THREE.Mesh(geo, MAT.sand);
    floor.receiveShadow = true;
    g.add(floor);

    // Scatter rocks deterministically
    const rng = mulberry32(20260524);
    for (let i = 0; i < ROCK_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      // Bias rocks outside the reef centre so they don't clip into coral later.
      const radius = 6 + rng() * (FLOOR_RADIUS - 9);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const size = 0.3 + rng() * 0.9;
      const rock = new THREE.Mesh(
        new THREE.DodecahedronGeometry(size, 0),
        MAT.rock,
      );
      rock.position.set(x, surfaceY(x, z) + size * 0.4, z);
      rock.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      rock.scale.y = 0.6 + rng() * 0.5;
      rock.castShadow = true;
      rock.receiveShadow = true;
      g.add(rock);
    }

    // Scatter little shells (small flat hemispheres)
    for (let i = 0; i < SHELL_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 4 + rng() * (FLOOR_RADIUS - 8);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const shell = new THREE.Mesh(
        new THREE.SphereGeometry(0.15 + rng() * 0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        MAT.shell,
      );
      shell.position.set(x, surfaceY(x, z) + 0.02, z);
      shell.rotation.y = rng() * Math.PI * 2;
      shell.castShadow = true;
      shell.receiveShadow = true;
      g.add(shell);
    }

    return g;
  }
}

/** Approximate floor height at (x, z) — matches the dune displacement above. */
export function surfaceY(x: number, z: number): number {
  return (
    Math.sin(x * DUNE_FREQ) * DUNE_AMPLITUDE +
    Math.cos(z * DUNE_FREQ * 1.3) * DUNE_AMPLITUDE * 0.7
  );
}
