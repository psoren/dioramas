import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { Sim } from '../sim/Sim';
import { WorldState } from '../world/WorldState';
import { MAT } from '../world/materials';
import { MigratingSchool } from './MigratingSchool';
import { PlanktonBloom } from './PlanktonBloom';
import { BubbleVent } from './BubbleVent';
import { MorayEel } from './MorayEel';
import { Octopus } from './Octopus';
import { FishSchool } from './FishSchool';

export interface EventSchedulerOptions {
  sim: Sim;
  worldState: WorldState;
  /** Schools the shark can target during a hunt. */
  huntableSchools: FishSchool[];
  /** Bubble vents the scheduler triggers in bursts. */
  vents: BubbleVent[];
  /** Eel (single instance for now) the scheduler can prod into ambush. */
  eel?: MorayEel;
  /** Octopus + its candidate rocks to jet between. */
  octopus?: Octopus;
  octopusRocks?: Array<[number, number, number]>;
}

interface PendingMigration {
  entity: MigratingSchool;
}
interface PendingBloom {
  entity: PlanktonBloom;
}

const CURRENT_ROTATION_PERIOD = 360; // 6 minutes for one full rotation
const STORM_PERIOD = 600;            // 10 minutes for one storm cycle
const STORM_WIDTH = 0.12;            // fraction of cycle the storm is active

const HUNT_INTERVAL_MIN = 30;
const HUNT_INTERVAL_MAX = 55;
const HUNT_RAMP = 3;
const HUNT_HOLD = 4;
const HUNT_FADE = 3;

const MIGRATION_INTERVAL_MIN = 60;
const MIGRATION_INTERVAL_MAX = 120;

const BLOOM_INTERVAL_MIN = 30;
const BLOOM_INTERVAL_MAX = 60;

const VENT_BURST_INTERVAL_MIN = 12;
const VENT_BURST_INTERVAL_MAX = 28;

const OCTOPUS_INTERVAL_MIN = 90;
const OCTOPUS_INTERVAL_MAX = 200;

const EEL_AMBUSH_INTERVAL_MIN = 20;
const EEL_AMBUSH_INTERVAL_MAX = 45;

/**
 * Central event-driving entity. Writes continuous fields on `WorldState`
 * (`current`, `storm`, `sharkHunt`) and fires discrete events that other
 * entities listen to (eel ambush, octopus relocate, bubble vent burst).
 * Also spawns short-lived entities (migrating schools, plankton blooms)
 * directly into the sim and disposes them when they signal they're done.
 *
 * One-stop shop for "what's happening right now"; modify here to add or
 * tune scripted beats.
 */
export class EventScheduler implements Entity {
  readonly object3d = new THREE.Group(); // logic-only, no visual

  private readonly sim: Sim;
  private readonly worldState: WorldState;
  private readonly schools: FishSchool[];
  private readonly vents: BubbleVent[];
  private readonly eel: MorayEel | undefined;
  private readonly octopus: Octopus | undefined;
  private readonly octopusRocks: Array<[number, number, number]>;

  private elapsed = 0;
  // Shark hunt timing
  private nextHunt: number;
  private huntStart = 0;
  private huntActive = false;
  // Migrating schools
  private nextMigration: number;
  private activeMigrations: PendingMigration[] = [];
  // Plankton blooms
  private nextBloom: number;
  private activeBlooms: PendingBloom[] = [];
  // Bubble vent bursts
  private nextVentBurst: number;
  // Octopus relocation
  private nextOctopusRelocate: number;
  // Eel ambush
  private nextEelAmbush: number;

