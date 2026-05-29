import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { GraphTrain } from './GraphTrain';

// Glowing rainbow tube laid over the route the selected train will
// take until its NEXT stop. Recomputes each frame so the highlight
// shortens as the train advances and resets at every arrival. The
// material's hue cycles smoothly so the route reads as a rolling
// rainbow.

const TUBE_RADIUS = 0.09;
const TUBE_TUBULAR_PER_UNIT = 4;
const HUE_RATE = 0.35; // cycles per second

export class TrainRouteHighlight implements Entity {
  readonly object3d = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    color: 0xff00ff,
    transparent: true,
    opacity: 0.9,
  });
  private time = 0;
  private train: GraphTrain | null = null;
  private lastEdgeKey = '';

  constructor() {
    this.object3d.renderOrder = 999;
  }

  /** Bind to a train so its next-stop route is rendered every frame.
   *  Pass null to clear the highlight. */
  setTrain(train: GraphTrain | null): void {
    this.train = train;
    this.lastEdgeKey = '';
    if (!train) this.clearGeometry();
  }

  private clearGeometry(): void {
    while (this.object3d.children.length > 0) {
      const c = this.object3d.children[0]!;
      this.object3d.remove(c);
      if (c instanceof THREE.Mesh) c.geometry.dispose();
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.material.color.setHSL((this.time * HUE_RATE) % 1, 1, 0.55);
    if (!this.train) return;
    const edges = this.train.routeToNextStop();
    const key = edges.map((e) => e.id).join(',');
    if (key === this.lastEdgeKey) return;
    this.lastEdgeKey = key;
    this.clearGeometry();
    for (const e of edges) {
      const tubular = Math.max(8, Math.floor(e.length * TUBE_TUBULAR_PER_UNIT));
      const geo = new THREE.TubeGeometry(e.curve, tubular, TUBE_RADIUS, 8, false);
      const mesh = new THREE.Mesh(geo, this.material);
      mesh.renderOrder = 999;
      this.object3d.add(mesh);
    }
  }

  dispose(): void {
    this.clearGeometry();
    this.material.dispose();
  }
}
