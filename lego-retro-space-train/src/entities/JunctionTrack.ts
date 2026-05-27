import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';
import type { Direction } from '../world/trackTile';
import { RAMP_HEIGHT, TILE_SIZE, effectivePorts } from '../world/trackTile';
import { GraphEdge, GraphNode, TrackGraph } from '../world/trackGraph';
import { TrackLayout } from '../world/trackLayout';

// Monorail: a flat deck (the structural top of the track plinth) with a
// thin black centerline stripe (visual guide only — train still rides
// the deck centre). Switch-state glow is applied to the deck itself.
const DECK_HALF_WIDTH = 0.45;
const DECK_Y = 0.04;
const STRIPE_HALF_WIDTH = 0.06;
const STRIPE_Y = 0.06;

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
  /** One chevron mesh per TEE cell (keyed "gx,gz"). Hidden by default;
   *  setSwitchStates() reveals + rotates them to point at the active
   *  outbound direction. */
  private chevrons = new Map<string, THREE.Group>();

  constructor(opts: JunctionTrackOptions) {
    this.graph = opts.graph;
    this.object3d = this.build();
    if (opts.position) this.object3d.position.fromArray(opts.position);
  }

  /** Detach every mesh in our subtree from any parent and free GPU
   *  resources. Belt-and-braces: `Sim.remove` already detaches our root
   *  group, which makes children stop rendering — but if anything held a
   *  stale reference to a child (e.g. an in-flight raycaster), this
   *  ensures pillars / decks / chevrons are fully gone after a roll. */
  dispose(): void {
    this.object3d.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        // Materials may be shared from MAT — only dispose the per-edge
        // clones we created in build (the ones with our own deck/stripe
        // identities). For now leave material disposal alone to avoid
        // tearing up shared MAT entries.
      }
    });
    // Snap our object3d off any parent in case Sim.remove didn't.
    this.object3d.removeFromParent();
    // Clear children so subsequent traversals see nothing.
    this.object3d.clear();
    this.chevrons.clear();
  }

  /** Show a chevron at each TEE cell in the given map pointing along the
   *  given direction. Cells not in the map have their chevron hidden. */
  setSwitchStates(states: ReadonlyMap<string, Direction>): void {
    for (const [key, chevron] of this.chevrons) {
      const dir = states.get(key);
      if (!dir) {
        chevron.visible = false;
        continue;
      }
      chevron.visible = true;
      const [dx, dz] = dirToVec(dir);
      chevron.rotation.y = Math.atan2(dx, dz) - Math.PI / 2;
    }
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const deckMat = MAT.gray.clone();
    deckMat.side = THREE.DoubleSide;

    // --- Bridge pillars: two thin piers per ELEVATED cell, on the deck
    //     centerline and spaced apart along the track direction (so a
    //     crossing train passes BETWEEN them, perpendicular to the
    //     elevated track). Pillar HEIGHT scales with the tile's level
    //     so a level-2 or level-3 elevated section gets correspondingly
    //     taller piers.
    //
    //     Only build pillars for elevated tiles that are actually on an
    //     edge (junction endpoint or in-between cell). The component
    //     filter in WFC can leave behind tiles that survive connectivity
    //     but aren't reached by the trace — those would be rendered as
    //     "rogue" pillars with no deck above them. ---
    const usedCells = new Set<string>();
    for (const edge of this.graph.edges) {
      usedCells.add(`${edge.from.gridX},${edge.from.gridZ}`);
      usedCells.add(`${edge.to.gridX},${edge.to.gridZ}`);
      for (const [gx, gz] of edge.midCells) usedCells.add(`${gx},${gz}`);
    }
    const pillarMat = MAT.grayDark;
    for (const tile of this.graph.layout.tiles()) {
      if (tile.def.kind !== 'elevated-straight-ns') continue;
      if (!usedCells.has(`${tile.gridX},${tile.gridZ}`)) continue;
      const cx = tile.gridX * TILE_SIZE;
      const cz = tile.gridZ * TILE_SIZE;
      const horizontalTrack = tile.rotation === 1 || tile.rotation === 3;
      const alongX = horizontalTrack ? 1 : 0;
      const alongZ = horizontalTrack ? 0 : 1;
      const spacing = TILE_SIZE * 0.4;
      const totalHeight = (1 + (tile.level ?? 0)) * RAMP_HEIGHT;
      const pillarGeo = new THREE.BoxGeometry(0.16, totalHeight, 0.16);
      for (const sign of [-1, 1] as const) {
        const pillar = new THREE.Mesh(pillarGeo, pillarMat);
        pillar.position.set(
          cx + sign * alongX * spacing,
          totalHeight / 2,
          cz + sign * alongZ * spacing,
        );
        pillar.castShadow = true;
        pillar.receiveShadow = true;
        g.add(pillar);
      }
    }

    // Shared stripe material — black centre line, double-sided since the
    // strip geometry's normal points DOWN (triangles wound such that the
    // up-face is the back).
    const stripeMat = MAT.black.clone();
    stripeMat.side = THREE.DoubleSide;

    // --- Edges: deck + black centre stripe per edge. Switch state is
    //     shown via separate chevron meshes at each TEE cell (built
    //     below), not by glowing track segments. ---
    for (const edge of this.graph.edges) {
      this.drawTrackAlongCurve(g, edge.curve, deckMat, stripeMat);
    }

    // --- Switch-state chevrons ---
    // One small green arrow per TEE cell, hovering above the deck centre.
    // setSwitchStates() rotates / hides them per frame to reflect the
    // direction the train will exit each TEE next.
    const seenTEE = new Set<string>();
    for (const node of this.graph.nodes) {
      if (node.mainSide === undefined) continue;
      const key = `${node.gridX},${node.gridZ}`;
      if (seenTEE.has(key)) continue;
      seenTEE.add(key);
      const chevron = buildChevron();
      chevron.position.set(
        node.gridX * TILE_SIZE,
        node.pos.y + 0.15,
        node.gridZ * TILE_SIZE,
      );
      chevron.visible = false;
      g.add(chevron);
      this.chevrons.set(key, chevron);
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
      this.drawTrackAlongCurve(g, stub, deckMat);
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
      const yawY = Math.atan2(trackDx, trackDz) - Math.PI / 2;

      // 1. Platform deck.
      const platGeo = new THREE.BoxGeometry(TILE_SIZE * 1.8, 0.18, 0.5);
      const plat = new THREE.Mesh(platGeo, platMat);
      plat.position.set(px, py + 0.1, pz);
      plat.rotation.y = yawY;
      plat.receiveShadow = true;
      plat.castShadow = true;
      g.add(plat);

      // 2. Back wall — runs along the far edge of the platform (the side
      //    away from the track). Acts as the station building's back.
      const wallGeo = new THREE.BoxGeometry(TILE_SIZE * 1.6, 0.42, 0.08);
      const wall = new THREE.Mesh(wallGeo, MAT.white);
      wall.position.set(
        px + chosen[0] * 0.2,
        py + 0.4,
        pz + chosen[1] * 0.2,
      );
      wall.rotation.y = yawY;
      wall.castShadow = true;
      wall.receiveShadow = true;
      g.add(wall);

      // 3. Canopy roof — thin slab spanning the platform, hovering above.
      const roofGeo = new THREE.BoxGeometry(TILE_SIZE * 1.9, 0.06, 0.66);
      const roof = new THREE.Mesh(roofGeo, MAT.gray);
      roof.position.set(px, py + 0.74, pz);
      roof.rotation.y = yawY;
      roof.castShadow = true;
      g.add(roof);

      // 4. Two support posts at the track-facing front edge of the platform.
      const postGeo = new THREE.BoxGeometry(0.08, 0.6, 0.08);
      for (const longOff of [-TILE_SIZE * 0.7, TILE_SIZE * 0.7]) {
        const ox = trackDx * longOff;
        const oz = trackDz * longOff;
        const post = new THREE.Mesh(postGeo, MAT.grayDark);
        post.position.set(
          px + ox - chosen[0] * 0.2,
          py + 0.4,
          pz + oz - chosen[1] * 0.2,
        );
        post.castShadow = true;
        g.add(post);
      }

      // 5. Station ID LED — small green light on top of the back wall.
      const ledGeo = new THREE.BoxGeometry(0.18, 0.05, 0.1);
      const led = new THREE.Mesh(ledGeo, MAT.greenLED);
      led.position.set(
        px + chosen[0] * 0.2,
        py + 0.65,
        pz + chosen[1] * 0.2,
      );
      led.rotation.y = yawY;
      g.add(led);
    }

    return g;
  }

  private drawTrackAlongCurve(
    g: THREE.Group,
    curve: THREE.CatmullRomCurve3,
    deckMat: THREE.Material,
    stripeMat: THREE.Material = MAT.black,
  ): void {
    const length = curve.getLength();
    const samples = samplesForCurve(length);
    const deck = new THREE.Mesh(
      buildStripGeometrySamples(curve, samples, 0, samples, DECK_HALF_WIDTH, 0, DECK_Y),
      deckMat,
    );
    deck.receiveShadow = true;
    g.add(deck);
    const stripe = new THREE.Mesh(
      buildStripGeometrySamples(curve, samples, 0, samples, STRIPE_HALF_WIDTH, 0, STRIPE_Y),
      stripeMat,
    );
    g.add(stripe);
  }

}

