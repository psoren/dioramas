import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { emit } from '../sim/EventBus';

const MAT_BLACKTRON_YELLOW = new THREE.MeshStandardMaterial({
  color: 0xc7ff2e,
  emissive: 0x7f9f12,
  emissiveIntensity: 0.25,
  roughness: 0.35,
});

const MAT_ICE_ORANGE = new THREE.MeshStandardMaterial({
  color: 0xf08020,
  roughness: 0.5,
});

const MAT_ICE_BLUE_TRANS = new THREE.MeshStandardMaterial({
  color: 0xa8d8f0,
  transparent: true,
  opacity: 0.7,
  emissive: 0x60a0c0,
  emissiveIntensity: 0.35,
  roughness: 0.2,
});

const MAT_MTRON_RED = new THREE.MeshStandardMaterial({
  color: 0xc8261c,
  roughness: 0.4,
});

const MAT_MTRON_GREEN = new THREE.MeshStandardMaterial({
  color: 0x35a83c,
  emissive: 0x1f5f24,
  emissiveIntensity: 0.4,
  roughness: 0.35,
});

const MAT_POLICE_ORANGE_TRANS = new THREE.MeshStandardMaterial({
  color: 0xff8530,
  transparent: true,
  opacity: 0.78,
  emissive: 0xff5010,
  emissiveIntensity: 0.6,
  roughness: 0.2,
});

const MAT_POLICE_YELLOW = new THREE.MeshStandardMaterial({
  color: 0xffd000,
  emissive: 0xa07000,
  emissiveIntensity: 0.25,
  roughness: 0.4,
});

export interface PlacedEntityOptions {
  position?: THREE.Vector3Tuple;
  heading?: number;
}

type RocketState = 'idle' | 'ignition' | 'launching' | 'cooldown';

const MAT_DUST = new THREE.MeshStandardMaterial({
  color: 0xa8a8a0,
  transparent: true,
  opacity: 0.45,
  roughness: 1.0,
});

export class MicroRocketLaunchpad implements Entity {
  readonly object3d: THREE.Group;
  private readonly rocket: THREE.Group;
  private readonly flame: THREE.Mesh;
  private readonly dustRing: THREE.Mesh;
  private readonly restingY = 0.25;
  private state: RocketState = 'idle';
  private timer = 8 + Math.random() * 18; // first launch in 8-26s

  constructor(opts: PlacedEntityOptions = {}) {
    const built = this.build();
    this.object3d = built.group;
    this.rocket = built.rocket;
    this.flame = built.flame;
    this.dustRing = built.dustRing;
    this.object3d.position.fromArray(opts.position ?? [3.8, 0.08, -3.9]);
    this.object3d.rotation.y = opts.heading ?? -Math.PI / 7;
    this.flame.visible = false;
    this.dustRing.visible = false;
  }

  update(dt: number): void {
    this.timer -= dt;

    if (this.state === 'idle' && this.timer <= 0) {
      this.state = 'ignition';
      this.timer = 1.2;
      this.flame.visible = true;
      this.flame.scale.set(1, 0.4, 1);
      this.dustRing.visible = true;
      this.dustRing.scale.set(0.2, 1, 0.2);
      (this.dustRing.material as THREE.MeshStandardMaterial).opacity = 0.45;
      emit('rocket-ignition', '🔥 Rocket Phoenix ignition');
    } else if (this.state === 'ignition') {
      // Flame builds up; rocket trembles slightly
      const t = 1 - Math.max(0, this.timer) / 1.2;
      this.flame.scale.y = 0.4 + t * 0.9;
      this.rocket.position.x = 0.28 + (Math.random() - 0.5) * 0.02;
      // Dust ring expands outward
      const ringScale = 0.2 + t * 2.0;
      this.dustRing.scale.set(ringScale, 1, ringScale);
      if (this.timer <= 0) {
        this.state = 'launching';
        this.timer = 6.0; // launching for 6s, then cooldown
        this.rocket.position.x = 0.28;
        emit('rocket-launched', '🚀 Rocket Phoenix launched');
      }
    } else if (this.state === 'launching') {
      // Accelerate upward
      const elapsed = 6.0 - Math.max(0, this.timer);
      const liftedBy = 0.5 * 1.8 * elapsed * elapsed; // 0.5 * a * t^2
      this.rocket.position.y = this.restingY + liftedBy;
      // Flame stretches behind as it rises (local position)
      this.flame.position.y = -0.15 - liftedBy * 0.05;
      this.flame.scale.y = 1.3 + Math.sin(elapsed * 24) * 0.3;
      // Dust ring keeps expanding but fades out
      const dustScale = 2.2 + elapsed * 0.4;
      this.dustRing.scale.set(dustScale, 1, dustScale);
      (this.dustRing.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.45 - elapsed * 0.18);
      if (this.rocket.position.y > 25 || this.timer <= 0) {
        this.state = 'cooldown';
        this.timer = 4 + Math.random() * 6; // 4-10s before respawn
        this.rocket.visible = false;
        this.flame.visible = false;
        this.dustRing.visible = false;
      }
    } else if (this.state === 'cooldown' && this.timer <= 0) {
      // Respawn rocket on the pad
      this.rocket.position.set(0.28, this.restingY, -0.04);
      this.rocket.visible = true;
      this.flame.position.set(0, -0.15, 0);
      this.state = 'idle';
      this.timer = 14 + Math.random() * 22; // next launch in 14-36s
    }
  }

