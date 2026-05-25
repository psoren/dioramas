import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TILE_SIZE } from '../world/trackTile';
import {
  TrackLayout,
  generateRectangleLoop,
  generateRandomRectangleLoop,
} from '../world/trackLayout';

const TRACK_WIDTH = 0.9;
const TRACK_DECK_Y = 0.04;
const SAMPLES = 280;

export interface TileTrackOptions {
  position?: THREE.Vector3Tuple;
  /** Explicit rectangle in tile-grid coords. */
  rectangle?: { gx0: number; gz0: number; gx1: number; gz1: number };
  /** Bounds for procedural generation. Ignored if `rectangle` is given. */
  randomBounds?: { gx0: number; gz0: number; gx1: number; gz1: number };
  /** Seed for the random generator. */
  seed?: number;
}

/**
 * Renders a procedurally-composed track loop. Tiles snap to a grid; the
 * generator picks placements; this entity builds a single deck strip along
 * the resulting loop path. The path is exposed as `.path` so future
 * vehicles can be attached to it.
 *
 * This is the first user of `trackTile`/`trackLayout`. Adding new tile
 * kinds (ramps, intersections, switches) extends the system without
 * touching this file.
 */
export class TileTrack implements Entity {
  readonly object3d: THREE.Group;
  readonly path: THREE.CatmullRomCurve3;
  readonly layout = new TrackLayout();

  constructor(opts: TileTrackOptions = {}) {
    if (opts.rectangle) {
      const r = opts.rectangle;
      const { start, startEntry } = generateRectangleLoop(this.layout, r.gx0, r.gz0, r.gx1, r.gz1);
      this.path = this.layout.buildLoop(start, startEntry);
    } else {
      const bounds = opts.randomBounds ?? { gx0: -3, gz0: -2, gx1: 3, gz1: 2 };
      const rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
      const { start, startEntry } = generateRandomRectangleLoop(this.layout, bounds, rng);
      this.path = this.layout.buildLoop(start, startEntry);
    }
    this.object3d = this.build();
    if (opts.position) this.object3d.position.fromArray(opts.position);
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // Deck strip along the path
    const positions: number[] = [];
    const indices: number[] = [];
    const half = TRACK_WIDTH / 2;
    const ringCount = SAMPLES + 1;

    for (let i = 0; i < ringCount; i++) {
      const t = i / SAMPLES;
      const p = this.path.getPointAt(t);
      const tan = this.path.getTangentAt(t);
      // Perpendicular in XZ plane.
      const nx = -tan.z;
      const nz = tan.x;
      const len = Math.sqrt(nx * nx + nz * nz) || 1;
      const ux = (nx / len) * half;
      const uz = (nz / len) * half;
      positions.push(p.x + ux, TRACK_DECK_Y, p.z + uz);
      positions.push(p.x - ux, TRACK_DECK_Y, p.z - uz);
    }
    for (let i = 0; i < SAMPLES; i++) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c);
      indices.push(b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    const deckMat = MAT.gray.clone();
    deckMat.side = THREE.DoubleSide;
    const deck = new THREE.Mesh(geo, deckMat);
    deck.receiveShadow = true;
    g.add(deck);

    // Subtle grid pads under each tile so the procgen layout reads visually.
    const padGeo = new THREE.BoxGeometry(TILE_SIZE * 0.95, 0.015, TILE_SIZE * 0.95);
    const padMat = MAT.grayDark.clone();
    padMat.transparent = true;
    padMat.opacity = 0.55;
    for (const tile of this.layout.tiles()) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(tile.gridX * TILE_SIZE, 0.015, tile.gridZ * TILE_SIZE);
      pad.receiveShadow = true;
      g.add(pad);
    }

    return g;
  }
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
