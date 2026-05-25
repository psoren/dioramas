import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { placeOnPath } from '../world/pathFollow';

export interface MantaRayOptions {
  path: THREE.CatmullRomCurve3;
  speed?: number;
  t?: number;
  /** Visual scale multiplier. Default 1. */
  scale?: number;
  /** Wing half-span (from body centre to wing tip). Default 1.7. */
  wingSpan?: number;
  /** Wing chord at the body (front-to-back size at the root). Default 1.0. */
  wingChord?: number;
}

/**
 * Manta ray. A wide flat glider whose wings flap deeply.
 *
 * Forward: +X. Wings extend laterally along ±Z. Up: +Y.
 *
 * Wing geometry is a tapered, slightly drooping plane built lying flat in
 * the XZ plane with the root at z=0 and the tip at z=-span. The right wing
 * uses the same geometry mirrored across Z.
 *
 * Animation: each wing pivots around its root (the body's side), rotating
 * around the X axis (so the tip moves up/down) with a deep slow sine.
 */
export class MantaRay implements Entity {
  readonly object3d: THREE.Group;
  private readonly path: THREE.CatmullRomCurve3;
  private readonly speed: number;
  private readonly body: THREE.Group;
  private readonly leftWing: THREE.Group;
  private readonly rightWing: THREE.Group;
  private t: number;
  private time = 0;

  constructor(opts: MantaRayOptions) {
    this.path = opts.path;
    this.speed = opts.speed ?? 0.012;
    this.t = opts.t ?? 0;
    const scale = opts.scale ?? 1;
    const span = opts.wingSpan ?? 1.7;
    const chord = opts.wingChord ?? 1.0;

    this.object3d = new THREE.Group();
    this.body = new THREE.Group();
    this.body.scale.setScalar(scale);
    this.object3d.add(this.body);

    // --- Central body: flat diamond, dark top + light belly ---
    const bodyGeo = new THREE.SphereGeometry(0.5, 18, 10);
    const body = new THREE.Mesh(bodyGeo, MAT.mantaTop);
    body.scale.set(1.4, 0.18, 0.7);
    body.castShadow = true;
    this.body.add(body);

    const belly = new THREE.Mesh(bodyGeo, MAT.mantaBelly);
    belly.scale.set(1.38, 0.16, 0.68);
    belly.position.y = -0.04;
    this.body.add(belly);

    // --- Wings: each wing is a tapered plane lying in the XZ plane ---
    // Build the LEFT wing geometry once (extends in -Z) and build the RIGHT
    // wing geometry independently (extends in +Z). Mirroring via geometry
    // scale(1,1,-1) flips face winding and back-face-culls one wing, so we
    // don't go that route. Both wings still share the same material — but
    // we use DoubleSide so paper-thin wings render correctly from either
    // camera angle (above or below).
    const wingMat = (MAT.mantaTop as THREE.MeshStandardMaterial).clone();
    wingMat.side = THREE.DoubleSide;

    const leftWingGeo = buildWingGeometry(span, chord, -1);
    this.leftWing = new THREE.Group();
    this.leftWing.position.set(0, 0, -0.25);
    const leftMesh = new THREE.Mesh(leftWingGeo, wingMat);
    leftMesh.castShadow = true;
    this.leftWing.add(leftMesh);
    this.body.add(this.leftWing);

    const rightWingGeo = buildWingGeometry(span, chord, +1);
    this.rightWing = new THREE.Group();
    this.rightWing.position.set(0, 0, 0.25);
    const rightMesh = new THREE.Mesh(rightWingGeo, wingMat);
    rightMesh.castShadow = true;
    this.rightWing.add(rightMesh);
    this.body.add(this.rightWing);

    // --- Cephalic horns: two small forward-pointing nubs at the head ---
    for (const z of [-0.18, 0.18]) {
      const horn = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.02, 0.28, 6), MAT.mantaTop);
      horn.rotation.z = -Math.PI / 2;
      horn.position.set(0.65, 0.02, z);
      this.body.add(horn);
    }

    // --- Tail: thin trailing nub (no stinger — mantas don't have one) ---
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.01, 0.9, 6), MAT.mantaTop);
    tail.rotation.z = Math.PI / 2;
    tail.position.set(-0.85, 0, 0);
    this.body.add(tail);
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;
    this.t = (this.t + this.speed * dt) % 1;
    placeOnPath(this.object3d, this.path, this.t);

    // Each wing rotates around its root's X axis — the tip moves up/down.
    // Left wing extends in -Z; rotating around +X by +θ raises its tip (+Y).
    // Right wing extends in +Z; the SAME rotation around +X drops its tip,
    // so we negate so both tips rise together.
    const flap = Math.sin(this.time * 1.2) * 0.6;
    this.leftWing.rotation.x = flap;
    this.rightWing.rotation.x = -flap;

    // Body pitches up slightly on the upstroke.
    this.body.rotation.z = flap * 0.06;
  }
}

/**
 * Build one wing geometry as a tapered, slightly drooping flat plane.
 *
 * The plane lies in the XZ plane. Root edge is at z=0 (chord goes from
 * x=-chord/2 to x=+chord/2). Tip edge is at z = direction * span, with
 * the chord narrowing to ~35% of root and the trailing edge swept back.
 * `direction` is -1 for the left wing (extends in -Z) or +1 for the right.
 */
function buildWingGeometry(span: number, chord: number, direction: -1 | 1): THREE.BufferGeometry {
  const SPAN_SEGMENTS = 8;
  const CHORD_SEGMENTS = 4;

  const geo = new THREE.PlaneGeometry(chord, span, CHORD_SEGMENTS, SPAN_SEGMENTS);
  // Rotate so the plane lies in the XZ plane. Rotating around X by ±π/2
  // chooses which Z direction the span runs.
  geo.rotateX(direction * -Math.PI / 2);
  // After rotation, the root edge is at the formerly-+Y side. Translate so
  // the root sits at z=0 and the tip at z=direction*span.
  geo.translate(0, 0, direction * span / 2);

  const positions = geo.attributes.position!;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const tipFactor = (direction * z) / span; // 0 at root, 1 at tip

    // Chord taper: narrow toward the tip.
    const taper = 1 - tipFactor * 0.65;
    let newX = x * taper;
    // Trailing edge sweep: push the back edge (x < 0) further back as we
    // move toward the tip, giving the wing a triangular silhouette.
    if (x < 0) {
      newX -= tipFactor * chord * 0.25;
    }
    positions.setX(i, newX);

    // Downward droop on the outer half of the wing.
    const droop = Math.max(0, tipFactor - 0.3) ** 2 * span * 0.15;
    positions.setY(i, -droop);
  }
  geo.computeVertexNormals();
  return geo;
}