  private build(): { group: THREE.Group; rocket: THREE.Group; flame: THREE.Mesh; dustRing: THREE.Mesh } {
    const g = new THREE.Group();

    const pad = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.12, 1.55), MAT.gray);
    pad.position.y = 0.08;
    pad.castShadow = true;
    pad.receiveShadow = true;
    g.add(pad);

    const gantry = new THREE.Group();
    gantry.position.set(-0.52, 0.55, 0.38);
    for (const x of [-0.18, 0.18]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.05, 0.08), MAT.grayDark);
      leg.position.set(x, 0, 0);
      leg.castShadow = true;
      gantry.add(leg);
    }
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.08, 0.16), MAT.yellow);
    top.position.y = 0.56;
    top.castShadow = true;
    gantry.add(top);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.08, 0.1), MAT.yellow);
    arm.position.set(0.38, 0.24, 0);
    arm.castShadow = true;
    gantry.add(arm);
    g.add(gantry);

    const rocket = new THREE.Group();
    rocket.position.set(0.28, 0.25, -0.04);
    const lower = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 0.95, 18), MAT.white);
    lower.position.y = 0.48;
    lower.castShadow = true;
    rocket.add(lower);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.42, 18), MAT.redLED);
    nose.position.y = 1.16;
    nose.castShadow = true;
    rocket.add(nose);

    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.28, 0.18), MAT.blue);
      fin.position.set(Math.cos(a) * 0.22, 0.16, Math.sin(a) * 0.22);
      fin.rotation.y = -a;
      fin.castShadow = true;
      rocket.add(fin);
    }
    g.add(rocket);

    // Launch flame — bright yellow-orange cone hanging below the rocket nozzles.
    // Lives on the same group as the rocket so it moves with it during liftoff.
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.7, 12, 1, true),
      MAT.yellowTrans,
    );
    // Local to the rocket group (rocket itself is parented to the launchpad group).
    flame.rotation.x = Math.PI;
    flame.position.set(0, -0.15, 0);
    rocket.add(flame);

    const pipe = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.08, 0.08), MAT.grayDark);
    pipe.position.set(0.05, 0.22, 0.7);
    pipe.castShadow = true;
    g.add(pipe);

    // Lunar dust ring — flat torus that puffs out around the pad during launch.
    // Parented to the pad group (not the rocket) so it stays on the ground.
    const dustRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.7, 0.18, 8, 24),
      MAT_DUST.clone(),
    );
    dustRing.rotation.x = Math.PI / 2;
    dustRing.position.set(0.28, 0.16, -0.04);
    g.add(dustRing);

    return { group: g, rocket, flame, dustRing };
  }
}

