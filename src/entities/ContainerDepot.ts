import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { applyShadows } from '../world/motion';
import { buildContainer } from '../world/figures';

export interface ContainerDepotOptions {
  position: THREE.Vector3Tuple;
  heading?: number;
  /** Container colors to stack. Defaults to a mixed palette. */
  colors?: THREE.Material[];
}

const DEFAULT_COLORS = [
  MAT.yellow,
  MAT.blue,
  MAT.redLED,
  MAT.yellow,
  MAT.blue,
];

/**
 * A roadside container depot. Fixed stack of cargo boxes on a pad. Purely
 * visual — the trucks doing the pickup/drop are responsible for showing the
 * cargo they carry. The depot itself stays "always full" so the world reads
 * as a busy supply yard.
 */
export class ContainerDepot implements Entity {
  readonly object3d: THREE.Group;

  constructor(opts: ContainerDepotOptions) {
    const colors = opts.colors ?? DEFAULT_COLORS;
    this.object3d = this.build(colors);
    this.object3d.position.fromArray(opts.position);
    this.object3d.rotation.y = opts.heading ?? 0;
  }

  private build(colors: THREE.Material[]): THREE.Group {
    const g = new THREE.Group();

    // Pad
    const pad = new THREE.Mesh(
      new THREE.BoxGeometry(2.0, 0.1, 1.2),
      MAT.grayDark,
    );
    pad.position.y = 0.05;
    g.add(pad);

    // Containers — two rows, stacked.
    const rowZ = [-0.35, 0.35];
    const rowX = [-0.6, 0, 0.6];
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < rowX.length; i++) {
        for (let j = 0; j < rowZ.length; j++) {
          // Skip a couple of slots so it doesn't look perfectly square.
          if (layer === 1 && (i + j) % 3 === 0) continue;
          const cIdx = (layer * rowX.length * rowZ.length + i * rowZ.length + j) % colors.length;
          const c = buildContainer(colors[cIdx]!);
          c.position.set(rowX[i]!, 0.3 + layer * 0.42, rowZ[j]!);
          c.rotation.y = (Math.random() - 0.5) * 0.06;
          g.add(c);
        }
      }
    }

    // Small signal mast with a green LED so the depot stands out.
    const mast = new THREE.Mesh(
      new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
      MAT.gray,
    );
    mast.position.set(0.95, 0.55, 0.55);
    g.add(mast);

    const beacon = new THREE.Mesh(
      new THREE.SphereGeometry(0.07, 8, 6),
      MAT.greenLED,
    );
    beacon.position.set(0.95, 1.05, 0.55);
    g.add(beacon);

    applyShadows(g);
    return g;
  }
}
