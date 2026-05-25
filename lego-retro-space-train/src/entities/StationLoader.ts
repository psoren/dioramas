import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { StationDef, getTrackRoute } from '../world/TrackPath';
import { MonorailTrain } from './MonorailTrain';
import { emit } from '../sim/EventBus';

type LoaderMode = 'waiting' | 'loading' | 'unloading' | 'dwell';

interface Transfer {
  crate: THREE.Object3D;
  from: THREE.Vector3;
  to: THREE.Vector3;
  progress: number;
  action: 'load' | 'unload';
}

interface DeliveredCrate {
  crate: THREE.Object3D;
  rest: number;
}

interface OutgoingCrate {
  crate: THREE.Object3D;
  destinationId: string;
}

export interface StationLoaderOptions {
  // Legacy TrackPath mode: look up station by route + stationId.
  routeId?: string;
  stationId?: string;
  // Direct mode: caller supplies the station definition. Used by the
  // tile-system manifest builder which derives these from a layout cell.
  // Takes precedence over routeId/stationId if both supplied.
  stationPosition?: THREE.Vector3Tuple;
  stationQueueDirection?: THREE.Vector3Tuple;
  stationT?: number;
  /** IDs of other stations this loader can ship cargo to. Used to seed
   *  initial outgoing crates and pick destinations for redispatch. */
  destinationIds?: string[];
}

// Per-station color so destinations are visually identifiable on the crate cap.
const STATION_COLORS: Record<string, number> = {
  'command-station': 0xff6b35,
  'north-depot': 0x4cc9f0,
  'south-yard': 0xf9c80e,
  'ridge-station': 0x9d4edd,
  'south-cargo': 0x06d6a0,
  'shuttle-north': 0xef476f,
  'shuttle-south': 0x118ab2,
};

function destinationColor(stationId: string): number {
  return STATION_COLORS[stationId] ?? 0xcccccc;
}

const DELIVERED_REST = 4.0; // seconds a delivered crate rests before redispatch
const INITIAL_OUTGOING = 3;

export class StationLoader implements Entity {
  readonly object3d: THREE.Group;

  private readonly stationT: number;
  private readonly station: StationDef;
  private readonly destinations: string[];
  private readonly outgoing: OutgoingCrate[] = [];
  private readonly delivered: DeliveredCrate[] = [];
  private readonly armPivot: THREE.Group;
  private mode: LoaderMode = 'waiting';
  private transfer?: Transfer;
  private dwell = 0;
  private releaseT = 0;

  constructor(
    private readonly train: MonorailTrain,
    opts: StationLoaderOptions = {},
  ) {
    if (opts.stationPosition && opts.stationQueueDirection && opts.stationT != null) {
      this.station = {
        id: opts.stationId ?? 'station',
        position: opts.stationPosition,
        queueDirection: opts.stationQueueDirection,
        t: opts.stationT,
      };
      this.destinations = opts.destinationIds ?? [];
    } else {
      const route = getTrackRoute(opts.routeId);
      this.station = route.stations.find((s) => s.id === opts.stationId) ?? route.stations[0]!;
      this.destinations = route.stations
        .filter((s) => s.id !== this.station.id)
        .map((s) => s.id);
    }
    this.stationT = this.station.t;
    const built = this.build();
    this.object3d = built.group;
    this.armPivot = built.armPivot;
  }

  update(dt: number): void {
    this.animateIdle(dt);
    this.cycleDelivered(dt);

    if (this.mode === 'loading' || this.mode === 'unloading') {
      this.stepTransfer(dt);
      return;
    }

    if (this.mode === 'dwell') {
      this.dwell -= dt;
      if (this.dwell <= 0) this.mode = 'waiting';
      return;
    }

    // waiting
    if (this.isTrainDocked() && this.train.t !== this.releaseT) {
      this.train.hold(`station:${this.station.id}`);
      const next = this.pickNextTransfer();
      if (next) {
        this.beginTransfer(next.crate, next.action, next.destinationId);
      } else {
        this.releaseTrain();
      }
    }
  }

