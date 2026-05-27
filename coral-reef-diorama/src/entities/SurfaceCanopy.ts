import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { WorldState } from '../world/WorldState';

const CANOPY_Y = 30;
const CANOPY_RADIUS = 80;
const CANOPY_SEGMENTS = 64;
const WAVE_AMPLITUDE = 1.2;

/**
 * Wavy water surface seen from below. Large semi-transparent disc at y≈30
 * with vertex-displaced rolling waves. Hides the empty fog above and gives
 * the camera something to look at when it tilts up.
 *
 * Two crossed sine bands form the wave pattern; their offsets scroll with
 * time so the surface is in slow motion. Underside-only so light leaks are
 * minimised when sunbeams pass through.
 */
export interface SurfaceCanopyOptions {
  /** WorldState — wave amplitude scales with storm intensity. */
  worldState?: WorldState;
}

export class SurfaceCanopy implements Entity {
  readonly object3d: THREE.Mesh;
  private readonly geometry: THREE.CircleGeometry;
  private readonly baseY: Float32Array;
  private readonly basePos: Float32Array;
  private readonly worldState: WorldState | undefined;
  private time = 0;

  constructor(opts: SurfaceCanopyOptions = {}) {
    this.worldState = opts.worldState;
    this.geometry = new THREE.CircleGeometry(CANOPY_RADIUS, CANOPY_SEGMENTS);
    this.geometry.rotateX(-Math.PI / 2); // flat in XZ plane

    const positions = this.geometry.attributes.position!;
    // Snapshot original XZ so the wave displacement is computed against a
    // stable base every frame instead of accumulating drift.
    this.basePos = new Float32Array(positions.count * 2);
    this.baseY = new Float32Array(positions.count);
    for (let i = 0; i < positions.count; i++) {
      this.basePos[i * 2] = positions.getX(i);
      this.basePos[i * 2 + 1] = positions.getZ(i);
      this.baseY[i] = positions.getY(i);
    }

    this.object3d = new THREE.Mesh(this.geometry, MAT.surfaceCanopy);
    this.object3d.position.y = CANOPY_Y;
    // Don't cast shadows from the surface — the lighting already has a
    // single directional sun and a shadow-casting wavy disc would put
    // weird stripes on the floor.
  }

  update(dt: number): void {
    if (dt <= 0) return;
    this.time += dt;

    // Storm cycle amplifies wave amplitude + wave speed.
    const storm = this.worldState ? this.worldState.storm : 0;
    const ampMul = 1 + storm * 2.5;
    const speedMul = 1 + storm * 1.5;

    const positions = this.geometry.attributes.position!;
    for (let i = 0; i < positions.count; i++) {
      const x = this.basePos[i * 2]!;
      const z = this.basePos[i * 2 + 1]!;
      const y =
        Math.sin(x * 0.18 + this.time * 0.6 * speedMul) * WAVE_AMPLITUDE * ampMul +
        Math.cos(z * 0.22 - this.time * 0.45 * speedMul) * WAVE_AMPLITUDE * 0.6 * ampMul +
        Math.sin((x + z) * 0.07 + this.time * 0.25 * speedMul) * WAVE_AMPLITUDE * 0.4 * ampMul;
      positions.setY(i, y);
    }
    positions.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
