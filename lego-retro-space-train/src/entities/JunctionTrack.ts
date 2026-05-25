import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { TILE_SIZE } from '../world/trackTile';
import { GraphEdge, GraphNode, TrackGraph } from '../world/trackGraph';

// Visual constants mirror TileTrack so the two entities look consistent.
const DECK_HALF_WIDTH = 0.45;
const DECK_Y = 0.04;
const RAIL_HALF_WIDTH = 0.04;
const RAIL_LATERAL = 0.4;
const RAIL_Y = 0.085;
const CONDUCTOR_HALF_WIDTH = 0.05;
const CONDUCTOR_Y = 0.075;
const TIE_INTERVAL = 0.55;
const TIE_LENGTH = 0.95;
const TIE_DEPTH = 0.16;
const TIE_HEIGHT = 0.03;
const TIE_Y = 0.055;

// Per-edge sample count; longer edges get more samples for smoothness.
function samplesForEdge(length: number): number {
  return Math.max(32, Math.ceil(length * 8));
}

export interface JunctionTrackOptions {
  graph: TrackGraph;
  position?: THREE.Vector3Tuple;
}

/**
 * Renders a TrackGraph: pads for every tile, deck+rails+conductor+ties
 * along every edge, small visual markers for junction and station nodes.
 * The graph itself is exposed so trains can route over it.
 */
export class JunctionTrack implements Entity {
  readonly object3d: THREE.Group;
  readonly graph: TrackGraph;

  constructor(opts: JunctionTrackOptions) {
    this.graph = opts.graph;
    this.object3d = this.build();
    if (opts.position) this.object3d.position.fromArray(opts.position);
  }

  private build(): THREE.Group {
    const g = new THREE.Group();

    // --- Cell pads for every tile in the underlying layout ---
    const padGeo = new THREE.BoxGeometry(TILE_SIZE * 0.96, 0.012, TILE_SIZE * 0.96);
    const padMat = MAT.grayDark.clone();
    padMat.transparent = true;
    padMat.opacity = 0.35;
    for (const tile of this.graph.layout.tiles()) {
      const pad = new THREE.Mesh(padGeo, padMat);
      pad.position.set(tile.gridX * TILE_SIZE, 0.012, tile.gridZ * TILE_SIZE);
      pad.receiveShadow = true;
      g.add(pad);
    }

    // --- Per-edge deck + rails + conductor + ties ---
    const deckMat = MAT.gray.clone();
    deckMat.side = THREE.DoubleSide;
    const railMat = MAT.grayDark.clone();
    for (const edge of this.graph.edges) {
      const samples = samplesForEdge(edge.length);
      const deck = new THREE.Mesh(
        buildStripGeometry(edge.curve, samples, DECK_HALF_WIDTH, 0, DECK_Y),
        deckMat,
      );
      deck.receiveShadow = true;
      g.add(deck);
      for (const lateral of [-RAIL_LATERAL, RAIL_LATERAL]) {
        const rail = new THREE.Mesh(
          buildStripGeometry(edge.curve, samples, RAIL_HALF_WIDTH, lateral, RAIL_Y),
          railMat,
        );
        rail.castShadow = true;
        g.add(rail);
      }
      const conductor = new THREE.Mesh(
        buildStripGeometry(edge.curve, samples, CONDUCTOR_HALF_WIDTH, 0, CONDUCTOR_Y),
        MAT.yellow,
      );
      g.add(conductor);
      // Ties (sleepers) spaced along the edge curve.
      const tieCount = Math.max(1, Math.floor(edge.length / TIE_INTERVAL));
      const tieGeo = new THREE.BoxGeometry(TIE_LENGTH, TIE_HEIGHT, TIE_DEPTH);
      for (let i = 0; i < tieCount; i++) {
        const t = (i + 0.5) / tieCount;
        const p = edge.curve.getPointAt(t);
        const tan = edge.curve.getTangentAt(t);
        const tie = new THREE.Mesh(tieGeo, railMat);
        tie.position.set(p.x, TIE_Y, p.z);
        tie.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
        tie.receiveShadow = true;
        g.add(tie);
      }
    }

    // --- Junction markers (small yellow column where switches sit) ---
    const jctGeo = new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12);
    for (const node of this.graph.nodes) {
      if (node.kind !== 'junction') continue;
      const post = new THREE.Mesh(jctGeo, MAT.yellow);
      post.position.set(node.pos.x, 0.3, node.pos.z);
      post.castShadow = true;
      g.add(post);
    }

    // --- Station platforms (low slab + label-ish bumper) ---
    const platGeo = new THREE.BoxGeometry(TILE_SIZE * 1.6, 0.18, 0.6);
    const platMat = MAT.gray.clone();
    for (const node of this.graph.nodes) {
      if (node.kind !== 'station') continue;
      // Place the platform to the SIDE of the track cell, not on top.
      // For simplicity, offset by 1 cell in -Z direction (north of station).
      const plat = new THREE.Mesh(platGeo, platMat);
      plat.position.set(node.pos.x, 0.1, node.pos.z - TILE_SIZE * 0.8);
      plat.receiveShadow = true;
      plat.castShadow = true;
      g.add(plat);
      // Small green column marking the station node.
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10),
        MAT.greenLED,
      );
      marker.position.set(node.pos.x, 0.45, node.pos.z - TILE_SIZE * 0.8);
      marker.castShadow = true;
      g.add(marker);
    }

    return g;
  }
}

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

// Re-export for callers that don't import directly.
export type { GraphEdge, GraphNode, TrackGraph };
