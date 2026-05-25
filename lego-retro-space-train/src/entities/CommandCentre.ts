import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TRACK_OUTER, TRACK_INNER } from '../world/constants';

export class CommandCentre implements Entity {
  readonly object3d: THREE.Group;

  private readonly dishPivot: THREE.Group;
  private readonly beaconMat: THREE.MeshStandardMaterial;
  private readonly antTipMat: THREE.MeshStandardMaterial;
  private dishPhase = 0;
  private pulsePhase = 0;

  constructor() {
    const built = this.build();
    this.object3d = built.group;
    this.dishPivot = built.dishPivot;
    this.beaconMat = built.beaconMat;
    this.antTipMat = built.antTipMat;
  }

  update(dt: number): void {
    this.dishPhase += dt * 0.6;
    this.dishPivot.rotation.y = Math.sin(this.dishPhase) * 0.7;

    this.pulsePhase += dt * 4;
    this.beaconMat.emissiveIntensity = 2.0 + Math.sin(this.pulsePhase) * 0.6;
    this.antTipMat.emissiveIntensity = 1.0 + Math.sin(this.pulsePhase * 1.3) * 0.7;
  }

  private build(): {
    group: THREE.Group;
    dishPivot: THREE.Group;
    beaconMat: THREE.MeshStandardMaterial;
    antTipMat: THREE.MeshStandardMaterial;
  } {
    const g = new THREE.Group();

    // Position the tower straddling the -X side of the track
    const CX = -((TRACK_OUTER + TRACK_INNER) / 2);
    const inX = -TRACK_INNER + 0.15;
    const outX = -TRACK_OUTER - 0.15;
    const zFront = 2.3;
    const zBack = -2.3;

    // ---------- Legs (4) ----------
    const legGeo = new THREE.BoxGeometry(0.5, 2.6, 0.5);
    for (const [x, z] of [[inX, zFront], [inX, zBack], [outX, zFront], [outX, zBack]] as const) {
      const leg = new THREE.Mesh(legGeo, MAT.blue);
      leg.position.set(x, 1.3, z);
      leg.castShadow = true;
      leg.receiveShadow = true;
      g.add(leg);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.7), MAT.blueDark);
      foot.position.set(x, 0.09, z);
      foot.castShadow = true;
      g.add(foot);
    }

    // ---------- Cross beam (console under cabin, front side) ----------
    const beam = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.35, 0.45), MAT.grayDark);
    beam.position.set(CX, 2.45, zFront);
    beam.castShadow = true;
    g.add(beam);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.18, 0.05), MAT.black);
    panel.position.set(CX, 2.45, zFront + 0.24);
    g.add(panel);

    for (let i = -1; i <= 1; i++) {
      const led = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.08, 0.02),
        i === 0 ? MAT.redLED : MAT.greenLED,
      );
      led.position.set(CX + i * 0.35, 2.45, zFront + 0.27);
      g.add(led);
    }

    // ---------- Cabin ----------
    const cabinW = 2.3;
    const cabinH = 1.5;
    const cabinD = 1.8;
    const cabinY = 3.5;

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(cabinW, cabinH, cabinD),
      MAT.blue,
    );
    cabin.position.set(CX, cabinY, 0);
    cabin.castShadow = true;
    cabin.receiveShadow = true;
    g.add(cabin);

    const trim = new THREE.Mesh(
      new THREE.BoxGeometry(cabinW + 0.05, 0.22, cabinD + 0.05),
      MAT.blueDark,
    );
    trim.position.set(CX, cabinY - cabinH / 2 + 0.12, 0);
    g.add(trim);

    // Yellow window panel facing track center
    const window = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.85, 1.3),
      MAT.yellowTrans,
    );
    window.position.set(CX + cabinW / 2 + 0.02, cabinY + 0.05, 0);
    g.add(window);

    for (const sign of [-1, 1]) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.85, 0.06),
        MAT.blue,
      );
      m.position.set(CX + cabinW / 2 + 0.03, cabinY + 0.05, sign * 0.42);
      g.add(m);
    }

    // Cabin interior glimpsed through the trans-yellow window
    const chair = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.42, 0.34), MAT.grayDark);
    chair.position.set(CX - 0.35, cabinY - 0.35, -0.28);
    chair.castShadow = true;
    g.add(chair);

    const screen = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.42, 0.62), MAT.black);
    screen.position.set(CX + cabinW / 2 - 0.08, cabinY - 0.18, -0.34);
    g.add(screen);

    for (let i = 0; i < 3; i++) {
      const pixel = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.065, 0.025), i === 1 ? MAT.greenLED : MAT.blueTrans);
      pixel.position.set(CX + cabinW / 2 - 0.04, cabinY - 0.3 + i * 0.13, -0.55 + i * 0.12);
      g.add(pixel);
    }

    // Classic Space logo plaque (front)
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.6, 0.04),
      MAT.white,
    );
    plaque.position.set(CX, cabinY + 0.35, cabinD / 2 + 0.02);
    g.add(plaque);

    const planet = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), MAT.redLED);
    planet.position.set(CX, cabinY + 0.35, cabinD / 2 + 0.045);
    g.add(planet);

    const ringMat = new THREE.MeshStandardMaterial({
      color: 0xf5c518,
      emissive: 0xf5c518,
      emissiveIntensity: 0.6,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.2, 0.24, 24), ringMat);
    ring.position.set(CX, cabinY + 0.35, cabinD / 2 + 0.05);
    ring.rotation.z = -Math.PI / 6;
    ring.scale.set(1, 0.45, 1);
    g.add(ring);

    // Number plate
    const numPlate = new THREE.Mesh(
      new THREE.BoxGeometry(0.7, 0.28, 0.04),
      MAT.white,
    );
    numPlate.position.set(CX - cabinW / 2 - 0.02, cabinY - 0.45, 0.5);
    numPlate.rotation.y = Math.PI / 2;
    g.add(numPlate);

    // Roof slope
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(cabinW - 0.2, 0.18, cabinD - 0.2),
      MAT.blueDark,
    );
    roof.position.set(CX, cabinY + cabinH / 2 + 0.09, 0);
    g.add(roof);

    const studGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.08, 16);
    for (const sx of [-0.65, 0, 0.65]) {
      for (const sz of [-0.48, 0.48]) {
        const stud = new THREE.Mesh(studGeo, MAT.blueDark);
        stud.position.set(CX + sx, cabinY + cabinH / 2 + 0.22, sz);
        stud.castShadow = true;
        g.add(stud);
      }
    }

    // Solar panel on the rear roof corner
    const solarPivot = new THREE.Group();
    solarPivot.position.set(CX - 0.75, cabinY + cabinH / 2 + 0.42, -0.75);
    solarPivot.rotation.z = -0.35;
    solarPivot.rotation.y = -0.25;
    g.add(solarPivot);

    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8), MAT.grayDark);
    mast.rotation.z = Math.PI / 2;
    solarPivot.add(mast);

    const solar = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.06, 0.48), MAT.blueTrans);
    solar.position.x = -0.48;
    solar.castShadow = true;
    solarPivot.add(solar);

    for (const z of [-0.12, 0.12]) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.025, 0.025), MAT.blueDark);
      line.position.set(-0.48, 0.04, z);
      solarPivot.add(line);
    }

    // ---------- Antenna ----------
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 1.9, 8),
      MAT.grayDark,
    );
    antenna.position.set(CX, cabinY + cabinH / 2 + 1.05, 0);
    antenna.castShadow = true;
    g.add(antenna);

    const antTipMat = MAT.redLED.clone();
    const antTip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), antTipMat);
    antTip.position.set(CX, cabinY + cabinH / 2 + 2.0, 0);
    g.add(antTip);

    // ---------- Beacon (green) ----------
    const beaconMat = MAT.greenLED.clone();
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), beaconMat);
    beacon.position.set(CX, cabinY + cabinH / 2 + 0.28, 0.5);
    g.add(beacon);

    const beaconLight = new THREE.PointLight(0x60ff90, 0.8, 5);
    beaconLight.position.copy(beacon.position);
    g.add(beaconLight);

    // ---------- Satellite dish (rotating) ----------
    const dishPivot = new THREE.Group();
    dishPivot.position.set(CX + cabinW / 2 + 0.3, cabinY + 0.15, zFront - 0.2);
    g.add(dishPivot);

    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.45, 8),
      MAT.grayDark,
    );
    stem.rotation.z = Math.PI / 2;
    dishPivot.add(stem);

    const dishGeo = new THREE.SphereGeometry(
      0.5, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2.4,
    );
    const dish = new THREE.Mesh(dishGeo, MAT.white);
    dish.position.set(0.3, 0, 0);
    dish.rotation.z = -Math.PI / 2;
    dish.scale.set(1, 0.5, 1);
    dish.castShadow = true;
    dishPivot.add(dish);

    const emitter = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), MAT.greenLED);
    emitter.position.set(0.42, 0, 0);
    dishPivot.add(emitter);

    return { group: g, dishPivot, beaconMat, antTipMat };
  }
}
