import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TRACK_INNER, TRACK_OUTER } from '../world/constants';

type ElevatorState = 'up' | 'pauseTop' | 'down' | 'pauseBottom';

export class Elevator implements Entity {
  readonly object3d: THREE.Group;
  private readonly cab: THREE.Group;
  private state: ElevatorState = 'up';
  private timer = 0;
  private y = 0.62;

  private readonly bottomY = 0.62;
  private readonly topY = 3.0;
  private readonly speed = 0.85;
  private readonly pause = 1.1;

  constructor() {
    const built = this.build();
    this.object3d = built.group;
    this.cab = built.cab;
  }

  update(dt: number): void {
    if (this.state === 'up') {
      this.y = Math.min(this.topY, this.y + this.speed * dt);
      if (this.y === this.topY) this.enter('pauseTop');
    } else if (this.state === 'down') {
      this.y = Math.max(this.bottomY, this.y - this.speed * dt);
      if (this.y === this.bottomY) this.enter('pauseBottom');
    } else {
      this.timer += dt;
      if (this.timer >= this.pause) this.enter(this.state === 'pauseTop' ? 'down' : 'up');
    }
    this.cab.position.y = this.y;
  }

  private enter(state: ElevatorState): void {
    this.state = state;
    this.timer = 0;
  }

  private build(): { group: THREE.Group; cab: THREE.Group } {
    const g = new THREE.Group();
    const x = -TRACK_OUTER - 0.6;
    const z = -2.3;

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.15, 0.16), MAT.grayDark);
    shaft.position.set(x, 1.72, z);
    shaft.castShadow = true;
    g.add(shaft);

    for (const y of [0.32, 1.35, 2.38, 3.4]) {
      const bracket = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.12, 0.12), MAT.grayDark);
      bracket.position.set(x + 0.23, y, z);
      bracket.castShadow = true;
      g.add(bracket);
    }

    const cab = new THREE.Group();
    cab.position.set(x - 0.28, this.bottomY, z);
    const shell = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.42, 0.46), MAT.yellowTrans);
    shell.castShadow = true;
    cab.add(shell);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.08, 0.5), MAT.gray);
    roof.position.y = 0.25;
    cab.add(roof);
    g.add(cab);

    const dock = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.12, 0.58), MAT.gray);
    dock.position.set(x - 0.28, this.topY + 0.33, z);
    dock.castShadow = true;
    g.add(dock);

    const guide = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.9, 0.08), MAT.blueDark);
    guide.position.set(-TRACK_INNER + 0.15, 1.65, z);
    guide.castShadow = true;
    g.add(guide);

    return { group: g, cab };
  }
}
