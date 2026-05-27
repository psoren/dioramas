import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { WorldState } from '../world/WorldState';

export interface KelpOptions {
  position: [number, number, number];
  /** Number of blades in the clump. Default 5. */
  bladeCount?: number;
  /** Average blade length. Default 3.5. */
  bladeLength?: number;
  scale?: number;
  variant?: 'dark' | 'light';
  /** WorldState — blades bend with the global current. */
  worldState?: WorldState;
}

interface Blade {
  mesh: THREE.Mesh;
  segments: number;
  basePositions: Float32Array;
  geometry: THREE.PlaneGeometry;
  phase: number;
  swayAmp: number;
  height: number;
}

/**
 * Kelp — tall tapered blades rising from the sand, swaying as a sine of
 * height (so the base barely moves but the tip can swing). Taller than
 * anemone tendrils and rooted at one point with a clump of blades fanning
 * out from a base disc.
 *
 * Each blade is a vertex-displaced PlaneGeometry: the displacement is
 * recomputed each frame so the wave shape travels along the blade.
 */
export class Kelp implements Entity {
  readonly object3d: THREE.Group;
  private readonly blades: Blade[] = [];
  private readonly worldState: WorldState | undefined;
  private time = 0;

  constructor(opts: KelpOptions) {
    const scale = opts.scale ?? 1;
    const bladeCount = opts.bladeCount ?? 5;
    const bladeLen = opts.bladeLength ?? 3.5;
    this.worldState = opts.worldState;
    const mat = (opts.variant === 'light' ? MAT.kelpLight : MAT.kelpDark) as THREE.MeshStandardMaterial;
    // Clone with DoubleSide so blades render from both directions; planes
    // are paper-thin so a single-sided fish-eye angle would otherwise see
    // straight through them.
    const bladeMat = mat.clone();
    bladeMat.side = THREE.DoubleSide;

    this.object3d = new THREE.Group();
    this.object3d.position.set(opts.position[0], opts.position[1], opts.position[2]);
    this.object3d.scale.setScalar(scale);

    // Base — a small mound/holdfast at the sand.
    const base = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      MAT.rock,
    );
    base.scale.y = 0.4;
    base.castShadow = true;
    base.receiveShadow = true;
    this.object3d.add(base);

    for (let i = 0; i < bladeCount; i++) {
      const len = bladeLen * (0.7 + Math.random() * 0.6);
      const segs = 10;
      const width = 0.22 + Math.random() * 0.1;
      const geo = new THREE.PlaneGeometry(width, len, 1, segs);
      // Move pivot to the base of the blade so it sways from the bottom.
      geo.translate(0, len / 2, 0);
      // Taper the blade so it narrows toward the tip.
      const positions = geo.attributes.position!;
      for (let v = 0; v < positions.count; v++) {
        const y = positions.getY(v);
        const t = y / len; // 0 base, 1 tip
        positions.setX(v, positions.getX(v) * (1 - t * 0.6));
      }
      const basePositions = new Float32Array(positions.array as Float32Array);
      geo.computeVertexNormals();

      const blade = new THREE.Mesh(geo, bladeMat);
      blade.castShadow = true;
      const angle = (i / bladeCount) * Math.PI * 2 + Math.random() * 0.6;
      const dist = Math.random() * 0.15;
      blade.position.set(Math.cos(angle) * dist, 0, Math.sin(angle) * dist);
      blade.rotation.y = Math.random() * Math.PI * 2;
      blade.rotation.z = (Math.random() - 0.5) * 0.15;
      this.object3d.add(blade);

      this.blades.push({
        mesh: blade,
        segments: segs + 1,
        basePositions,
        geometry: geo,
        phase: Math.random() * Math.PI * 2,
        swayAmp: 0.5 + Math.random() * 0.5,
        height: len,
      });
    }
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Steady lean bias along the current direction — multiplied by t^2 so
    // tips lean far while bases stay rooted.
    const ws = this.worldState;
    const leanX = ws ? ws.current.x * 2.0 : 0;
    const leanZ = ws ? ws.current.z * 2.0 : 0;

    for (const b of this.blades) {
      const positions = b.geometry.attributes.position!;
      for (let v = 0; v < positions.count; v++) {
        const baseX = b.basePositions[v * 3]!;
        const baseY = b.basePositions[v * 3 + 1]!;
        const baseZ = b.basePositions[v * 3 + 2]!;
        const t = baseY / b.height;
        const wave =
          Math.sin(this.time * 0.9 + b.phase + t * 2.2) * b.swayAmp * t * t;
        positions.setX(v, baseX + wave * 0.35 + leanX * t * t);
        positions.setZ(v, baseZ + wave * 0.5 + leanZ * t * t);
        positions.setY(v, baseY);
      }
      positions.needsUpdate = true;
    }
  }
}
