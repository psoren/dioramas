import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { buildAstronautMesh } from '../world/figures';

export interface AstronautPedestrianOptions {
  /** Bounding annulus the pedestrian wanders inside. */
  innerRadius: number;
  outerRadius: number;
  /** Center the annulus is concentric with. Defaults to (0, 0). */
  center?: [number, number];
  /** Ground Y the astronaut walks on. Default 0. */
  groundY?: number;
  /** Forward walking speed (units/sec). Default 0.7. */
  speed?: number;
}

type SleepState = 'wander' | 'going-home' | 'fading-out' | 'sleeping' | 'fading-in';

/**
 * Astronaut that wanders an annulus of ground. Optionally assigned a "home"
 * via `setHome(worldPos)`. While wandering they have a small chance per
 * second to head home; on arrival they fade out, sleep for a while, fade
 * back in, and resume wandering.
 *
 * Heading aligns with movement direction. Arms and legs sway while moving
 * and rest while paused.
 */
export class AstronautPedestrian implements Entity {
  readonly object3d: THREE.Group;
  private readonly armL: THREE.Mesh;
  private readonly armR: THREE.Mesh;
  private readonly legL: THREE.Mesh;
  private readonly legR: THREE.Mesh;

  private readonly innerR: number;
  private readonly outerR: number;
  private readonly cx: number;
  private readonly cz: number;
  private readonly groundY: number;
  private readonly speed: number;

  private home: THREE.Vector2 | null = null;
  private state: SleepState = 'wander';
  private waypoint: THREE.Vector2;
  private restTimer = 0;
  private sleepTimer = 0;
  private fadeProgress = 0;
  private gait = 0;

  constructor(opts: AstronautPedestrianOptions) {
    this.innerR = opts.innerRadius;
    this.outerR = opts.outerRadius;
    [this.cx, this.cz] = opts.center ?? [0, 0];
    this.groundY = opts.groundY ?? 0;
    this.speed = opts.speed ?? 0.7;

    const built = buildAstronautMesh();
    this.object3d = built.group;
    this.armL = built.armL;
    this.armR = built.armR;
    this.legL = built.legL;
    this.legR = built.legR;

    const start = this.randomPoint();
    this.object3d.position.set(start.x, this.groundY, start.y);
    this.waypoint = this.randomPoint();
    this.gait = Math.random() * Math.PI * 2;
  }

  /** Assign a world-space "home" the pedestrian periodically walks to and sleeps at. */
  setHome(worldPos: THREE.Vector3): void {
    this.home = new THREE.Vector2(worldPos.x, worldPos.z);
  }

  update(dt: number): void {
    if (dt <= 0) return;

    switch (this.state) {
      case 'wander': {
        this.tickWander(dt);
        // ~1/120s chance per second to head home — average wander stretch of
        // ~2 minutes between sleeps. Spread out enough that the apartment
        // doesn't constantly drain pedestrians from the scene.
        if (this.home && Math.random() < dt / 120) {
          this.waypoint = this.home.clone();
          this.state = 'going-home';
        }
        break;
      }
      case 'going-home': {
        const arrived = this.walkToward(this.waypoint, dt);
        if (arrived) {
          this.state = 'fading-out';
          this.fadeProgress = 0;
        }
        break;
      }
      case 'fading-out': {
        this.fadeProgress += dt;
        const s = Math.max(0, 1 - this.fadeProgress);
        this.object3d.scale.setScalar(s);
        if (s <= 0) {
          this.state = 'sleeping';
          this.sleepTimer = 25 + Math.random() * 25; // 25–50 sec nap
          this.object3d.visible = false;
        }
        break;
      }
      case 'sleeping': {
        this.sleepTimer -= dt;
        if (this.sleepTimer <= 0) {
          this.state = 'fading-in';
          this.fadeProgress = 0;
          this.object3d.visible = true;
        }
        break;
      }
      case 'fading-in': {
        this.fadeProgress += dt;
        const s = Math.min(1, this.fadeProgress);
        this.object3d.scale.setScalar(s);
        if (s >= 1) {
          this.state = 'wander';
          this.waypoint = this.randomPoint();
        }
        break;
      }
    }
  }

  /** Roam-with-pauses behavior. Returns nothing — modifies internal state. */
  private tickWander(dt: number): void {
    if (this.restTimer > 0) {
      this.restTimer -= dt;
      this.settleLimbs();
      return;
    }
    const arrived = this.walkToward(this.waypoint, dt);
    if (arrived) {
      this.restTimer = 0.8 + Math.random() * 2.2;
      this.waypoint = this.randomPoint();
    }
  }

  /** Walk one step toward a waypoint. Returns true if arrived this tick. */
  private walkToward(target: THREE.Vector2, dt: number): boolean {
    const pos = this.object3d.position;
    const dx = target.x - pos.x;
    const dz = target.y - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.18) return true;

    const step = Math.min(dist, this.speed * dt);
    const dirX = dx / dist;
    const dirZ = dz / dist;
    pos.x += dirX * step;
    pos.z += dirZ * step;
    this.object3d.rotation.y = Math.atan2(dirX, dirZ);

    this.gait += dt * 6.5;
    const legSwing = Math.sin(this.gait) * 0.5;
    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.armL.rotation.x = -legSwing * 0.7;
    this.armR.rotation.x = legSwing * 0.7;
    return false;
  }

  private settleLimbs(): void {
    this.armL.rotation.x *= 0.9;
    this.armR.rotation.x *= 0.9;
    this.legL.rotation.x *= 0.9;
    this.legR.rotation.x *= 0.9;
  }

  private randomPoint(): THREE.Vector2 {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(
      this.innerR * this.innerR +
        Math.random() * (this.outerR * this.outerR - this.innerR * this.innerR),
    );
    return new THREE.Vector2(this.cx + Math.cos(angle) * r, this.cz + Math.sin(angle) * r);
  }
}
