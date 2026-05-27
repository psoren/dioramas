import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { mulberry32 } from '../world/seededRng';

const DEFAULT_SEED = 9182734;

export interface ReefStructureOptions {
  /** World position of the reef centre. Default [0, 0, 0]. */
  position?: [number, number, number];
  /** Overall scale. Default 1. */
  scale?: number;
  /** Deterministic seed — change for different visual seeds at same position. */
  seed?: number;
  /**
   * Mound size relative to a unit reef. Default 1. Smaller values produce
   * outcrop-style reefs that don't dominate the scene; larger values produce
   * the main centerpiece.
   */
  moundRadius?: number;
  /** Y rotation of the whole reef. Default 0. */
  yaw?: number;
}

/**
 * A reef cluster — mound of rock + procedural pile of coral pieces. Static.
 *
 * Composes a small set of coral primitives (`branchCoral`, `brainCoral`,
 * `fanCoral`, `tubeCoral`, `tableCoral`, `pillarCoral`, `seaWhip`) into a
 * believable underwater outcrop. Multiple instances scattered around the
 * scene give the floor visual interest without needing a single giant reef.
 */
export class ReefStructure implements Entity {
  readonly object3d: THREE.Group;

  constructor(opts: ReefStructureOptions = {}) {
    const position = opts.position ?? [0, 0, 0];
    const scale = opts.scale ?? 1;
    const seed = opts.seed ?? DEFAULT_SEED;
    const moundRadius = opts.moundRadius ?? 2.4;
    const yaw = opts.yaw ?? 0;

    this.object3d = this.build(seed, moundRadius);
    this.object3d.position.set(position[0], position[1], position[2]);
    this.object3d.scale.setScalar(scale);
    this.object3d.rotation.y = yaw;
  }