export class GalaxyExplorerShip implements Entity {
  readonly object3d: THREE.Group;
  private phase = 0;
  private readonly baseY: number;

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d = this.build();
    this.object3d.position.fromArray(opts.position ?? [-0.8, 3.9, -2.9]);
    this.baseY = this.object3d.position.y;
    this.object3d.rotation.y = opts.heading ?? Math.PI / 5;
  }

  update(dt: number): void {
    this.phase += dt;
    this.object3d.position.y = this.baseY + Math.sin(this.phase * 0.8) * 0.18;
    this.object3d.rotation.z = Math.sin(this.phase * 0.6) * 0.04;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.32, 0.58), MAT.blue);
    fuselage.castShadow = true;
    g.add(fuselage);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.78, 4), MAT.blue);
    nose.position.x = 1.05;
    nose.rotation.z = -Math.PI / 2;
    nose.castShadow = true;
    g.add(nose);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.28, 0.5), MAT.yellowTrans);
    canopy.position.set(0.28, 0.27, 0);
    canopy.castShadow = true;
    g.add(canopy);

    for (const z of [-0.55, 0.55]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.62), MAT.blue);
      wing.position.set(-0.35, -0.04, z);
      wing.rotation.y = z > 0 ? -0.18 : 0.18;
      wing.castShadow = true;
      g.add(wing);
    }

    for (const z of [-0.28, 0.28]) {
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 16), MAT.grayDark);
      engine.position.set(-0.98, 0, z);
      engine.rotation.z = Math.PI / 2;
      engine.castShadow = true;
      g.add(engine);
    }

    return g;
  }
}

export class GalaxyExplorerRover implements Entity {
  readonly object3d = this.build();

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d.position.fromArray(opts.position ?? [1.3, 0.08, -4.8]);
    this.object3d.rotation.y = opts.heading ?? -0.35;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.26, 0.62), MAT.white);
    body.position.y = 0.34;
    body.castShadow = true;
    g.add(body);

    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.36), MAT.blue);
    seat.position.set(-0.2, 0.56, 0);
    seat.castShadow = true;
    g.add(seat);

    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.gray);
    dish.position.set(0.38, 0.68, 0.12);
    dish.rotation.z = -0.8;
    dish.castShadow = true;
    g.add(dish);

    const wheelGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.12, 16);
    for (const x of [-0.38, 0.38]) {
      for (const z of [-0.42, 0.42]) {
        const wheel = new THREE.Mesh(wheelGeo, MAT.black);
        wheel.rotation.x = Math.PI / 2;
        wheel.position.set(x, 0.2, z);
        wheel.castShadow = true;
        g.add(wheel);
      }
    }

    return g;
  }
}

export class RobotHelper implements Entity {
  readonly object3d: THREE.Group;
  private phase = 0;

  constructor(private readonly opts: PlacedEntityOptions = {}) {
    this.object3d = this.build();
    this.object3d.position.fromArray(opts.position ?? [2.6, 0.08, -4.55]);
    this.object3d.rotation.y = opts.heading ?? 0.5;
  }

  update(dt: number): void {
    this.phase += dt * 3;
    this.object3d.rotation.y += dt * 0.25;
    this.object3d.position.y = (this.opts.position?.[1] ?? 0.08) + Math.sin(this.phase) * 0.035;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.18, 0.28), MAT.grayDark);
    base.position.y = 0.12;
    base.castShadow = true;
    g.add(base);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.2), MAT.white);
    body.position.y = 0.4;
    body.castShadow = true;
    g.add(body);

    const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.2, 0.24), MAT.blue);
    head.position.y = 0.72;
    head.castShadow = true;
    g.add(head);

    for (const x of [-0.08, 0.08]) {
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), MAT.greenLED);
      eye.position.set(x, 0.74, 0.13);
      g.add(eye);
    }

    return g;
  }
}

export class BlacktronCruiser implements Entity {
  readonly object3d: THREE.Group;
  private phase = 0;

  constructor(private readonly opts: PlacedEntityOptions = {}) {
    this.object3d = this.build();
    this.object3d.position.fromArray(opts.position ?? [4.9, 2.4, 0.4]);
    this.object3d.rotation.y = opts.heading ?? -Math.PI / 2.5;
  }

