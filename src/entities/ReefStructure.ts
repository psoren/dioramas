import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { mulberry32 } from '../world/seededRng';

const RNG_SEED = 9182734;

/**
 * The reef centerpiece — procedural pile of branching corals, brain coral
 * domes, and fan corals composed deterministically so it doesn't reshuffle
 * between reloads. Static (no update method).
 */
export class ReefStructure implements Entity {
  readonly object3d = this.build();

  private build(): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(RNG_SEED);

    // Big mounded rock pile under the corals so the reef looks anchored.
    const moundGeo = new THREE.SphereGeometry(2.4, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    deformSphere(moundGeo, 0.35, rng);
    const mound = new THREE.Mesh(moundGeo, MAT.rock);
    mound.position.y = 0;
    mound.scale.set(1.3, 0.7, 1.3);
    mound.castShadow = true;
    mound.receiveShadow = true;
    g.add(mound);

    // Cluster of coral pieces placed on top of and around the mound.
    const corals: Array<() => THREE.Object3D> = [
      () => branchCoral(MAT.coralPink, rng, 3),
      () => branchCoral(MAT.coralOrange, rng, 3),
      () => branchCoral(MAT.coralPurple, rng, 2),
      () => brainCoral(MAT.brainCoral, rng),
      () => brainCoral(MAT.coralMustard, rng),
      () => fanCoral(MAT.coralRed, rng),
      () => fanCoral(MAT.coralPurple, rng),
      () => tubeCoral(MAT.coralOrange, rng),
    ];

    // Place each piece in a ring + jitter; tilt outward slightly so they
    // lean off the mound's central axis.
    for (let i = 0; i < corals.length; i++) {
      const angle = (i / corals.length) * Math.PI * 2 + rng() * 0.6;
      const radius = 0.4 + rng() * 1.4;
      const piece = corals[i]!();
      piece.position.set(
        Math.cos(angle) * radius,
        0.55 + rng() * 0.4,
        Math.sin(angle) * radius,
      );
      piece.rotation.y = rng() * Math.PI * 2;
      // Lean outward a little
      piece.rotation.z = Math.cos(angle) * 0.2;
      piece.rotation.x = Math.sin(angle) * -0.2;
      g.add(piece);
    }

    return g;
  }
}

// --- Coral primitives ------------------------------------------------------

/**
 * Branching coral — recursive cylinders that taper and split.
 * `depth` controls how many levels of sub-branches we generate.
 */
function branchCoral(
  mat: THREE.Material,
  rng: () => number,
  depth: number,
  radius = 0.18,
  length = 0.9,
): THREE.Group {
  const g = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radius * 0.55, radius, length, 8);
  geo.translate(0, length / 2, 0); // pivot at base
  const trunk = new THREE.Mesh(geo, mat);
  trunk.castShadow = true;
  trunk.receiveShadow = true;
  g.add(trunk);

  if (depth <= 0) return g;

  const branchCount = 2 + Math.floor(rng() * 2);
  for (let i = 0; i < branchCount; i++) {
    const child = branchCoral(mat, rng, depth - 1, radius * 0.65, length * 0.7);
    child.position.y = length * (0.55 + rng() * 0.3);
    const azimuth = rng() * Math.PI * 2;
    const tilt = 0.6 + rng() * 0.5;
    child.rotation.z = Math.cos(azimuth) * tilt;
    child.rotation.x = Math.sin(azimuth) * tilt;
    g.add(child);
  }

  return g;
}

/** Brain coral — squat dome with lumpy displacement. */
function brainCoral(mat: THREE.Material, rng: () => number): THREE.Mesh {
  const geo = new THREE.SphereGeometry(0.7, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55);
  deformSphere(geo, 0.15, rng);
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(1.0, 0.55, 1.0);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** Fan coral — flat upright fan-shape via a stretched, displaced plane. */
function fanCoral(mat: THREE.Material, rng: () => number): THREE.Group {
  const g = new THREE.Group();

  // Stem
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.4, 8), MAT.rock);
  stem.position.y = 0.2;
  stem.castShadow = true;
  g.add(stem);

  // Fan blade — a flat thin curved shape via a shallow box deformed.
  const fanGeo = new THREE.PlaneGeometry(0.9, 0.8, 6, 6);
  const positions = fanGeo.attributes.position!;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const y = positions.getY(i);
    // Slight outward bow and edge dimples for organic feel.
    positions.setZ(i, Math.cos(x * 2) * 0.04 + (rng() - 0.5) * 0.06);
    // Pinch the bottom so the fan tapers to the stem.
    if (y < -0.2) positions.setX(i, x * 0.6);
  }
  fanGeo.computeVertexNormals();

  const fanMat = (mat as THREE.MeshStandardMaterial).clone();
  fanMat.side = THREE.DoubleSide;
  const fan = new THREE.Mesh(fanGeo, fanMat);
  fan.position.y = 0.65;
  fan.castShadow = true;
  g.add(fan);

  return g;
}

/** Tube coral — a cluster of upright open tubes. */
function tubeCoral(mat: THREE.Material, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const tubes = 5 + Math.floor(rng() * 3);
  for (let i = 0; i < tubes; i++) {
    const h = 0.4 + rng() * 0.5;
    const r = 0.07 + rng() * 0.05;
    const geo = new THREE.CylinderGeometry(r, r * 0.85, h, 10, 1, true);
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    const angle = (i / tubes) * Math.PI * 2 + rng() * 0.4;
    const dist = 0.15 + rng() * 0.18;
    m.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
    m.rotation.z = Math.cos(angle) * 0.12;
    m.rotation.x = Math.sin(angle) * 0.12;
    m.castShadow = true;
    g.add(m);
  }
  return g;
}

/** Apply per-vertex radial noise to a sphere geometry, in-place. */
function deformSphere(geo: THREE.BufferGeometry, amount: number, rng: () => number): void {
  const positions = geo.attributes.position!;
  const v = new THREE.Vector3();
  for (let i = 0; i < positions.count; i++) {
    v.set(positions.getX(i), positions.getY(i), positions.getZ(i));
    const r = v.length();
    const jitter = 1 + (rng() - 0.5) * amount;
    v.multiplyScalar(jitter / Math.max(r, 0.0001) * r);
    positions.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
}
