import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { mulberry32 } from '../world/seededRng';

const BEAM_COUNT = 7;
const BEAM_TOP_Y = 30;
const BEAM_BOTTOM_Y = -1;

interface Beam {
  mesh: THREE.Mesh;
  driftPhase: number;
  driftAmp: number;
  baseX: number;
  baseZ: number;
}

/**
 * Volumetric-ish god-rays from the surface above. Each beam is a stretched
 * very-shallow cone with a translucent additive-ish material. Beams drift
 * slowly so the light feels like it's filtering through moving water.
 *
 * No real volumetrics — just camera-facing transparent geometry. Cheap and
 * reads well when there's something darker behind them (the coral, the floor).
 */
export class Sunbeams implements Entity {
  readonly object3d = new THREE.Group();
  private readonly beams: Beam[] = [];
  private time = 0;

  constructor() {
    const rng = mulberry32(412371);
    const beamHeight = BEAM_TOP_Y - BEAM_BOTTOM_Y;

    for (let i = 0; i < BEAM_COUNT; i++) {
      // Skinny, very tall cones — wide at the base of the cone (which we put
      // at the top of the water) and narrow at the tip (toward the floor).
      const radiusTop = 0.04;
      const radiusBottom = 1.4 + rng() * 1.6;
      const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, beamHeight, 18, 1, true);
      const mesh = new THREE.Mesh(geo, MAT.sunbeam);

      const angle = (i / BEAM_COUNT) * Math.PI * 2 + rng() * 0.4;
      const dist = 2 + rng() * 8;
      const x = Math.cos(angle) * dist;
      const z = Math.sin(angle) * dist;

      mesh.position.set(x, (BEAM_TOP_Y + BEAM_BOTTOM_Y) / 2, z);
      // Cylinder is wider at the bottom in our setup; flip so wide end is at top.
      mesh.rotation.x = Math.PI;

      this.object3d.add(mesh);
      this.beams.push({
        mesh,
        driftPhase: rng() * Math.PI * 2,
        driftAmp: 0.4 + rng() * 0.5,
        baseX: x,
        baseZ: z,
      });
    }
  }

  update(dt: number): void {
    this.time += dt;
    for (const b of this.beams) {
      // Subtle drift around the base position so the rays feel alive.
      b.mesh.position.x = b.baseX + Math.sin(this.time * 0.25 + b.driftPhase) * b.driftAmp;
      b.mesh.position.z = b.baseZ + Math.cos(this.time * 0.18 + b.driftPhase * 1.3) * b.driftAmp;
    }
  }
}