  update(dt: number): void {
    this.phase += dt;
    this.object3d.position.y = (this.opts.position?.[1] ?? 2.4) + Math.sin(this.phase * 1.2) * 0.12;
    this.object3d.rotation.y += dt * 0.12;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.26, 0.55), MAT.black);
    body.castShadow = true;
    g.add(body);

    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.62, 4), MAT.black);
    nose.position.x = 0.88;
    nose.rotation.z = -Math.PI / 2;
    nose.castShadow = true;
    g.add(nose);

    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.22, 0.42), MAT_BLACKTRON_YELLOW);
    canopy.position.set(0.18, 0.23, 0);
    canopy.castShadow = true;
    g.add(canopy);

    for (const z of [-0.48, 0.48]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.1, 0.48), MAT.black);
      wing.position.set(-0.24, -0.02, z);
      wing.castShadow = true;
      g.add(wing);

      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.04, 0.07), MAT_BLACKTRON_YELLOW);
      stripe.position.set(-0.24, 0.06, z);
      g.add(stripe);
    }

    return g;
  }
}

export class BlacktronOutpost implements Entity {
  readonly object3d = this.build();

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d.position.fromArray(opts.position ?? [5.9, 0.08, -3.8]);
    this.object3d.rotation.y = opts.heading ?? Math.PI / 2;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.16, 1.0), MAT.black);
    base.position.y = 0.08;
    base.castShadow = true;
    base.receiveShadow = true;
    g.add(base);

    const tower = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.96, 0.42), MAT.black);
    tower.position.set(-0.32, 0.62, 0.12);
    tower.castShadow = true;
    g.add(tower);

    const window = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.34, 0.3), MAT_BLACKTRON_YELLOW);
    window.position.set(-0.56, 0.72, 0.12);
    g.add(window);

    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), MAT.grayDark);
    dish.position.set(0.3, 0.72, -0.18);
    dish.rotation.z = 0.8;
    dish.castShadow = true;
    g.add(dish);

    return g;
  }
}

/**
 * Futuron 6990-style monorail station. Hero piece: white archway with a
 * trans-yellow roof slab and side pylons. Hand-built to fit on the existing
 * StationPlatform footprint (1.9 wide x 1.55 deep).
 */
export class FuturonStation implements Entity {
  readonly object3d = this.build();

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d.position.fromArray(opts.position ?? [0, 0, 0]);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    const deck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.18, 1.55), MAT.white);
    deck.position.y = 0.09;
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);

    // Yellow safety stripe along the trackside edge
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.04, 0.16), MAT.yellow);
    stripe.position.set(0, 0.20, -0.7);
    g.add(stripe);

    // Two corner pylons
    for (const sx of [-0.78, 0.78]) {
      const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.18), MAT.white);
      pylon.position.set(sx, 0.75, 0.55);
      pylon.castShadow = true;
      g.add(pylon);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.08, 0.26), MAT.blue);
      cap.position.set(sx, 1.34, 0.55);
      g.add(cap);

      // Trans-yellow indicator light at top of each pylon
      const light = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), MAT.yellowTrans);
      light.position.set(sx, 1.42, 0.55);
      g.add(light);
    }

    // The signature Futuron archway: angled struts meeting overhead
    for (const sx of [-0.78, 0.78]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.05, 0.12), MAT.blue);
      strut.position.set(sx * 0.55, 0.95, 0.05);
      strut.rotation.z = -Math.sign(sx) * 0.55;
      strut.castShadow = true;
      g.add(strut);
    }

    // Translucent yellow roof slab spanning the two pylons
    const roof = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.08, 0.85), MAT.yellowTrans);
    roof.position.set(0, 1.4, 0.3);
    roof.castShadow = true;
    g.add(roof);

    // Front signage panel
    const sign = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.18, 0.05), MAT.blueDark);
    sign.position.set(0, 0.95, -0.78);
    g.add(sign);

    const signLight = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.08, 0.03), MAT.greenLED);
    signLight.position.set(0, 0.95, -0.81);
    g.add(signLight);

    // Console pillar in the back-left of the deck
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.36, 0.22), MAT.gray);
    console_.position.set(-0.55, 0.36, 0.45);
    console_.castShadow = true;
    g.add(console_);

    for (const [i, mat] of [MAT.redLED, MAT.greenLED, MAT.yellowTrans].entries()) {
      const led = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.03), mat);
      led.position.set(-0.66 + i * 0.11, 0.5, 0.56);
      g.add(led);
    }

    return g;
  }
}

