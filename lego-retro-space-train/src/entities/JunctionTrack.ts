import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import { Direction, RAMP_HEIGHT, TILE_SIZE, dirVector, effectivePorts } from '../world/trackTile';
import { GraphEdge, GraphNode, TrackGraph } from '../world/trackGraph';
import { TrackLayout } from '../world/trackLayout';

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

function samplesForCurve(length: number): number {
  // Bumped from ×8 to ×24 — strips were visibly polygonal on the corner
  // arcs of the rectangle. Strip geometry is cheap; smooth wins.
  return Math.max(64, Math.ceil(length * 24));
}

export interface JunctionTrackOptions {
  graph: TrackGraph;
  position?: THREE.Vector3Tuple;
}

/**
 * Renders a TrackGraph. Rails for in-between cells come from each edge's
 * renderCurve; rails through junction cells come from the tile's own
 * samplePath (one curve per pair of edges incident at the junction), so
 * TEEs render as wye arcs and CROSSes as straight crossings rather than
 * 90° T-stubs cut into the edge curve.
 */
export class JunctionTrack implements Entity {
  readonly object3d: THREE.Group;
  readonly graph: TrackGraph;
  /** Switch-state arrows, indexed by junction node id. Each arrow sits
   *  at the TEE's cell centre and rotates to point along the train's
   *  upcoming exit direction. setSwitchState rotates them per frame. */
  private switchArrows = new Map<string, THREE.Object3D>();

  constructor(opts: JunctionTrackOptions) {
    this.graph = opts.graph;
    this.object3d = this.build();
    if (opts.position) this.object3d.position.fromArray(opts.position);
  }

  /** Point the switch arrow at `nodeId` toward `exitPort`. Called per
   *  frame from the sim with the train's currently-planned exit. */
  setSwitchState(nodeId: string, exitPort: Direction): void {
    const arrow = this.switchArrows.get(nodeId);
    if (!arrow) return;
    const [dx, dz] = dirVector(exitPort);
    arrow.rotation.y = Math.atan2(dx, dz);
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const deckMat = MAT.gray.clone();
    deckMat.side = THREE.DoubleSide;
    const railMat = MAT.grayDark.clone();

    // --- Bridge pillars: only under ELEVATED cells. RAMP cells were
    //     getting fixed-height pillars at the cell centre which didn't
    //     match the sloping deck, producing visible "step" geometry at
    //     the ramp seams. Ramps now visually rest on the abutting
    //     elevated pillars + the ground at the low end. ---
    const pillarMat = MAT.grayDark;
    for (const tile of this.graph.layout.tiles()) {
      if (tile.def.kind !== 'elevated-straight-ns') continue;
      const pillarGeo = new THREE.BoxGeometry(0.32, RAMP_HEIGHT, 0.32);
      const pillar = new THREE.Mesh(pillarGeo, pillarMat);
      pillar.position.set(tile.gridX * TILE_SIZE, RAMP_HEIGHT / 2, tile.gridZ * TILE_SIZE);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      g.add(pillar);
    }

    // --- Switch-state arrows on each junction node ---
    // A small bright cone sits at the TEE cell centre and rotates to
    // point in the direction the train will exit next. Gives the user a
    // visual cue for "the switch is set this way".
    const arrowMat = new THREE.MeshStandardMaterial({
      color: 0xffaa22, emissive: 0xffaa22, emissiveIntensity: 0.5,
    });
    for (const node of this.graph.nodes) {
      if (node.kind !== 'junction') continue;
      const arrowGroup = new THREE.Group();
      arrowGroup.position.set(node.pos.x, node.pos.y + 0.6, node.pos.z);
      // Cone, pointing along +Z by default (rotation.y = 0 → south).
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry(0.18, 0.5, 12),
        arrowMat,
      );
      cone.rotation.x = Math.PI / 2; // lay it flat so the tip points along XZ
      cone.position.z = 0.25;        // tip offset so the arrow shows direction
      cone.castShadow = true;
      arrowGroup.add(cone);
      g.add(arrowGroup);
      this.switchArrows.set(node.id, arrowGroup);
    }

