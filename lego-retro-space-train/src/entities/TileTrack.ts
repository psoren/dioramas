import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TILE_SIZE } from '../world/trackTile';
import {
  TrackLayout,
  LoopResult,
  TileSpan,
  generateRectangleLoop,
  generateRandomRectangleLoop,
} from '../world/trackLayout';

// See DESIGN.md → "Track tile language" for the visual conventions used
// here. Deck + two side rails + central conductor strip + faint cell pads.
const DECK_HALF_WIDTH = 0.45;
const DECK_Y = 0.04;
const RAIL_HALF_WIDTH = 0.04;
const RAIL_LATERAL = 0.4;     // distance from centreline to each rail
const RAIL_Y = 0.085;
const CONDUCTOR_HALF_WIDTH = 0.05;
const CONDUCTOR_Y = 0.075;
const SAMPLES = 280;
// Cross-ties (sleepers) across the deck — periodic dark ribs so the deck
// reads as railway rather than a plain gray strip.
const TIE_INTERVAL = 0.55;
const TIE_LENGTH = 0.95;
const TIE_DEPTH = 0.16;
const TIE_HEIGHT = 0.03;
const TIE_Y = 0.055;

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
 * generator picks placements; this entity builds a single layered ribbon
 * along the resulting loop path (deck + side rails + central conductor
 * strip). The path is exposed as `.path` so vehicles can attach to it.
 */
export class TileTrack implements Entity {
  readonly object3d: THREE.Group;
  readonly path: THREE.CatmullRomCurve3;
  readonly layout = new TrackLayout();
  /** Full loop result — exposed so other systems (stations, intersections)
   *  can use the t→tile lookup. */
  readonly loop: LoopResult;

  constructor(opts: TileTrackOptions = {}) {
    if (opts.rectangle) {
      const r = opts.rectangle;
      const { start, startEntry } = generateRectangleLoop(this.layout, r.gx0, r.gz0, r.gx1, r.gz1);
      this.loop = this.layout.buildLoop(start, startEntry);
    } else {
      const bounds = opts.randomBounds ?? { gx0: -3, gz0: -2, gx1: 3, gz1: 2 };
      const rng = opts.seed != null ? mulberry32(opts.seed) : Math.random;
      const { start, startEntry } = generateRandomRectangleLoop(this.layout, bounds, rng);
      this.loop = this.layout.buildLoop(start, startEntry);
    }
    this.path = this.loop.curve;
    this.object3d = this.build();
    if (opts.position) this.object3d.position.fromArray(opts.position);
  }

  /** Convenience: which tile cell sits at this path-t? */
  tileAtT(t: number): TileSpan | null {
    return this.loop.tileAtT(t);
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // --- Cell pads first so the strip renders on top of them ---
    const padGeo = new THREE.BoxGeometry(TILE_SIZE * 0.96, 0.012, TILE_SIZE * 0.96);
    const padMat = MAT.grayDark.clone();
    padMat.transparent = true;
    padMat.opacity = 0.35;
    for (const tile of this.layout.tiles()) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(tile.gridX * TILE_SIZE, 0.012, tile.gridZ * TILE_SIZE);
      pad.receiveShadow = true;
      g.add(pad);
    }

    // --- Deck strip ---
    const deckMat = MAT.gray.clone();
    deckMat.side = THREE.DoubleSide;
    const deck = new THREE.Mesh(
      buildStripGeometry(this.path, SAMPLES, DECK_HALF_WIDTH, 0, DECK_Y),
      deckMat,
    );
    deck.receiveShadow = true;
    g.add(deck);

    // --- Two side rails ---
    const railMat = MAT.grayDark.clone();
    for (const lateral of [-RAIL_LATERAL, RAIL_LATERAL]) {
      const rail = new THREE.Mesh(
        buildStripGeometry(this.path, SAMPLES, RAIL_HALF_WIDTH, lateral, RAIL_Y),
        railMat,
      );
      rail.castShadow = true;
      g.add(rail);
    }

    // --- Centre conductor strip (the LEGO monorail third rail) ---
    const conductor = new THREE.Mesh(
      buildStripGeometry(this.path, SAMPLES, CONDUCTOR_HALF_WIDTH, 0, CONDUCTOR_Y),
      MAT.yellow,
    );
    g.add(conductor);

    // --- Cross-ties (sleepers) spaced along the path ---
    const totalLen = this.path.getLength();
    const tieCount = Math.max(1, Math.floor(totalLen / TIE_INTERVAL));
    const tieGeo = new THREE.BoxGeometry(TIE_LENGTH, TIE_HEIGHT, TIE_DEPTH);
    for (let i = 0; i < tieCount; i++) {
      const t = i / tieCount;
      const p = this.path.getPointAt(t);
      const tan = this.path.getTangentAt(t);
      const tie = new THREE.Mesh(tieGeo, railMat);
      tie.position.set(p.x, TIE_Y, p.z);
      tie.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
      tie.receiveShadow = true;
      g.add(tie);
    }

    return g;
  }
}

/**
 * Build a flat strip mesh that follows a path at a constant lateral offset
 * from its centreline, with a fixed width and Y. Returns the geometry; the
 * caller picks the material.
 */
function buildStripGeometry(
  path: THREE.CatmullRomCurve3,
  samples: number,
  halfWidth: number,
  lateral: number,
  y: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = path.getPointAt(t);
    const tan = path.getTangentAt(t);
    const nx = -tan.z;
    const nz = tan.x;
    const len = Math.sqrt(nx * nx + nz * nz) || 1;
    const lx = nx / len;
    const lz = nz / len;
    const cx = p.x + lx * lateral;
    const cz = p.z + lz * lateral;
    const ux = lx * halfWidth;
    const uz = lz * halfWidth;
    positions.push(cx + ux, y, cz + uz);
    positions.push(cx - ux, y, cz - uz);
  }
  for (let i = 0; i < samples; i++) {
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
  return geo;
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