/**
 * M-Tron Mega Core Magnetizer (set 6989, 1990). Flying ship with a hanging
 * magnet on a chain. Red/green/black palette. Bobs in place + the magnet
 * sways slightly out of phase.
 */
export class MTronMagnetizer implements Entity {
  readonly object3d: THREE.Group;
  private readonly magnet: THREE.Group;
  private phase = 0;
  private readonly baseY: number;

  constructor(opts: PlacedEntityOptions = {}) {
    const built = this.build();
    this.object3d = built.group;
    this.magnet = built.magnet;
    this.object3d.position.fromArray(opts.position ?? [-5, 3.5, -6.5]);
    this.baseY = this.object3d.position.y;
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  update(dt: number): void {
    this.phase += dt;
    this.object3d.position.y = this.baseY + Math.sin(this.phase * 0.7) * 0.15;
    this.magnet.rotation.z = Math.sin(this.phase * 1.3) * 0.18;
  }

  private build(): { group: THREE.Group; magnet: THREE.Group } {
    const g = new THREE.Group();

    const fuselage = new THREE.Mesh(new THREE.BoxGeometry(1.35, 0.32, 0.55), MAT_MTRON_RED);
    fuselage.castShadow = true;
    g.add(fuselage);

    // Black underbelly
    const belly = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 0.5), MAT.black);
    belly.position.y = -0.2;
    belly.castShadow = true;
    g.add(belly);

    // Nose
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.55, 4), MAT_MTRON_RED);
    nose.position.x = 0.92;
    nose.rotation.z = -Math.PI / 2;
    nose.castShadow = true;
    g.add(nose);

    // Green cockpit
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.28, 0.45), MAT_MTRON_GREEN);
    cockpit.position.set(0.2, 0.28, 0);
    cockpit.castShadow = true;
    g.add(cockpit);

    // Side wings (black with red trim)
    for (const z of [-0.5, 0.5]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.1, 0.4), MAT.black);
      wing.position.set(-0.25, -0.05, z);
      wing.castShadow = true;
      g.add(wing);

      const trim = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.08), MAT_MTRON_RED);
      trim.position.set(-0.25, 0.04, z);
      g.add(trim);

      // Engine pods at wing tips
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.35, 12), MAT.grayDark);
      engine.rotation.z = Math.PI / 2;
      engine.position.set(-0.7, -0.05, z);
      engine.castShadow = true;
      g.add(engine);
    }

    // Magnet winch arm under the fuselage
    const winchMount = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.18), MAT.grayDark);
    winchMount.position.set(0, -0.32, 0);
    g.add(winchMount);

    // Cable (long thin cylinder)
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8), MAT.grayDark);
    cable.position.set(0, -0.7, 0);
    g.add(cable);

    // The magnet itself (red horseshoe block)
    const magnet = new THREE.Group();
    magnet.position.set(0, -1.1, 0);
    const magnetBlock = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.22, 0.22), MAT_MTRON_RED);
    magnetBlock.castShadow = true;
    magnet.add(magnetBlock);
    for (const sx of [-0.13, 0.13]) {
      const pole = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.22), MAT.grayDark);
      pole.position.set(sx, -0.17, 0);
      magnet.add(pole);
    }
    g.add(magnet);

    return { group: g, magnet };
  }
}

/**
 * Ice Planet 2002 Deep Freeze Defender (set 6973, 1993). White ship with
 * orange trim and trans-light-blue cockpit; rear satellite dish and twin engines.
 */