  private pickNextTransfer():
    | { crate: THREE.Object3D; action: 'load'; destinationId: string }
    | { crate: THREE.Object3D; action: 'unload'; destinationId?: undefined }
    | undefined {
    // Priority 1: unload any crate destined for us
    const incoming = this.train.unloadCargoFor(this.station.id);
    if (incoming) return { crate: incoming, action: 'unload' };

    // Priority 2: load an outgoing crate if the train has space
    if (this.outgoing.length > 0 && this.train.hasCargoSpace()) {
      const next = this.outgoing.shift()!;
      this.reflowOutgoingPositions();
      return { crate: next.crate, action: 'load', destinationId: next.destinationId };
    }

    return undefined;
  }

  private build(): { group: THREE.Group; armPivot: THREE.Group } {
    const g = new THREE.Group();
    const pos = new THREE.Vector3().fromArray(this.station.position);
    const queueDir = new THREE.Vector3().fromArray(this.station.queueDirection).normalize();
    const side = new THREE.Vector3(-queueDir.z, 0, queueDir.x).normalize();
    g.position.copy(pos);

    const mastPos = side.clone().multiplyScalar(0.85).add(queueDir.clone().multiplyScalar(0.35));

    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.15, 0.14), MAT.grayDark);
    mast.position.set(mastPos.x, 0.63, mastPos.z);
    mast.castShadow = true;
    g.add(mast);

    const armPivot = new THREE.Group();
    armPivot.position.set(mastPos.x, 1.16, mastPos.z);
    g.add(armPivot);

    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.1, 0.1), MAT.yellow);
    arm.position.x = -0.48;
    arm.castShadow = true;
    armPivot.add(arm);

    const claw = new THREE.Group();
    claw.position.set(-0.96, -0.16, 0);
    const hook = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.22, 0.08), MAT.grayDark);
    hook.castShadow = true;
    claw.add(hook);
    armPivot.add(claw);

    // Identifier plaque so each station is visually distinct.
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.18, 0.08),
      new THREE.MeshStandardMaterial({ color: destinationColor(this.station.id), roughness: 0.5 }),
    );
    plaque.position.set(0, 0.98, -0.78);
    plaque.castShadow = true;
    g.add(plaque);

    // Seed initial outgoing crates, cycling through the configured destinations.
    if (this.destinations.length > 0) {
      for (let i = 0; i < INITIAL_OUTGOING; i++) {
        const destinationId = this.destinations[i % this.destinations.length]!;
        const crate = buildCargoCrate(destinationColor(destinationId));
        crate.userData.destinationId = destinationId;
        crate.position.copy(this.outgoingPosition(this.outgoing.length));
        this.outgoing.push({ crate, destinationId });
        g.add(crate);
      }
    }

    return { group: g, armPivot };
  }

  private beginTransfer(crate: THREE.Object3D, action: 'load' | 'unload', destinationId?: string): void {
    const from = new THREE.Vector3();
    const to = new THREE.Vector3();

    if (action === 'load') {
      crate.getWorldPosition(from);
      to.copy(this.train.getCargoDockWorldPosition());
      if (destinationId !== undefined) crate.userData.destinationId = destinationId;
    } else {
      from.copy(this.train.getCargoDockWorldPosition());
      to.copy(this.object3d.localToWorld(this.deliveredPosition(this.delivered.length)));
      this.object3d.attach(crate);
    }

    this.transfer = { crate, from, to, progress: 0, action };
    this.mode = action === 'load' ? 'loading' : 'unloading';
  }

  private stepTransfer(dt: number): void {
    if (!this.transfer) return;
    const transfer = this.transfer;
    transfer.progress = Math.min(1, transfer.progress + dt * 1.4);
    const eased = easeInOut(transfer.progress);
    const lift = Math.sin(eased * Math.PI) * 0.8;
    const pos = new THREE.Vector3().lerpVectors(transfer.from, transfer.to, eased);
    pos.y += lift;
    transfer.crate.position.copy(this.object3d.worldToLocal(pos.clone()));

    this.armPivot.lookAt(transfer.crate.position.x, this.armPivot.position.y, transfer.crate.position.z);

    if (transfer.progress < 1) return;

    if (transfer.action === 'load') {
      this.train.loadCargo(transfer.crate);
      const dest = transfer.crate.userData.destinationId as string | undefined;
      emit('cargo-loaded', `📦 Loaded ${this.station.id} → ${dest ?? '?'}`);
    } else {
      this.delivered.push({ crate: transfer.crate, rest: DELIVERED_REST });
      transfer.crate.position.copy(this.deliveredPosition(this.delivered.length - 1));
      emit('cargo-delivered', `✅ Delivered to ${this.station.id}`);
    }
    this.transfer = undefined;
    this.beginDwell();
  }

  private beginDwell(): void {
    this.mode = 'dwell';
    this.dwell = 0.4;
  }

  private releaseTrain(): void {
    this.mode = 'waiting';
    this.releaseT = this.train.t;
    this.train.release(`station:${this.station.id}`);
  }

  private isTrainDocked(): boolean {
    const d = Math.abs(shortestDelta01(this.train.t, this.stationT));
    const movedSinceRelease = Math.abs(shortestDelta01(this.train.t, this.releaseT)) > 0.03;
    return d < 0.02 && movedSinceRelease;
  }

  private animateIdle(dt: number): void {
    this.armPivot.rotation.y += Math.sin(performance.now() * 0.001) * dt * 0.04;
  }

  private cycleDelivered(dt: number): void {
    if (this.delivered.length === 0) return;
    for (let i = this.delivered.length - 1; i >= 0; i--) {
      const d = this.delivered[i]!;
      d.rest -= dt;
      if (d.rest <= 0) {
        const destinationId = this.pickNextDestination();
        d.crate.userData.destinationId = destinationId;
        const cap = d.crate.children.find((c) => c.userData.isCap) as THREE.Mesh | undefined;
        if (cap) (cap.material as THREE.MeshStandardMaterial).color.setHex(destinationColor(destinationId));
        d.crate.position.copy(this.outgoingPosition(this.outgoing.length));
        this.outgoing.push({ crate: d.crate, destinationId });
        this.delivered.splice(i, 1);
      }
    }
    this.reflowDeliveredPositions();
  }

  private pickNextDestination(): string {
    if (this.destinations.length === 0) return this.station.id;
    return this.destinations[Math.floor(Math.random() * this.destinations.length)]!;
  }

  private outgoingPosition(index: number): THREE.Vector3 {
    const queueDir = new THREE.Vector3().fromArray(this.station.queueDirection).normalize();
    const side = new THREE.Vector3(-queueDir.z, 0, queueDir.x).normalize();
    return queueDir.multiplyScalar(0.72 + index * 0.34).add(side.multiplyScalar(0.72)).setY(0.11);
  }

  private deliveredPosition(index: number): THREE.Vector3 {
    const queueDir = new THREE.Vector3().fromArray(this.station.queueDirection).normalize();
    const side = new THREE.Vector3(-queueDir.z, 0, queueDir.x).normalize();
    return queueDir.multiplyScalar(-0.38 - index * 0.34).add(side.multiplyScalar(0.72)).setY(0.11);
  }

  private reflowOutgoingPositions(): void {
    for (let i = 0; i < this.outgoing.length; i++) {
      this.outgoing[i]!.crate.position.copy(this.outgoingPosition(i));
    }
  }

  private reflowDeliveredPositions(): void {
    for (let i = 0; i < this.delivered.length; i++) {
      this.delivered[i]!.crate.position.copy(this.deliveredPosition(i));
    }
  }
}

function buildCargoCrate(capColor: number): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.22, 0.26), MAT.white);
  body.castShadow = true;
  g.add(body);

  const cap = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.05, 0.3),
    new THREE.MeshStandardMaterial({ color: capColor, roughness: 0.5 }),
  );
  cap.position.y = 0.135;
  cap.castShadow = true;
  cap.userData.isCap = true;
  g.add(cap);
  return g;
}

function shortestDelta01(a: number, b: number): number {
  return (((a - b + 0.5) % 1) + 1) % 1 - 0.5;
}

function easeInOut(t: number): number {
  return t * t * (3 - 2 * t);
}