    // --- Edges: one continuous strip per edge ---
    // Each edge curve covers junction-A-centre → junction-B-centre,
    // including bezier turnouts at branch ports. Two main-pair edges
    // through the same junction render overlapping straight halves that
    // form a continuous main rail; a branch edge renders a single
    // smoothly-curving turnout in the same junction cell.
    for (const edge of this.graph.edges) {
      this.drawTrackAlongCurve(g, edge.curve, deckMat, railMat);
    }

    // --- 1-edge nodes (spur ends): draw the dead-end half of the tile so
    //     the cell isn't half-rendered. ---
    for (const node of this.graph.nodes) {
      if (node.edges.length !== 1) continue;
      const tile = this.graph.layout.get(node.gridX, node.gridZ);
      if (!tile) continue;
      const ports = effectivePorts(tile);
      const onlyEdge = node.edges[0]!;
      const activePort = onlyEdge.from === node ? onlyEdge.fromExitPort : onlyEdge.toEntryPort;
      const deadPort = ports.find((p) => p !== activePort);
      if (!deadPort) continue;
      // Render a straight half-tile from cell centre to the dead-end port
      // boundary, so the spur visually terminates with a stub.
      const cx = node.gridX * TILE_SIZE;
      const cz = node.gridZ * TILE_SIZE;
      const half = TILE_SIZE / 2;
      const [dx, dz] = dirToVec(deadPort);
      const pts = [
        new THREE.Vector3(cx, node.pos.y, cz),
        new THREE.Vector3(cx + dx * half, node.pos.y, cz + dz * half),
      ];
      const stub = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
      this.drawTrackAlongCurve(g, stub, deckMat, railMat);
      // Buffer stop: a small red box at the dead-end boundary.
      const stopGeo = new THREE.BoxGeometry(0.7, 0.18, 0.18);
      const stopMat = MAT.grayDark.clone();
      stopMat.color.set('#aa2222');
      const stop = new THREE.Mesh(stopGeo, stopMat);
      stop.position.set(
        cx + dx * half * 0.9,
        node.pos.y + 0.1,
        cz + dz * half * 0.9,
      );
      stop.rotation.y = Math.atan2(dx, dz);
      stop.castShadow = true;
      g.add(stop);
    }