  constructor(opts: EventSchedulerOptions) {
    this.sim = opts.sim;
    this.worldState = opts.worldState;
    this.schools = opts.huntableSchools;
    this.vents = opts.vents;
    this.eel = opts.eel;
    this.octopus = opts.octopus;
    this.octopusRocks = opts.octopusRocks ?? [];

    // Stagger first occurrences so the scene doesn't trigger everything at once.
    this.nextHunt = 15 + Math.random() * 10;
    this.nextMigration = 25 + Math.random() * 15;
    this.nextBloom = 8 + Math.random() * 8;
    this.nextVentBurst = 6 + Math.random() * 8;
    this.nextOctopusRelocate = 60 + Math.random() * 60;
    this.nextEelAmbush = 12 + Math.random() * 10;
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.elapsed += dt;

    this.updateContinuous(dt);
    this.updateSharkHunt(dt);
    this.updateMigrations();
    this.updateBlooms();
    this.updateVentBursts();
    this.updateOctopus();
    this.updateEel();
  }

  // ---------- continuous fields ----------

  private updateContinuous(_dt: number): void {
    // Slowly rotating drift current.
    const angle = (this.elapsed / CURRENT_ROTATION_PERIOD) * Math.PI * 2;
    // Storm cycle — a single-cycle sin pulse that's high only briefly each period.
    const sp = (this.elapsed % STORM_PERIOD) / STORM_PERIOD; // 0..1
    let stormStrength = 0;
    if (sp > 0.5 - STORM_WIDTH / 2 && sp < 0.5 + STORM_WIDTH / 2) {
      const u = (sp - (0.5 - STORM_WIDTH / 2)) / STORM_WIDTH;
      stormStrength = Math.sin(u * Math.PI);
    }
    this.worldState.storm = stormStrength;

    // Current magnitude — gentle by default, surge during storm.
    const mag = 0.08 + stormStrength * 0.35;
    this.worldState.current.set(Math.cos(angle) * mag, 0, Math.sin(angle) * mag);
  }

  // ---------- shark hunt ----------

  private updateSharkHunt(_dt: number): void {
    const hunt = this.worldState.sharkHunt;
    if (this.huntActive) {
      const since = this.elapsed - this.huntStart;
      const total = HUNT_RAMP + HUNT_HOLD + HUNT_FADE;
      if (since < HUNT_RAMP) {
        hunt.intensity = since / HUNT_RAMP;
      } else if (since < HUNT_RAMP + HUNT_HOLD) {
        hunt.intensity = 1;
      } else if (since < total) {
        hunt.intensity = 1 - (since - HUNT_RAMP - HUNT_HOLD) / HUNT_FADE;
      } else {
        // End of hunt.
        hunt.active = false;
        hunt.intensity = 0;
        hunt.speedMultiplier = 1;
        this.huntActive = false;
        this.nextHunt = this.elapsed
          + HUNT_INTERVAL_MIN
          + Math.random() * (HUNT_INTERVAL_MAX - HUNT_INTERVAL_MIN);
        return;
      }
      hunt.speedMultiplier = 1 + hunt.intensity * 2.2;
    } else if (this.elapsed >= this.nextHunt) {
      // Begin a new hunt — pick a school target.
      const target = this.schools[Math.floor(Math.random() * this.schools.length)];
      if (target) hunt.targetCentre.copy(this.localCentreOf(target));
      hunt.active = true;
      hunt.intensity = 0;
      hunt.speedMultiplier = 1;
      this.huntActive = true;
      this.huntStart = this.elapsed;
    }
  }

  private localCentreOf(school: FishSchool): THREE.Vector3 {
    // The school's group position is (0,0,0); fish positions live as
    // children. Returning the group's world position is good enough since
    // boids drift around it.
    return new THREE.Vector3().setFromMatrixPosition(school.object3d.matrixWorld);
  }

  // ---------- migrating schools ----------

  private updateMigrations(): void {
    if (this.elapsed >= this.nextMigration) {
      this.spawnMigration();
      this.nextMigration = this.elapsed
        + MIGRATION_INTERVAL_MIN
        + Math.random() * (MIGRATION_INTERVAL_MAX - MIGRATION_INTERVAL_MIN);
    }
    // Reap finished migrations.
    for (let i = this.activeMigrations.length - 1; i >= 0; i--) {
      const m = this.activeMigrations[i]!;
      if (m.entity.done) {
        this.sim.remove(m.entity);
        this.activeMigrations.splice(i, 1);
      }
    }
  }