/** Small flat green-LED chevron pointing along +X. Caller rotates around
 *  Y to face the active exit direction. */
function buildChevron(): THREE.Group {
  const g = new THREE.Group();
  const armGeo = new THREE.BoxGeometry(0.45, 0.05, 0.1);
  // Two arms splaying back from the apex (at +X). Together they form a >.
  for (const sign of [-1, 1] as const) {
    const arm = new THREE.Mesh(armGeo, MAT.greenLED);
    // Arm runs from apex (0.25, 0) to back-corner (-0.05, ±0.22). Centre it
    // at the midpoint between those two points, and rotate around Y so its
    // local +X axis points from apex to corner.
    const apex = new THREE.Vector3(0.25, 0, 0);
    const back = new THREE.Vector3(-0.05, 0, sign * 0.22);
    const mid = apex.clone().add(back).multiplyScalar(0.5);
    arm.position.copy(mid);
    const dir = back.clone().sub(apex);
    arm.rotation.y = Math.atan2(dir.x, dir.z) - Math.PI / 2;
    arm.castShadow = true;
    g.add(arm);
  }
  return g;
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

/** Same as buildStripGeometry but only over the sample-index range
 *  [iStart, iEnd] (inclusive). Used to render an edge as multiple
 *  pieces — e.g. the in-TEE-cell portion separately from the rest. */
function buildStripGeometrySamples(
  path: THREE.CatmullRomCurve3,
  totalSamples: number,
  iStart: number,
  iEnd: number,
  halfWidth: number,
  lateral: number,
  y: number,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const count = iEnd - iStart;
  for (let k = 0; k <= count; k++) {
    const i = iStart + k;
    const t = i / totalSamples;
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
    const py = p.y + y;
    positions.push(cx + ux, py, cz + uz);
    positions.push(cx - ux, py, cz - uz);
  }
  for (let k = 0; k < count; k++) {
    const a = k * 2;
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