    // --- Station platforms ---
    // Sit the platform perpendicular to the track at the station cell,
    // long axis aligned with the track. Check BOTH perpendicular sides
    // and prefer the one without track tiles in adjacent cells (avoids
    // platforms landing inside a loop on top of other track).
    const platMat = MAT.gray.clone();
    const layout = this.graph.layout;
    for (const node of this.graph.nodes) {
      if (node.kind !== 'station') continue;
      const incident = node.edges[0];
      if (!incident) continue;
      const tEnd = incident.from === node ? 0 : 1;
      const tan = incident.curve.getTangentAt(tEnd);
      const trackLen = Math.hypot(tan.x, tan.z) || 1;
      const trackDx = tan.x / trackLen;
      const trackDz = tan.z / trackLen;
      // Quantise the perpendicular to one of the 4 cardinal axes so
      // we can do grid-cell occupancy checks (track tiles are on a
      // grid). For a tangent that's not perfectly axial (curve mid-
      // point), round to the dominant axis.
      const candA = unitPerp(trackDx, trackDz, +1);
      const candB = unitPerp(trackDx, trackDz, -1);
      const sideAFree = sideHasNoTrack(layout, node.gridX, node.gridZ, candA);
      const sideBFree = sideHasNoTrack(layout, node.gridX, node.gridZ, candB);
      const chosen = sideAFree ? candA : sideBFree ? candB : candA;
      const offset = TILE_SIZE * 0.55; // platform centre ~1.3u from rail; near edge ~1u
      const px = node.pos.x + chosen[0] * offset;
      const py = node.pos.y;
      const pz = node.pos.z + chosen[1] * offset;
      const platGeo = new THREE.BoxGeometry(TILE_SIZE * 1.8, 0.18, 0.5);
      const plat = new THREE.Mesh(platGeo, platMat);
      plat.position.set(px, py + 0.1, pz);
      plat.rotation.y = Math.atan2(trackDx, trackDz) - Math.PI / 2;
      plat.receiveShadow = true;
      plat.castShadow = true;
      g.add(plat);
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.9, 10),
        MAT.greenLED,
      );
      marker.position.set(px, py + 0.45, pz);
      marker.castShadow = true;
      g.add(marker);
    }

    return g;
  }

  private drawTrackAlongCurve(
    g: THREE.Group,
    curve: THREE.CatmullRomCurve3,
    deckMat: THREE.Material,
    railMat: THREE.Material,
  ): void {
    const length = curve.getLength();
    const samples = samplesForCurve(length);
    const deck = new THREE.Mesh(
      buildStripGeometry(curve, samples, DECK_HALF_WIDTH, 0, DECK_Y),
      deckMat,
    );
    deck.receiveShadow = true;
    g.add(deck);
    for (const lateral of [-RAIL_LATERAL, RAIL_LATERAL]) {
      const rail = new THREE.Mesh(
        buildStripGeometry(curve, samples, RAIL_HALF_WIDTH, lateral, RAIL_Y),
        railMat,
      );
      rail.castShadow = true;
      g.add(rail);
    }
    const conductor = new THREE.Mesh(
      buildStripGeometry(curve, samples, CONDUCTOR_HALF_WIDTH, 0, CONDUCTOR_Y),
      MAT.yellow,
    );
    g.add(conductor);
    const tieCount = Math.max(1, Math.floor(length / TIE_INTERVAL));
    const tieGeo = new THREE.BoxGeometry(TIE_LENGTH, TIE_HEIGHT, TIE_DEPTH);
    for (let i = 0; i < tieCount; i++) {
      const t = (i + 0.5) / tieCount;
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const tie = new THREE.Mesh(tieGeo, railMat);
      tie.position.set(p.x, p.y + TIE_Y, p.z);
      tie.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
      tie.receiveShadow = true;
      g.add(tie);
    }
  }

}

/** Quantise the perpendicular of a track tangent to a unit cardinal
 *  vector. `side` = +1 for CCW perpendicular, -1 for CW. The perpendicular
 *  axis is whichever of (-tz, tx) or (tz, -tx) is dominant. */
function unitPerp(tx: number, tz: number, side: 1 | -1): [number, number] {
  // CCW perp = (-tz, tx). CW perp = (tz, -tx).
  const px = side === 1 ? -tz : tz;
  const pz = side === 1 ? tx : -tx;
  // Snap to nearest cardinal.
  if (Math.abs(px) >= Math.abs(pz)) return [Math.sign(px) || 1, 0];
  return [0, Math.sign(pz) || 1];
}

/** True if cells (gx + dx, gz + dz) and (gx + 2dx, gz + 2dz) are both
 *  empty in the layout — i.e. the perpendicular side has room for a
 *  platform without overlapping another track tile. */
function sideHasNoTrack(
  layout: TrackLayout,
  gx: number,
  gz: number,
  side: readonly [number, number],
): boolean {
  const [dx, dz] = side;
  return !layout.get(gx + dx, gz + dz) && !layout.get(gx + 2 * dx, gz + 2 * dz);
}

function dirToVec(d: Direction): readonly [number, number] {
  switch (d) {
    case 'N': return [0, -1];
    case 'E': return [1, 0];
    case 'S': return [0, 1];
    case 'W': return [-1, 0];
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
    // Strip follows the curve's own Y so ramps climb visibly; `y` adds
    // the constant offset (rail height above deck, etc.).
    const py = p.y + y;
    positions.push(cx + ux, py, cz + uz);
    positions.push(cx - ux, py, cz - uz);
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

export type { GraphEdge, GraphNode, TrackGraph };
