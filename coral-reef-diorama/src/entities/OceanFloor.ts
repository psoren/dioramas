import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { mulberry32 } from '../world/seededRng';

const FLOOR_RADIUS = 60;
// 80x80 grid over a 120x120 plane → 6400 quads. Plenty of resolution for the
// dune undulation; corners fall well inside the fog distance so the square
// silhouette never reads.
const FLOOR_GRID = 80;
const FLOOR_SIZE = 120;
const ROCK_COUNT = 70;
const BOULDER_COUNT = 8;
const SHELL_COUNT = 40;
const ENCRUST_COUNT = 25; // small coral bumps on the floor
const DUNE_AMPLITUDE = 0.45;
const DUNE_FREQ = 0.08;
const RIPPLE_AMP = 0.07;
const RIPPLE_FREQ = 0.55;

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

    // Properly tessellated floor. PlaneGeometry has both axes subdivided so
    // the dune undulation actually shows up in the render — CircleGeometry's
    // pizza-slice triangulation collapses it. The square is large enough that
    // its corners fall past the fog far-plane (80), so it reads as round.
    const geo = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_GRID, FLOOR_GRID);
    geo.rotateX(-Math.PI / 2);
    const positions = geo.attributes.position!;

    // Per-vertex colour mixed between two sand tones so the floor doesn't
    // read as one flat colour. Mixed using a low-frequency sin so streaks
    // look like wind-blown patches rather than per-vertex noise.
    const lightCol = new THREE.Color(0xd4c084);
    const darkCol = new THREE.Color(0xa8966a);
    const tempCol = new THREE.Color();
    const colors = new Float32Array(positions.count * 3);

    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      // Existing low-frequency dune body.
      let y =
        Math.sin(x * DUNE_FREQ) * DUNE_AMPLITUDE +
        Math.cos(z * DUNE_FREQ * 1.3) * DUNE_AMPLITUDE * 0.7;
      // Secondary higher-frequency ripples — small detail you only see up close.
      y +=
        Math.sin(x * RIPPLE_FREQ + z * 0.4) * RIPPLE_AMP +
        Math.sin(x * 0.31 - z * RIPPLE_FREQ) * RIPPLE_AMP * 0.7;
      positions.setY(i, y);

      // Mix tone by a different low-frequency pattern so colour doesn't
      // track elevation 1:1 — that would look unnatural.
      const mix = 0.5 + 0.5 * Math.sin(x * 0.12 + z * 0.18 + Math.sin(x * 0.04) * 1.2);
      tempCol.copy(darkCol).lerp(lightCol, mix);
      colors[i * 3] = tempCol.r;
      colors[i * 3 + 1] = tempCol.g;
      colors[i * 3 + 2] = tempCol.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    // Clone the shared sand material so we can opt into vertexColors without
    // affecting anything else MAT.sand is used by.
    const floorMat = (MAT.sand as THREE.MeshStandardMaterial).clone();
    floorMat.vertexColors = true;

    const floor = new THREE.Mesh(geo, floorMat);
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

    // Larger boulders — a handful of much bigger rocks scattered around to
    // give the silhouette some weight at distance. Stacked at icosahedron
    // detail 1 so they read as more weathered than the small rocks.
    const encrustColors = [MAT.coralPink, MAT.coralOrange, MAT.coralPurple, MAT.brainCoral];
    for (let i = 0; i < BOULDER_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 8 + rng() * (FLOOR_RADIUS - 14);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const size = 1.4 + rng() * 1.6;
      // IcosahedronGeometry is non-indexed (each triangle has its own copies
      // of every corner), so mergeVertices first to share corners — otherwise
      // per-vertex jitter pulls neighbouring faces apart and tears holes.
      const geo = mergeVertices(new THREE.IcosahedronGeometry(size, 1));
      const positions = geo.attributes.position!;
      for (let v = 0; v < positions.count; v++) {
        const px = positions.getX(v);
        const py = positions.getY(v);
        const pz = positions.getZ(v);
        const j = 1 + (rng() - 0.5) * 0.35;
        positions.setXYZ(v, px * j, py * j, pz * j);
      }
      geo.computeVertexNormals();
      const boulder = new THREE.Mesh(geo, MAT.rock);
      boulder.position.set(x, surfaceY(x, z) + size * 0.45, z);
      boulder.rotation.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      boulder.scale.y = 0.65 + rng() * 0.3;
      boulder.castShadow = true;
      boulder.receiveShadow = true;
      g.add(boulder);

      // Sprinkle 2-4 little coral nubs on the top of each boulder so they
      // read as colonised, not bare.
      const nubCount = 2 + Math.floor(rng() * 3);
      for (let n = 0; n < nubCount; n++) {
        const nubAngle = rng() * Math.PI * 2;
        const nubR = size * (0.2 + rng() * 0.4);
        const nubX = Math.cos(nubAngle) * nubR;
        const nubZ = Math.sin(nubAngle) * nubR;
        const nubSize = 0.1 + rng() * 0.15;
        const nub = new THREE.Mesh(
          new THREE.SphereGeometry(nubSize, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
          encrustColors[Math.floor(rng() * encrustColors.length)]!,
        );
        nub.position.set(
          x + nubX,
          surfaceY(x, z) + size * 0.45 + size * 0.55,
          z + nubZ,
        );
        nub.scale.y = 0.5 + rng() * 0.4;
        nub.castShadow = true;
        g.add(nub);
      }
    }

    // Floor encrusting coral mats — flat low coral patches directly on the
    // sand, not on a rock. Adds colour to the open floor between reefs.
    for (let i = 0; i < ENCRUST_COUNT; i++) {
      const angle = rng() * Math.PI * 2;
      const radius = 5 + rng() * (FLOOR_RADIUS - 10);
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const size = 0.25 + rng() * 0.4;
      const mat = encrustColors[Math.floor(rng() * encrustColors.length)]!;
      const patch = new THREE.Mesh(
        new THREE.SphereGeometry(size, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        mat,
      );
      patch.position.set(x, surfaceY(x, z) + 0.04, z);
      patch.scale.y = 0.25;
      patch.rotation.y = rng() * Math.PI * 2;
      patch.castShadow = true;
      patch.receiveShadow = true;
      g.add(patch);
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

/** Floor height at (x, z) — matches the per-vertex displacement above so
 *  entities placed at `surfaceY(x,z) + small_offset` sit flush with the
 *  rendered sand instead of floating above or sinking below.
 */
export function surfaceY(x: number, z: number): number {
  return (
    Math.sin(x * DUNE_FREQ) * DUNE_AMPLITUDE +
    Math.cos(z * DUNE_FREQ * 1.3) * DUNE_AMPLITUDE * 0.7 +
    Math.sin(x * RIPPLE_FREQ + z * 0.4) * RIPPLE_AMP +
    Math.sin(x * 0.31 - z * RIPPLE_FREQ) * RIPPLE_AMP * 0.7
  );
}