export class IcePlanetDefender implements Entity {
  readonly object3d = this.build();

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d.position.fromArray(opts.position ?? [-1, 0.08, 6.5]);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Main hull (white)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.85), MAT.white);
    hull.position.y = 0.32;
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);

    // Orange stripe along the side
    for (const z of [-0.43, 0.43]) {
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 0.04), MAT_ICE_ORANGE);
      stripe.position.set(0, 0.32, z);
      g.add(stripe);
    }

    // Trans-blue cockpit canopy (front)
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.55), MAT_ICE_BLUE_TRANS);
    canopy.position.set(0.4, 0.6, 0);
    canopy.castShadow = true;
    g.add(canopy);

    // Roof slab
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.08, 0.62), MAT.white);
    roof.position.set(-0.1, 0.55, 0);
    g.add(roof);

    // Nose ramp (orange)
    const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.6), MAT_ICE_ORANGE);
    nose.position.set(0.85, 0.26, 0);
    g.add(nose);

    // Rear twin engines (orange)
    for (const z of [-0.28, 0.28]) {
      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.42, 14), MAT_ICE_ORANGE);
      engine.rotation.z = Math.PI / 2;
      engine.position.set(-0.95, 0.32, z);
      engine.castShadow = true;
      g.add(engine);

      const flame = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.10, 0.18, 10), MAT.yellowTrans);
      flame.rotation.z = Math.PI / 2;
      flame.position.set(-1.22, 0.32, z);
      g.add(flame);
    }

    // Satellite dish on top
    const dishMount = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), MAT.grayDark);
    dishMount.position.set(-0.4, 0.7, 0);
    g.add(dishMount);

    const dish = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT_ICE_ORANGE,
    );
    dish.position.set(-0.4, 0.82, 0);
    dish.rotation.z = -0.4;
    dish.castShadow = true;
    g.add(dish);

    // Skis instead of wheels (white runners)
    for (const z of [-0.36, 0.36]) {
      const ski = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 0.1), MAT.white);
      ski.position.set(0, 0.05, z);
      g.add(ski);
    }

    return g;
  }
}

/**
 * Space Police I cruiser (set 6886, 1989). Black hull with trans-orange
 * cockpit and yellow stripes; a small detachable "prisoner pod" hangs below.
 */
export class SpacePoliceCruiser implements Entity {
  readonly object3d: THREE.Group;
  private phase = 0;
  private readonly baseY: number;

  constructor(opts: PlacedEntityOptions = {}) {
    this.object3d = this.build();
    this.object3d.position.fromArray(opts.position ?? [6.5, 2.5, 0]);
    this.baseY = this.object3d.position.y;
    this.object3d.rotation.y = opts.heading ?? Math.PI;
  }

  update(dt: number): void {
    this.phase += dt;
    this.object3d.position.y = this.baseY + Math.sin(this.phase * 0.9) * 0.1;
    this.object3d.rotation.y += dt * 0.08;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Main hull (black)
    const hull = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.28, 0.55), MAT.black);
    hull.castShadow = true;
    g.add(hull);

    // Nose (black wedge)
    const nose = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.65, 4), MAT.black);
    nose.position.x = 0.95;
    nose.rotation.z = -Math.PI / 2;
    nose.castShadow = true;
    g.add(nose);

    // Trans-orange cockpit
    const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.45), MAT_POLICE_ORANGE_TRANS);
    cockpit.position.set(0.18, 0.26, 0);
    cockpit.castShadow = true;
    g.add(cockpit);

    // Yellow caution stripes on the wings
    for (const z of [-0.5, 0.5]) {
      const wing = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.1, 0.45), MAT.black);
      wing.position.set(-0.2, -0.04, z);
      wing.castShadow = true;
      g.add(wing);

      // Diagonal yellow caution stripes (two thin diagonals via short boxes)
      for (let i = 0; i < 3; i++) {
        const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.04, 0.07), MAT_POLICE_YELLOW);
        stripe.position.set(-0.5 + i * 0.22, 0.05, z);
        stripe.rotation.y = -0.4;
        g.add(stripe);
      }

      const engine = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.3, 12), MAT.grayDark);
      engine.rotation.z = Math.PI / 2;
      engine.position.set(-0.75, -0.04, z);
      engine.castShadow = true;
      g.add(engine);
    }

    // Roof beacon (rotating yellow light)
    const beacon = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.1, 12), MAT_POLICE_YELLOW);
    beacon.position.set(0.1, 0.45, 0);
    g.add(beacon);

    // Prisoner holding pod underneath (small clear cage)
    const pod = new THREE.Group();
    pod.position.set(-0.15, -0.32, 0);
    const podShell = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.32, 0.42), MAT_POLICE_ORANGE_TRANS);
    podShell.castShadow = true;
    pod.add(podShell);
    const podBars = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.46), MAT.grayDark);
    podBars.position.y = 0;
    pod.add(podBars);
    g.add(pod);

    return g;
  }
}