  private spawnMigration(): void {
    // Pick two opposite edge points + a random altitude.
    const angle = Math.random() * Math.PI * 2;
    const r = 24;
    const y = 4 + Math.random() * 4;
    const start = new THREE.Vector3(Math.cos(angle) * r, y, Math.sin(angle) * r);
    const end = new THREE.Vector3(-Math.cos(angle) * r, y, -Math.sin(angle) * r);

    // Random species — pick from a small palette so it feels distinct.
    const palette = [MAT.fishYellow, MAT.fishBlue, MAT.fishSilver, MAT.fishCyan, MAT.fishGold];
    const material = palette[Math.floor(Math.random() * palette.length)]!;
    const entity = new MigratingSchool({
      start,
      end,
      material,
      count: 18 + Math.floor(Math.random() * 18),
      fishLength: 0.2 + Math.random() * 0.15,
      speed: 1.0 + Math.random() * 0.8,
      spread: 1.0 + Math.random() * 0.8,
    });
    this.sim.add(entity);
    this.activeMigrations.push({ entity });
  }

  // ---------- plankton blooms ----------

  private updateBlooms(): void {
    if (this.elapsed >= this.nextBloom) {
      this.spawnBloom();
      this.nextBloom = this.elapsed
        + BLOOM_INTERVAL_MIN
        + Math.random() * (BLOOM_INTERVAL_MAX - BLOOM_INTERVAL_MIN);
    }
    for (let i = this.activeBlooms.length - 1; i >= 0; i--) {
      const b = this.activeBlooms[i]!;
      if (b.entity.done) {
        this.sim.remove(b.entity);
        this.activeBlooms.splice(i, 1);
      }
    }
  }

  private spawnBloom(): void {
    const centre = new THREE.Vector3(
      (Math.random() - 0.5) * 30,
      2 + Math.random() * 7,
      (Math.random() - 0.5) * 30,
    );
    const entity = new PlanktonBloom({
      centre,
      radius: 2 + Math.random() * 2,
      count: 60 + Math.floor(Math.random() * 60),
      duration: 18 + Math.random() * 12,
    });
    this.sim.add(entity);
    this.activeBlooms.push({ entity });
  }

  // ---------- bubble vent bursts ----------

  private updateVentBursts(): void {
    if (this.vents.length === 0) return;
    if (this.elapsed < this.nextVentBurst) return;
    const vent = this.vents[Math.floor(Math.random() * this.vents.length)]!;
    vent.burst(8 + Math.floor(Math.random() * 8));
    this.nextVentBurst = this.elapsed
      + VENT_BURST_INTERVAL_MIN
      + Math.random() * (VENT_BURST_INTERVAL_MAX - VENT_BURST_INTERVAL_MIN);
  }

  // ---------- octopus relocate ----------

  private updateOctopus(): void {
    if (!this.octopus || this.octopusRocks.length === 0) return;
    if (this.elapsed < this.nextOctopusRelocate) return;
    const target = this.octopusRocks[Math.floor(Math.random() * this.octopusRocks.length)]!;
    this.octopus.relocate(target);
    this.nextOctopusRelocate = this.elapsed
      + OCTOPUS_INTERVAL_MIN
      + Math.random() * (OCTOPUS_INTERVAL_MAX - OCTOPUS_INTERVAL_MIN);
  }

  // ---------- eel ambush ----------

  private updateEel(): void {
    if (!this.eel) return;
    if (this.elapsed < this.nextEelAmbush) return;
    this.eel.ambush();
    this.nextEelAmbush = this.elapsed
      + EEL_AMBUSH_INTERVAL_MIN
      + Math.random() * (EEL_AMBUSH_INTERVAL_MAX - EEL_AMBUSH_INTERVAL_MIN);
  }
}