  private build(seed: number, moundRadius: number): THREE.Group {
    const g = new THREE.Group();
    const rng = mulberry32(seed);

    // Big mounded rock pile under the corals so the reef looks anchored.
    // mergeVertices collapses pole-duplicates so per-vertex deformation
    // doesn't tear the mound apex open.
    const moundGeo = mergeVertices(
      new THREE.SphereGeometry(moundRadius, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    );
    deformSphere(moundGeo, 0.35, rng);
    const mound = new THREE.Mesh(moundGeo, MAT.rock);
    mound.position.y = 0;
    mound.scale.set(1.3, 0.7, 1.3);
    mound.castShadow = true;
    mound.receiveShadow = true;
    g.add(mound);

    // Cluster of coral pieces placed on top of and around the mound. The
    // factory list is built per-seed so each reef picks a different mix.
    const factories: Array<() => THREE.Object3D> = [
      () => branchCoral(MAT.coralPink, rng, 3),
      () => branchCoral(MAT.coralOrange, rng, 3),
      () => branchCoral(MAT.coralPurple, rng, 2),
      () => branchCoral(MAT.coralRed, rng, 2),
      () => brainCoral(MAT.brainCoral, rng),
      () => brainCoral(MAT.coralMustard, rng),
      () => fanCoral(MAT.coralRed, rng),
      () => fanCoral(MAT.coralPurple, rng),
      () => fanCoral(MAT.coralPink, rng),
      () => tubeCoral(MAT.coralOrange, rng),
      () => tubeCoral(MAT.coralMustard, rng),
      () => tableCoral(MAT.coralPurple, rng),
      () => tableCoral(MAT.coralMustard, rng),
      () => pillarCoral(MAT.brainCoral, rng),
      () => pillarCoral(MAT.coralOrange, rng),
      () => seaWhip(MAT.coralRed, rng),
      () => seaWhip(MAT.coralPink, rng),
    ];

    // Shuffle deterministically — pick N pieces scaled to the mound size.
    const pieceCount = Math.round(7 + moundRadius * 1.5);
    const order = [...factories.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const chosen = order.slice(0, pieceCount);

    // Mound shape parameters — match the scale applied to the mound mesh.
    // The mound is a half-sphere (radius=moundRadius) scaled non-uniformly,
    // so its visible surface at horizontal radius r is given by an ellipse.
    const moundHorizontal = 1.3 * moundRadius;
    const moundHeight = 0.7 * moundRadius;

    // Place each piece on the mound surface for its angle/radius. Tilt
    // outward slightly so corals lean off the mound's central axis.
    for (let i = 0; i < chosen.length; i++) {
      const angle = (i / chosen.length) * Math.PI * 2 + rng() * 0.6;
      // Sample within the top of the dome so pieces stay visible, not too
      // close to the rim where they'd hang off the side.
      const radius = (0.15 + rng() * 0.7) * moundHorizontal;
      const surfY = moundHeight * Math.sqrt(
        Math.max(0, 1 - (radius / moundHorizontal) ** 2),
      );
      const piece = factories[chosen[i]!]!();
      piece.position.set(
        Math.cos(angle) * radius,
        surfY,
        Math.sin(angle) * radius,
      );
      piece.rotation.y = rng() * Math.PI * 2;
      // Lean outward a little — direction depends on the placement angle.
      const leanMag = 0.18 * (radius / moundHorizontal);
      piece.rotation.z = -Math.cos(angle) * leanMag;
      piece.rotation.x = Math.sin(angle) * leanMag;
      g.add(piece);
    }

    // A few small encrusting bumps directly on the mound — tiny half-spheres
    // in coral colors that suggest the reef is alive at small scale too.
    const encrustColors = [MAT.coralPink, MAT.coralOrange, MAT.coralPurple, MAT.coralRed, MAT.brainCoral];
    const encrustCount = Math.round(6 + moundRadius * 2);
    for (let i = 0; i < encrustCount; i++) {
      const angle = rng() * Math.PI * 2;
      const r = rng() * moundRadius * 1.1;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      // y on the mound surface — approximate by the squashed-sphere envelope
      const yLocal = Math.max(0, Math.sqrt(Math.max(0, 1 - (r / (moundRadius * 1.3)) ** 2))) * moundRadius * 0.7;
      const size = 0.07 + rng() * 0.13;
      const bump = new THREE.Mesh(
        new THREE.SphereGeometry(size, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2),
        encrustColors[Math.floor(rng() * encrustColors.length)]!,
      );
      bump.position.set(x, yLocal, z);
      bump.scale.y = 0.5 + rng() * 0.3;
      bump.castShadow = true;
      g.add(bump);
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
  // mergeVertices collapses pole + seam duplicates so per-vertex jitter
  // doesn't tear the dome apart.
  const geo = mergeVertices(
    new THREE.SphereGeometry(0.7, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
  );
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

/**
 * Table coral — flat horizontal disc on a thick stem, like a mushroom.
 * Wide cap shades the area underneath; common reef-flat species.
 */
function tableCoral(mat: THREE.Material, rng: () => number): THREE.Group {
  const g = new THREE.Group();

  // Stem
  const stem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12, 0.18, 0.45, 8),
    MAT.rock,
  );
  stem.position.y = 0.22;
  stem.castShadow = true;
  g.add(stem);

  // Cap — flat lumpy disc. Merge duplicate pole/seam vertices before per-
  // vertex Y jitter or the rim cracks open at the dome apex.
  const capGeo = mergeVertices(
    new THREE.SphereGeometry(0.6, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  );
  const positions = capGeo.attributes.position!;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const r = Math.sqrt(x * x + z * z);
    if (r > 0.3) positions.setY(i, positions.getY(i) + (rng() - 0.5) * 0.05);
  }
  capGeo.computeVertexNormals();
  const cap = new THREE.Mesh(capGeo, mat);
  cap.scale.set(1.0, 0.18, 1.0);
  cap.position.y = 0.48;
  cap.castShadow = true;
  cap.receiveShadow = true;
  g.add(cap);

  return g;
}

/**
 * Pillar coral — tall narrow vertical column (or two), like Dendrogyra.
 * Reads as a totem-pole shape in the reef silhouette.
 */
function pillarCoral(mat: THREE.Material, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const pillarCount = 1 + Math.floor(rng() * 2);

  for (let i = 0; i < pillarCount; i++) {
    const h = 0.7 + rng() * 0.5;
    const r = 0.1 + rng() * 0.06;
    const geo = new THREE.CylinderGeometry(r * 0.8, r * 1.1, h, 10);
    // Slight twist + tapered tip.
    geo.translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, mat);
    if (pillarCount > 1) {
      const angle = (i / pillarCount) * Math.PI * 2 + rng() * 0.5;
      const d = 0.12 + rng() * 0.08;
      m.position.set(Math.cos(angle) * d, 0, Math.sin(angle) * d);
    }
    m.rotation.z = (rng() - 0.5) * 0.15;
    m.rotation.x = (rng() - 0.5) * 0.15;
    m.castShadow = true;
    g.add(m);

    // Cap nub at the top so the column reads as alive, not chopped off.
    const cap = new THREE.Mesh(new THREE.SphereGeometry(r * 1.05, 8, 6), mat);
    cap.position.copy(m.position);
    cap.position.y += h;
    g.add(cap);
  }

  return g;
}

/**
 * Sea whip — a single tall slender stalk that curves gently, like Plexaura.
 * Builds the curve as a series of small spheres along a sine-bent line so
 * it reads as soft and organic without a costly tube geometry.
 */
function seaWhip(mat: THREE.Material, rng: () => number): THREE.Group {
  const g = new THREE.Group();
  const segments = 18;
  const length = 1.2 + rng() * 0.4;
  const bendAngle = rng() * Math.PI * 2;
  const bendAmount = 0.2 + rng() * 0.18;

  // Geometry shared between segments — small bead.
  const beadGeo = new THREE.SphereGeometry(0.05, 6, 5);

  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1);
    const y = t * length;
    // Curve grows toward the tip, biased in the bend direction.
    const offset = Math.sin(t * Math.PI * 0.6) * bendAmount;
    const x = Math.cos(bendAngle) * offset;
    const z = Math.sin(bendAngle) * offset;
    const bead = new THREE.Mesh(beadGeo, mat);
    bead.position.set(x, y, z);
    bead.scale.setScalar(1 - t * 0.35); // taper toward the tip
    bead.castShadow = true;
    g.add(bead);
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
