import * as THREE from 'three';
import { Entity } from '../sim/Entity';

export interface MigratingSchoolOptions {
  /** World start point. School spawns here. */
  start: THREE.Vector3;
  /** World end point. Once all fish pass this, the entity self-marks done. */
  end: THREE.Vector3;
  count?: number;
  material: THREE.Material;
  fishLength?: number;
  speed?: number;
  spread?: number;
}

/**
 * A short-lived fish school that crosses the scene in roughly a straight
 * line from `start` to `end`. Lighter than `FishSchool` — no boids; each
 * fish carries its own forward velocity with small lateral wobble, and
 * the whole formation drifts together along the migration axis.
 *
 * The entity sets `done=true` once the last fish has cleared the end
 * point; the EventScheduler watches that flag to dispose it.
 */
export class MigratingSchool implements Entity {
  readonly object3d = new THREE.Group();
  /** Set true once every fish has passed the end of the route. */
  done = false;

  private readonly direction: THREE.Vector3;
  private readonly endProjection: number; // dot of (end - start) along dir
  private readonly fish: Array<{ mesh: THREE.Mesh; offset: THREE.Vector3; phase: number }> = [];
  private readonly speed: number;
  private readonly sharedGeo: THREE.BufferGeometry;
  private readonly tmpVec = new THREE.Vector3();
  private time = 0;

  constructor(opts: MigratingSchoolOptions) {
    const count = opts.count ?? 22;
    const fishLength = opts.fishLength ?? 0.28;
    const spread = opts.spread ?? 1.4;
    this.speed = opts.speed ?? 1.6;

    this.direction = new THREE.Vector3().subVectors(opts.end, opts.start);
    this.endProjection = this.direction.length();
    this.direction.normalize();

    this.sharedGeo = buildSimpleFishGeometry(fishLength);

    // Place fish near start with small lateral spread.
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(this.direction, up).normalize();
    if (right.lengthSq() < 0.01) right.set(1, 0, 0);

    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(this.sharedGeo, opts.material);
      mesh.castShadow = true;

      const lateral = (Math.random() - 0.5) * 2 * spread;
      const vertical = (Math.random() - 0.5) * spread;
      const along = -Math.random() * spread * 2; // start behind 0 so they trickle in

      const offset = new THREE.Vector3()
        .copy(right).multiplyScalar(lateral)
        .addScaledVector(up, vertical);

      mesh.position.copy(opts.start)
        .addScaledVector(this.direction, along)
        .add(offset);

      this.tmpVec.copy(mesh.position).addScaledVector(this.direction, 1);
      mesh.lookAt(this.tmpVec);

      this.object3d.add(mesh);
      this.fish.push({ mesh, offset, phase: Math.random() * Math.PI * 2 });
    }
  }

  update(dt: number): void {
    if (dt <= 0 || this.done) return;
    this.time += dt;

    let pastEnd = 0;
    for (const f of this.fish) {
      // March forward along the migration direction.
      f.mesh.position.addScaledVector(this.direction, this.speed * dt);
      // Subtle lateral wobble (so the line of fish is alive, not robotic).
      const wobble = Math.sin(this.time * 3 + f.phase) * 0.02;
      f.mesh.position.y += wobble;
      // Tail wag.
      f.mesh.rotation.z = Math.sin(this.time * 9 + f.phase) * 0.18;

      // Project onto direction to see if this fish is past the end.
      const along = f.mesh.position.dot(this.direction);
      if (along > this.endProjection) pastEnd++;
    }

    if (pastEnd === this.fish.length) this.done = true;
  }

  dispose(): void {
    this.sharedGeo.dispose();
  }
}

/**
 * Lighter geometry than the main FishSchool — these are background animals,
 * the player won't focus on them. 7-vert solid kite with a slight bend.
 */
function buildSimpleFishGeometry(length: number): THREE.BufferGeometry {
  const halfL = length / 2;
  const halfW = length * 0.16;
  const halfH = length * 0.1;

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array([
    0, 0, halfL,                 // 0 nose
    -halfW, 0, 0,                // 1 mid-left
     halfW, 0, 0,                // 2 mid-right
    0, halfH, 0,                 // 3 mid-top
    0, -halfH, 0,                // 4 mid-bottom
    0, 0, -halfL,                // 5 tail-base
    0, length * 0.16, -halfL * 1.2, // 6 tail-tip
  ]);
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setIndex([
    0, 1, 3,  0, 3, 2,  0, 2, 4,  0, 4, 1,
    5, 3, 1,  5, 2, 3,  5, 4, 2,  5, 1, 4,
    5, 6, 3,  3, 6, 5,
  ]);
  geo.computeVertexNormals();
  return geo;
}
