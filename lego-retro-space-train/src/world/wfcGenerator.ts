// ---------------------------------------------------------------------------
// WFC → TrackGraph adapter.
//
// 1. Run WFC on a small grid.
// 2. Convert each non-EMPTY cell to a PlacedTile in a TrackLayout.
// 3. Identify junctions (3+ port tiles) and station candidates
//    (1-port dead-ends or designated cells).
// 4. Validate connectivity + intersection-required contract; retry the
//    whole WFC + adapter pipeline if it fails.
// ---------------------------------------------------------------------------
import { TrackLayout, portY } from './trackLayout';
import { UNDER_PASS_NESW, EMPTY_TILE } from './trackTile';
import { buildGraphFromLayout, NodeKind, TrackGraph, GraphNode } from './trackGraph';
import {
  Direction, DIRECTIONS, dirVector, effectivePorts, opposite, PlacedTile,
  Rotation, STRAIGHT_NS, ELEVATED_STRAIGHT_NS, CURVE_NE, ELEVATED_CURVE_NE,
  RAMP_NS, RAMP_NS_TALL, RAMP_HEIGHT, TEE_NES, CROSS_NESW, TrackTileDef,
} from './trackTile';
import {
  AdjacencyTable,
  buildAdjacencyTable,
  enumerateVariants,
  solveWFC,
  Variant,
} from './wfc';

export interface WFCGenResult {
  graph: TrackGraph;
  stations: GraphNode[];
  junctions: GraphNode[];
  retries: number;
  /** Diagnostic counters from the stratified pipeline. */
  diag?: {
    /** Total Y=2H bridges produced (lifted + constructed). */
    liftedChains: number;
    /** Subset of liftedChains that came from Pass 3 empty-strip construction. */
    constructedChains: number;
    /** Tiles placed by the Pass 4 upper-deck overlay (independent
     *  Y=2H-biased WFC stacked into the layout). */
    upperDeckTiles?: number;
  };
}

export interface WFCGenOptions {
  /** Grid size in cells (square). */
  size?: number;
  /** RNG. */
  rng?: () => number;
  /** Max WFC pipeline retries before giving up. */
  maxRetries?: number;
  /** Highest level enumerated per level-supporting tile (default 1). */
  maxLevel?: number;
  /** Pin every tile in this layout as a pre-seed for the new solve, so
   *  the result MERGES with what's already on the plate — new tracks
   *  must adjacency-match the existing ones. Tiles outside the new
   *  grid bounds are silently dropped. */
  pinLayout?: TrackLayout;
}

/** Run WFC, build a graph from the result, validate the contract (≥1
 *  intersection, ≥2 stations, all nodes reachable from one another).
 *  Restarts the pipeline on contradiction or contract failure. */
export function generateWFCGraph(opts: WFCGenOptions = {}): WFCGenResult {
  const size = opts.size ?? 13;
  const rng = opts.rng ?? Math.random;
  // With EMPTY removed from the variant pool, contradictions are more
  // common (no fallback variant). Bumped retry budget to compensate —
  // most successful first-rolls happen well within 200 attempts.
  const maxRetries = opts.maxRetries ?? 200;
  const requestedMaxLevel = opts.maxLevel ?? 1;
  // Stratified gen. Pass 1's WFC pool is clamped so the search space stays
  // tractable (maxLevel=2 was ~35% contradiction). Pass 2 (post-mutation,
  // below) injects the next deck up via deterministic chain lifts.
  //   requested=1 → pool maxLevel=0 (ground + Y=H elevated, no Y=2H)
  //   requested≥2 → pool maxLevel=1 (allows Y=2H from WFC) + lift to Y=2H
  // This also gives the HUD level dropdown teeth: L1 visibly has no top
  // deck, L2 reliably gets bridges to Y=2H.
  const wfcMaxLevel = requestedMaxLevel <= 1 ? 0 : 1;

  const variants = enumerateVariants(wfcMaxLevel);
  const table = buildAdjacencyTable(variants);
  const variantById = table.byId;
  // No pre-seed. Tried pinning an ELEV@L=1 anchor at centre to FORCE a
  // Y=2H bubble — at 13×13 the bubble can't fold back to ground
  // reliably and WFC contradicted ~95% of seeds. Stratified gen +
  // chain lifts (below) is the only path that doesn't tank fail rate.
  const preSeed = new Map<string, string>();
  void buildMultiLevelPreSeed;
  // Merge the cumulative layout's tiles into the pre-seed so the new
  // solve fits AROUND what's already on the plate. Convert each tile to
  // its canonical variant id; tiles that don't match any variant are
  // dropped (defensive — shouldn't happen since prior rolls came from
  // the same variant table).
  if (opts.pinLayout) {
    const half = Math.floor(size / 2);
    // Walk PRIMARY cells. For each, also check if the layout has an
    // under-tile at the same cell — if so, this is an under-pass, and
    // we pin it as UNDER_PASS_NESW (not the decomposed ELEVATED/STRAIGHT
    // pair, since those wouldn't preserve the under-pass on rebuild).
    for (const t of opts.pinLayout.tiles()) {
      if (opts.pinLayout.get(t.gridX, t.gridZ) !== t) continue; // skip under-tiles
      const wfcX = t.gridX + half;
      const wfcY = t.gridZ + half;
      if (wfcX < 0 || wfcX >= size || wfcY < 0 || wfcY >= size) continue;
      const under = opts.pinLayout.getUnder(t.gridX, t.gridZ);
      let vid: string | null = null;
      if (under && t.def.kind === 'elevated-straight-ns' && under.def.kind === 'straight-ns') {
        // Under-pass: upper layer E-W means primary rotation 1 (or 3),
        // lower layer N-S — that's UNDER_PASS_NESW rotation 0.
        const upperHorizontal = t.rotation === 1 || t.rotation === 3;
        const upRot = upperHorizontal ? 0 : 1;
        vid = findVariantId(UNDER_PASS_NESW.kind, upRot, t.level ?? 0, table);
      }
      if (!vid) vid = findVariantId(t.def.kind, t.rotation, t.level ?? 0, table);
      if (vid) preSeed.set(`${wfcX},${wfcY}`, vid);
    }
  }

  let totalRetries = 0;
  const reasons: Record<string, number> = {};
  const bump = (key: string) => { reasons[key] = (reasons[key] ?? 0) + 1; };
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const wfc = solveWFC(table, { width: size, height: size, rng, preSeed });
      totalRetries += wfc.retries;

      // Convert WFC output to a TrackLayout. Center the grid on the
      // plate by subtracting size/2 from each cell coord. UNDER_PASS_NESW
      // is a WFC-virtual tile — at placement it decomposes into an
      // ELEVATED primary tile + a STRAIGHT under-tile.
      const half = Math.floor(size / 2);
      const layout = new TrackLayout();
      for (const [k, id] of wfc.cells) {
        const [x, y] = parseKey(k);
        const v = variantById.get(id)!;
        if (v.def.kind === 'empty') continue;
        const gx = x - half;
        const gz = y - half;
        if (v.def.kind === 'under-pass-nesw') {
          // Base orientation: upper layer runs E-W, lower layer runs N-S.
          // Rotation 0 → upper E-W, lower N-S; rotation 1 → upper N-S,
          // lower E-W. At level=k, upper sits at (k+1)*H and lower at k*H.
          const upperHorizontal = v.rotation === 0 || v.rotation === 2;
          const upperRot = upperHorizontal ? 1 : 0; // ELEVATED rot 0 = N-S, rot 1 = E-W
          const lowerRot = upperHorizontal ? 0 : 1; // STRAIGHT_NS rot 0 = N-S, rot 1 = E-W
          // Upper layer: ELEVATED at the variant's level (ports at (k+1)*H).
          layout.place(gx, gz, ELEVATED_STRAIGHT_NS, upperRot, undefined, v.level);
          // Lower layer: STRAIGHT at the variant's level (ports at k*H).
          // STRAIGHT_NS has y=0 ports by default, so + level*H lift puts
          // them at the right elevation for the under-pass's bottom layer.
          layout.placeUnder(gx, gz, STRAIGHT_NS, lowerRot, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-ns') {
          // Both layers same direction. Rotation 0/2 → both N-S; rotation
          // 1/3 → both E-W. Upper layer at (level+1)*H, lower at level*H.
          const vertical = v.rotation === 0 || v.rotation === 2;
          const rot = vertical ? 0 : 1;
          layout.place(gx, gz, ELEVATED_STRAIGHT_NS, rot, undefined, v.level);
          layout.placeUnder(gx, gz, STRAIGHT_NS, rot, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-curve-ne') {
          // Both layers curve the same way. Upper layer ELEVATED_CURVE_NE,
          // lower CURVE_NE — same rotation.
          layout.place(gx, gz, ELEVATED_CURVE_NE, v.rotation, undefined, v.level);
          layout.placeUnder(gx, gz, CURVE_NE, v.rotation, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-ramp-ns') {
          // Transition cell: primary is a RAMP at the variant's rotation
          // (ramps from Y=0 on the ground-side port to Y=H on the
          // overpass-side port). Under is a STRAIGHT_NS at the same
          // rotation (continuous ground track running under the ramp).
          layout.place(gx, gz, RAMP_NS, v.rotation, undefined, v.level);
          layout.placeUnder(gx, gz, STRAIGHT_NS, v.rotation, undefined, v.level);
          continue;
        }
        layout.place(gx, gz, v.def, v.rotation, undefined, v.level);
      }

      if (layout.tiles().length < 4) { bump('too-sparse'); continue; }

      // Connectivity: WFC's local rules don't enforce global connectivity,
      // so the output may have multiple disconnected blobs. Instead of
      // rejecting (which kills success rate), we find the LARGEST
      // connected component and drop every tile not in it.
      // BRIDGE first to merge what we can. With EMPTY removed from the
      // variant pool, WFC fills every cell — but the result is many
      // small components. Bridge upgrades adjacent boundary tiles so
      // their ports connect (STRAIGHT → TEE → CROSS as needed).
      bridgeComponents(layout);
      // After bridging, keep only the largest connected component to
      // guarantee buildGraphFromLayout has a clean topology.
      keepOnlyLargestComponent(layout);
      // Trim cells with unmatched ports + strip elevated chains that
      // no ramp can reach.
      trimDeadEnds(layout);
      if (stripUnreachableUpperDecks(layout)) trimDeadEnds(layout);
      // Flatten ramp-up + ramp-down peaks (▲ shape) — replace BOTH ramp
      // cells with STRAIGHT at the ramp's low level. Cells beyond
      // already expect that low Y, so no cascade.
      flattenRampPeaks(layout);
      const tiles = layout.tiles();
      if (tiles.length < 4) { bump('too-sparse-after-component-filter'); continue; }

      // Try to add an under-pass (best-effort — only succeeds if a
      // level-0 elevated cell happens to have ground neighbors on its
      // perpendicular axis).
      tryAddUnderpass(layout);

      // Pass 2 lifts removed — they mutated Pass 1's primary tiles to
      // create Y=2H bridges, which clashed with Pass 4's independent
      // upper-deck overlay. Functions kept for reference.
      const liftedChains = 0;
      const constructedChains = 0;
      void liftElevatedToL2; void constructL2EmptyStrips;

      // Pass 4 — upper-deck overlay BEFORE graph build, so the graph
      // extractor sees both Pass 1 + Pass 4 tiles and traces them as
      // ONE connected network (ramps bridge Y=H to Y=2H).
      let upperDeckTiles = 0;
      let deckRampBridges = 0;
      if (requestedMaxLevel >= 2) {
        upperDeckTiles = generateUpperDeckOverlay(layout, rng, size);
        deckRampBridges = bridgeDeckToGround(layout);
      }
      void upperDeckTiles; void deckRampBridges;

      // Strict h1/h2/underpass criteria removed — with EMPTY out of the
      // variant pool and the level-1 anchor pre-seed gone, requiring
      // every layout to contain a level-2 bridge AND an under-pass tanks
      // the success rate. Variety now comes from the larger surviving
      // layout (multiple components, more tiles total).

      // DENSIFY PASS removed: with EMPTY gone from the variant pool, the
      // first solve already fills every cell, so the densify re-solve
      // produces the same layout. It also called keepComponentContaining
      // which stripped down to the anchor's component — defeating the
      // density gains we want. Helper functions are left in place in
      // case we need them later (suppress unused warnings).
      void densifyLayout; void keepComponentContaining;

      const tilesPostDensify = layout.tiles();
      const junctionCells: Array<{ gx: number; gz: number; kind: NodeKind; label?: string; tile: PlacedTile }> = [];
      let stationCounter = 0;
      const stationLabel = () => String.fromCharCode(65 + stationCounter++);
      const claimedCells = new Set<string>();
      for (const t of tilesPostDensify) {
        const ports = effectivePorts(t);
        if (ports.length >= 3) {
          junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'junction', label: 'J', tile: t });
          claimedCells.add(`${t.gridX},${t.gridZ}`);
        } else if (ports.length === 1) {
          // 1-port = dead-end station. Rendered as a stub with buffer stop;
          // NOT added to the train's target cycle (would force reversal).
          junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel(), tile: t });
          claimedCells.add(`${t.gridX},${t.gridZ}`);
        }
      }
      // Add THROUGH-stations: one per physical Y level present (so each
      // layer has at least one stop), then fill up to 4 total from the
      // leftover pool.
      const picked = pickStationCells(tilesPostDensify, claimedCells, layout, rng, 4) ?? [];
      for (const t of picked) {
        junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel(), tile: t });
        claimedCells.add(`${t.gridX},${t.gridZ}`);
      }
      const stationCount = junctionCells.filter((c) => c.kind === 'station').length;
      const junctionCount = junctionCells.filter((c) => c.kind === 'junction').length;
      if (stationCount < 2) { bump(`too-few-stations:${stationCount}`); continue; }
      if (junctionCount < 1) { bump('no-junctions'); continue; }

      let graph: TrackGraph;
      try {
        graph = buildGraphFromLayout(layout, junctionCells);
      } catch (err) {
        bump(`build-graph-threw:${(err as Error).message.slice(0, 40)}`);
        continue;
      }
      // (Skipping pruneUngraphedCells — caused catastrophic shrink on
      // some seeds because midCells coverage isn't a complete signal.)
      const allStations = graph.nodes.filter((n) => n.kind === 'station');
      const junctions = graph.nodes.filter((n) => n.kind === 'junction');
      if (allStations.length < 2) { bump('not-enough-station-nodes'); continue; }
      // Find the LARGEST connected group of stations. With the largest-
      // component filter removed from the layout, the graph contains
      // multiple disconnected sub-graphs. We need ≥2 stations in the
      // same sub-graph for the train to be able to cycle between them.
      const stations = largestConnectedStationGroup(graph, allStations);
      if (stations.length < 2) { bump('no-connected-station-pair'); continue; }

      console.log(`wfc generator: attempt ${attempt}, internal retries ${totalRetries}, reasons:`, reasons);
      return { graph, stations, junctions, retries: totalRetries + attempt, diag: { liftedChains, constructedChains, upperDeckTiles } };
    } catch (e) {
      bump(`wfc-threw:${(e as Error).message.slice(0, 40)}`);
    }
  }
  throw new Error(
    `WFC generator: exceeded ${maxRetries} pipeline retries. reasons: ${JSON.stringify(reasons)}`,
  );
}

function parseKey(k: string): [number, number] {
  const [a, b] = k.split(',');
  return [Number(a), Number(b)];
}

/** Build a pre-seed map that forces a 7-cell multi-level bridge across
 *  the middle row of the grid. This guarantees the layout includes at
 *  least one ramp at level 0 AND one at level 1, plus a level-2 elevated
 *  section. WFC fills the rest around it. If any pre-seed variant ID
 *  doesn't exist in the table, the seed is skipped (defensive). */
function buildMultiLevelPreSeed(size: number, table: AdjacencyTable): Map<string, string> {
  const seeds = new Map<string, string>();
  if (size < 5) return seeds;
  // ANCHOR 1: a single ELEVATED at level 1 (= world Y = 2*RAMP_HEIGHT) in
  // the center of the grid. WFC's adjacency forces its E/W neighbors to
  // have ports at 2H, which cascades outward into level-1 ramps + level-0
  // elevateds connecting back to ground. Guarantees a level-2 bridge in
  // every successful roll without specifying HOW the climb gets there.
  const cx = Math.floor(size / 2);
  const cy = Math.floor(size / 2);
  const id = 'elevated-straight-ns@1+L1';
  if (table.byId.has(id)) {
    seeds.set(`${cx},${cy}`, id);
  } else {
    console.warn(`wfc pre-seed: variant id ${id} not found`);
  }
  return seeds;
}

/** Try to add a ground-level under-pass tile beneath an existing level-0
 *  ELEVATED_STRAIGHT_NS. Looks for an elevated cell whose perpendicular-
 *  axis neighbors are ground tiles with matching ports (i.e. there's an
 *  existing ground track running across, perpendicular to the bridge).
 *  When found, places a STRAIGHT_NS under-tile in the perpendicular
 *  orientation. Returns true if anything was placed. */
function tryAddUnderpass(layout: TrackLayout): boolean {
  for (const t of layout.tiles()) {
    if (t.def.kind !== 'elevated-straight-ns') continue;
    if ((t.level ?? 0) !== 0) continue;
    // Skip cells that already have an under-tile.
    if (layout.getUnder(t.gridX, t.gridZ)) continue;
    // Elevated runs N-S if rotation 0/2, E-W if rotation 1/3.
    const elevatedVertical = t.rotation === 0 || t.rotation === 2;
    // Under-pass is PERPENDICULAR to the elevated direction.
    const underRot = elevatedVertical ? 1 : 0;
    const wantW: 'W' | 'N' = elevatedVertical ? 'W' : 'N';
    const wantE: 'E' | 'S' = elevatedVertical ? 'E' : 'S';
    const dx = elevatedVertical ? 1 : 0;
    const dz = elevatedVertical ? 0 : 1;
    const west = layout.get(t.gridX - dx, t.gridZ - dz);
    const east = layout.get(t.gridX + dx, t.gridZ + dz);
    if (!west || !east) continue;
    const westPorts = effectivePorts(west);
    const eastPorts = effectivePorts(east);
    if (!westPorts.includes(wantE) || !eastPorts.includes(wantW)) continue;
    if (Math.abs(portYInLayout(west, wantE)) > 0.01) continue;
    if (Math.abs(portYInLayout(east, wantW)) > 0.01) continue;
    layout.placeUnder(t.gridX, t.gridZ, STRAIGHT_NS, underRot);
    return true;
  }
  return false;
}

// Internal helper so we don't have to plumb portY through more callers.
function portYInLayout(t: PlacedTile, p: 'N' | 'E' | 'S' | 'W'): number {
  return portY(t, p);
}

/** Find connected components via port-to-port adjacency. Keep the
 *  largest component; remove every tile in the others from the layout.
 *  This is how we ship a single-network layout from a WFC output that
 *  technically satisfies local rules but produced multiple disconnected
 *  blobs. */
/** Bridge disconnected components by upgrading boundary tiles. For
 *  every pair of cells in different components that are directly
 *  adjacent (distance 1), if both tiles have null ports on the facing
 *  sides, upgrade them so a port appears on each (STRAIGHT → TEE,
 *  CURVE → TEE, TEE → CROSS). After the upgrade the components are
 *  one. Iterates until no more pairs can be bridged.
 *
 *  Only operates on ground-level tiles (STRAIGHT_NS / CURVE_NE /
 *  TEE_NES) — elevated/ramp/station cells can't be upgraded without
 *  changing semantics, and the cell's `level` must be 0.
 *
 *  Returns true if anything changed. */
function bridgeComponents(layout: TrackLayout): boolean {
  let totalBridges = 0;
  for (let pass = 0; pass < 100; pass++) {
    const components = buildPortComponents(layout);
    if (components.length <= 1) break;
    const compOf = new Map<PlacedTile, number>();
    for (let i = 0; i < components.length; i++) {
      for (const t of components[i]!) compOf.set(t, i);
    }
    let bridged = false;
    // --- Distance-1: cells directly adjacent in different components,
    //     both with null facing ports → upgrade both. ---
    outer1: for (let i = 0; i < components.length && !bridged; i++) {
      for (const tileA of components[i]!) {
        if ((tileA.level ?? 0) !== 0) continue;
        for (const port of DIRECTIONS) {
          if (effectivePorts(tileA).includes(port)) continue;
          const [dx, dz] = dirVector(port);
          const nx = tileA.gridX + dx;
          const nz = tileA.gridZ + dz;
          const tileB = layout.get(nx, nz);
          if (!tileB || (tileB.level ?? 0) !== 0) continue;
          if (compOf.get(tileB) === i) continue;
          if (effectivePorts(tileB).includes(opposite(port))) continue;
          const upA = upgradeAddPort(tileA, port);
          const upB = upgradeAddPort(tileB, opposite(port));
          if (!upA || !upB) continue;
          layout.remove(tileA.gridX, tileA.gridZ);
          layout.place(tileA.gridX, tileA.gridZ, upA.def, upA.rotation);
          layout.remove(tileB.gridX, tileB.gridZ);
          layout.place(tileB.gridX, tileB.gridZ, upB.def, upB.rotation);
          totalBridges++;
          bridged = true;
          break outer1;
        }
      }
    }
    if (!bridged) break;
  }
  return totalBridges > 0;
}

/** Connected components by port adjacency at ground level. Returns
 *  arrays of tiles, one per component. */
function buildPortComponents(layout: TrackLayout): PlacedTile[][] {
  const tiles = layout.tiles();
  const unvisited = new Set<PlacedTile>(tiles);
  const components: PlacedTile[][] = [];
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as PlacedTile;
    unvisited.delete(start);
    const queue: PlacedTile[] = [start];
    const component: PlacedTile[] = [start];
    while (queue.length > 0) {
      const t = queue.pop()!;
      for (const p of effectivePorts(t)) {
        const [dx, dz] = dirVector(p);
        const yHere = portYInLayout(t, p);
        const wantOpp = opposite(p);
        const primary = layout.get(t.gridX + dx, t.gridZ + dz);
        const under = layout.getUnder(t.gridX + dx, t.gridZ + dz);
        for (const cand of [primary, under]) {
          if (!cand || !unvisited.has(cand)) continue;
          const candPorts = effectivePorts(cand);
          if (!candPorts.includes(wantOpp)) continue;
          if (Math.abs(portYInLayout(cand, wantOpp) - yHere) > 0.01) continue;
          unvisited.delete(cand);
          component.push(cand);
          queue.push(cand);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Find an upgrade-replacement tile that has all of `tile`'s current
 *  effective ports PLUS `addPort`. Only handles ground-level
 *  STRAIGHT_NS / CURVE_NE / TEE_NES. Returns null otherwise. */
function upgradeAddPort(
  tile: PlacedTile,
  addPort: Direction,
): { def: TrackTileDef; rotation: Rotation } | null {
  if ((tile.level ?? 0) !== 0) return null;
  const currentPorts = effectivePorts(tile);
  if (currentPorts.includes(addPort)) return { def: tile.def, rotation: tile.rotation };
  if (tile.def.kind !== 'straight-ns' && tile.def.kind !== 'curve-ne' && tile.def.kind !== 'tee-nes') return null;
  const required = new Set<Direction>([...currentPorts, addPort]);
  if (required.size === 3) {
    for (let r = 0; r < 4; r++) {
      const teePorts = effectivePorts({ gridX: 0, gridZ: 0, def: TEE_NES, rotation: r as Rotation });
      if (teePorts.length === 3 && teePorts.every((p) => required.has(p))) {
        return { def: TEE_NES, rotation: r as Rotation };
      }
    }
  } else if (required.size === 4) {
    return { def: CROSS_NESW, rotation: 0 };
  }
  return null;
}

/** Pick up to `maxCount` station cells with at-least-one per physical
 *  Y level present in the layout. A station-eligible cell is a 2-port
 *  straight tile that isn't already claimed:
 *   - `straight-ns` at any level → ports at level*H
 *   - `elevated-straight-ns` at any level → ports at (level+1)*H
 *  Cells are grouped by their port Y. One pick per Y level (shuffled
 *  within the group), then the remainder fills from any leftover
 *  candidates pooled together. */
function pickStationCells(
  tiles: ReadonlyArray<PlacedTile>,
  claimedCells: Set<string>,
  layout: TrackLayout,
  rng: () => number,
  maxCount: number,
  requiredYLevels?: ReadonlyArray<number>,
): PlacedTile[] | null {
  const candidates = tiles.filter((t) =>
    (t.def.kind === 'straight-ns' || t.def.kind === 'elevated-straight-ns')
    && !claimedCells.has(`${t.gridX},${t.gridZ}`)
    && layout.get(t.gridX, t.gridZ) === t,
  );
  // Group by port Y. straight-ns has Y = level*H; elevated-straight has
  // Y = (level+1)*H.
  const byY = new Map<number, PlacedTile[]>();
  for (const t of candidates) {
    const lvl = t.level ?? 0;
    const y = t.def.kind === 'elevated-straight-ns'
      ? (lvl + 1)
      : lvl;
    const key = y; // integer multiples of H
    if (!byY.has(key)) byY.set(key, []);
    byY.get(key)!.push(t);
  }
  // Shuffle each group's order so the picked cell within a level varies
  // between rolls (rng-deterministic).
  for (const arr of byY.values()) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j]!, arr[i]!];
    }
  }
  // Required-levels gate: if the caller demanded a station at each Y
  // level in `requiredYLevels`, every one of those levels MUST have a
  // candidate. If any is missing we return null so the pipeline can
  // retry the WFC solve instead of producing a layout the user
  // explicitly asked to avoid.
  if (requiredYLevels) {
    for (const y of requiredYLevels) {
      if (!byY.has(y) || byY.get(y)!.length === 0) return null;
    }
  }
  const picked: PlacedTile[] = [];
  // First pass: one per Y level (lowest level first so ground always
  // gets a station before upper decks). Required levels take priority
  // over opportunistic ones if maxCount is tight.
  const required = new Set(requiredYLevels ?? []);
  const levelsByPriority = [...byY.keys()].sort((a, b) => {
    const aReq = required.has(a) ? 0 : 1;
    const bReq = required.has(b) ? 0 : 1;
    if (aReq !== bReq) return aReq - bReq;
    return a - b;
  });
  for (const lvl of levelsByPriority) {
    if (picked.length >= maxCount) break;
    const group = byY.get(lvl)!;
    const choice = group.shift();
    if (choice) picked.push(choice);
  }
  // Second pass: fill remaining slots from the pooled leftovers,
  // shuffled together.
  const leftovers: PlacedTile[] = [];
  for (const arr of byY.values()) leftovers.push(...arr);
  for (let i = leftovers.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [leftovers[i], leftovers[j]] = [leftovers[j]!, leftovers[i]!];
  }
  for (const t of leftovers) {
    if (picked.length >= maxCount) break;
    picked.push(t);
  }
  return picked;
}

/** Find every ▲ peak (two ramps meeting at their HIGH ports with no
 *  flat tile between) and replace BOTH ramp cells with STRAIGHT_NS at
 *  the ramp's low level. The neighbours beyond each ramp expected the
 *  LOW Y already, so the new flat tile matches — no trim cascade.
 *  Skips peaks where the two ramps have different low Ys (mixed
 *  ramp-ns + ramp-ns-tall pairs at different levels). */
function flattenRampPeaks(layout: TrackLayout): void {
  const isRamp = (t: PlacedTile) => t.def.kind === 'ramp-ns' || t.def.kind === 'ramp-ns-tall';
  const peakY = (t: PlacedTile): number => {
    let max = -Infinity;
    for (const p of effectivePorts(t)) {
      const y = portY(t, p);
      if (y > max) max = y;
    }
    return max;
  };
  const sideAtPeak = (t: PlacedTile, port: Direction): boolean => {
    if (!effectivePorts(t).includes(port)) return false;
    const peak = peakY(t);
    return Math.abs(portY(t, port) - peak) < 1e-3;
  };
  // Collect peak pairs first; mutating during iteration would invalidate
  // tile references mid-loop.
  const pairs: Array<{ a: PlacedTile; b: PlacedTile }> = [];
  const seen = new Set<string>();
  for (const tile of layout.tiles()) {
    if (!isRamp(tile)) continue;
    if (layout.get(tile.gridX, tile.gridZ) !== tile) continue;
    for (const port of effectivePorts(tile)) {
      if (!sideAtPeak(tile, port)) continue;
      const [dx, dz] = dirVector(port);
      const nb = layout.get(tile.gridX + dx, tile.gridZ + dz);
      if (!nb || !isRamp(nb)) continue;
      if (!sideAtPeak(nb, opposite(port))) continue;
      const aKey = `${tile.gridX},${tile.gridZ}`;
      const bKey = `${nb.gridX},${nb.gridZ}`;
      const pairKey = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);
      pairs.push({ a: tile, b: nb });
    }
  }
  for (const { a, b } of pairs) {
    // Both ramp kinds have low Y = level * RAMP_HEIGHT. The flat
    // STRAIGHT_NS at level=k also has ports at k*H, so cells beyond
    // (which expected the LOW Y) still match. Skip if the two ramps
    // disagree on level — mixed kind/level pairs would create a
    // mismatch at the shared boundary after flattening.
    const aLevel = a.level ?? 0;
    const bLevel = b.level ?? 0;
    if (aLevel !== bLevel) continue;
    const axisRot = (rotation: number): Rotation =>
      (rotation % 2 === 1 ? 1 : 0) as Rotation;
    layout.remove(a.gridX, a.gridZ);
    layout.place(a.gridX, a.gridZ, STRAIGHT_NS, axisRot(a.rotation), undefined, aLevel);
    layout.remove(b.gridX, b.gridZ);
    layout.place(b.gridX, b.gridZ, STRAIGHT_NS, axisRot(b.rotation), undefined, bLevel);
  }
}

/** Pass 2 of the stratified generator. Find runs of 3+ consecutive
 *  same-axis 2-port straights at a base level and rewrite the WHOLE
 *  chain as a Y=2H sky bridge: [ramp-up, elev@L=1, ..., elev@L=1, ramp-down].
 *  Ramps' OUTER ports stay at the source's base Y so adjacency with the
 *  surrounding layout still holds. The N-2 middle cells become
 *  elev-straight@L=1 (each adds Y=2H coverage). All new ports matched by
 *  construction; no trim cascade needed.
 *
 *  Run for both chain kinds:
 *    - GROUND straight-ns@L=0  →  ramp-ns-tall@L=0 ends (lifts 0 → 2H)
 *    - ELEVATED-straight-ns@L=0 →  ramp-ns@L=1 ends   (lifts H → 2H)
 *  Ground chains are far more common (weight 4 vs 3), so doing both gets
 *  way more Y=2H per layout than the elevated-only version did.
 *
 *  Vertical chain (rotation 0/2, +z southward), N cells, generic shape:
 *    z0       RAMP rot 0 at `rampLevel`  (climbs S)
 *    z1..N-2  ELEVATED_STRAIGHT_NS@L=1   (Y=2H both sides)
 *    z(N-1)   RAMP rot 2 at `rampLevel`  (descends S)
 *  Horizontal (rotation 1/3, +x east): same with W↔E, rot 1 climbs, rot 3 descends. */
function liftElevatedToL2(layout: TrackLayout, rng: () => number): number {
  let lifted = 0;
  // Elevated chains: end-ramps are RAMP_NS@L=1 (low=H, high=2H).
  lifted += liftStraightChain(layout, rng, 'elevated-straight-ns', RAMP_NS, 1);
  // Ground chains: end-ramps are RAMP_NS_TALL@L=0 (low=0, high=2H).
  lifted += liftStraightChain(layout, rng, 'straight-ns', RAMP_NS_TALL, 0);
  // Existing Y=H bridges: [ramp-ns@L=0 climbing, elev@L=0 (1+), ramp-ns@L=0
  // descending] — convert the whole shape to a Y=2H bridge by swapping
  // both end ramps to RAMP_NS_TALL@L=0 and middle elev cells to L=1.
  lifted += liftYHBridge(layout, rng);
  return lifted;
}

/** Find existing [ramp-up @L=0, 1+ elev-straight @L=0, ramp-down @L=0]
 *  bridges that climb to Y=H and back down, and replace them with
 *  [ramp-tall up, elev-straight @L=1, ramp-tall down] bridges going to
 *  Y=2H. Outer Y=0 ports unchanged; net effect is the entire bridge body
 *  rises one floor. */
function liftYHBridge(layout: TrackLayout, rng: () => number): number {
  type Cfg = {
    dx: number; dz: number;
    climbRampRot: Rotation;   // ramp@L=0 with HIGH port pointing +axis
    descRampRot: Rotation;    // ramp@L=0 with HIGH port pointing -axis
    elevRots: Set<Rotation>;  // elev-straight rotations matching this axis
    elevRotForLift: Rotation; // rotation we place on the lifted elev cells
  };
  const cfgs: Cfg[] = [
    // Vertical (chain extends +z = south). ramp rot 0: S=high. ramp rot 2: N=high.
    { dx: 0, dz: 1, climbRampRot: 0, descRampRot: 2, elevRots: new Set<Rotation>([0, 2]), elevRotForLift: 0 },
    // Horizontal (chain extends +x = east). ramp rot 1: E=high. ramp rot 3: W=high.
    { dx: 1, dz: 0, climbRampRot: 1, descRampRot: 3, elevRots: new Set<Rotation>([1, 3]), elevRotForLift: 1 },
  ];
  const isFlatElev = (t: PlacedTile, rots: ReadonlySet<Rotation>): boolean =>
    t.def.kind === 'elevated-straight-ns'
    && (t.level ?? 0) === 0
    && rots.has(t.rotation)
    && !layout.getUnder(t.gridX, t.gridZ);
  const isFlatRamp = (t: PlacedTile, rot: Rotation): boolean =>
    t.def.kind === 'ramp-ns'
    && (t.level ?? 0) === 0
    && t.rotation === rot
    && !layout.getUnder(t.gridX, t.gridZ);
  const chains: { cells: PlacedTile[]; cfg: Cfg }[] = [];
  const claimed = new Set<PlacedTile>();
  for (const cfg of cfgs) {
    for (const head of layout.tiles()) {
      if (claimed.has(head)) continue;
      if (!isFlatRamp(head, cfg.climbRampRot)) continue;
      // Walk forward through elev-straight cells until we hit a descending ramp.
      const cells: PlacedTile[] = [head];
      let cur = head;
      let endRamp: PlacedTile | null = null;
      for (;;) {
        const next = layout.get(cur.gridX + cfg.dx, cur.gridZ + cfg.dz);
        if (!next || claimed.has(next)) break;
        if (isFlatRamp(next, cfg.descRampRot)) {
          endRamp = next;
          cells.push(next);
          break;
        }
        if (!isFlatElev(next, cfg.elevRots)) break;
        cells.push(next);
        cur = next;
      }
      if (!endRamp) continue;
      if (cells.length < 3) continue; // [ramp, ramp] peak — skip
      chains.push({ cells, cfg });
      for (const c of cells) claimed.add(c);
    }
  }
  if (chains.length === 0) return 0;
  for (let i = chains.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chains[i], chains[j]] = [chains[j]!, chains[i]!];
  }
  let lifted = 0;
  for (const { cells, cfg } of chains) {
    if (cells.some((c) => layout.get(c.gridX, c.gridZ) !== c)) continue;
    const head = cells[0]!;
    const tail = cells[cells.length - 1]!;
    layout.remove(head.gridX, head.gridZ);
    layout.place(head.gridX, head.gridZ, RAMP_NS_TALL, cfg.climbRampRot, undefined, 0);
    for (let i = 1; i < cells.length - 1; i++) {
      const c = cells[i]!;
      layout.remove(c.gridX, c.gridZ);
      layout.place(c.gridX, c.gridZ, ELEVATED_STRAIGHT_NS, cfg.elevRotForLift, undefined, 1);
    }
    layout.remove(tail.gridX, tail.gridZ);
    layout.place(tail.gridX, tail.gridZ, RAMP_NS_TALL, cfg.descRampRot, undefined, 0);
    lifted++;
  }
  return lifted;
}

/** Pass 3 — opportunistic Y=2H bridge construction in EMPTY 3+ cell
 *  strips. Scans the grid for axis-aligned empty pockets and constructs
 *  a Y=0 → Y=2H bridge over them by upgrading the boundary cells
 *  (STRAIGHT → TEE etc.) to expose a new Y=0 port facing into the
 *  pocket, then dropping the bridge tiles. After trim, no remaining
 *  cell has a port facing into empty space, so we have to GROW the
 *  endpoint ports — that's what `upgradeAddPort` (used by
 *  bridgeComponents) does.
 *
 *  Side cells of the pocket already have no port facing in (trim
 *  guarantees it), so the new chain-axis-only ramp/elev tiles don't
 *  orphan anything perpendicular. Net result: extra Y=2H bridges in
 *  layouts that previously had only Y=H content. */
/** Pass 4 — upper-deck overlay. Runs a SECOND WFC over the same grid
 *  with a restricted variant pool biased toward Y=2H content:
 *    - elev-straight/curve/tee @L=1 (deck content at Y=2H)
 *    - ramp@L=1 (Y=H ↔ Y=2H transition, "drop down" to existing Y=H deck)
 *    - ramp-ns-tall@L=0 (Y=0 ↔ Y=2H, "drop down" to ground)
 *    - elev-straight/curve/tee @L=0 (Y=H — the "drop down" pieces the
 *      user explicitly asked for)
 *    - EMPTY (gaps so the deck doesn't have to cover everything)
 *  This pass IGNORES Pass 1's tiles — it solves independently. After it
 *  solves, every non-EMPTY result tile is stacked into the layout: in
 *  the primary slot if Pass 1 left the cell empty, otherwise in the
 *  under-slot (which is normally used for under-passes but works as a
 *  generic "second tile" stack). Cells where BOTH slots are already
 *  used (existing under-pass) skip the deck tile. Returns the count of
 *  deck tiles actually merged. */
function generateUpperDeckOverlay(
  layout: TrackLayout,
  rng: () => number,
  size: number,
): number {
  // Build the restricted variant pool. Reuse the existing
  // enumerateVariants(1) output and filter; weights crank L=1 elev so
  // WFC actually picks them.
  const fullVariants = enumerateVariants(1);
  const filtered = fullVariants.filter((v) => {
    if (v.def.kind === 'elevated-straight-ns') return true; // L=0 (drop) or L=1 (deck)
    if (v.def.kind === 'elevated-curve-ne') return true;
    if (v.def.kind === 'elevated-tee-nes') return true;
    if (v.def.kind === 'ramp-ns' && v.level === 1) return true; // H↔2H
    // ramp-ns-tall excluded — its Y=0 low port z-fights with Pass 1's
    // ground tiles in the same cell when Pass 4 stacks into the under-slot.
    if (v.def.kind === 'empty') return true;
    return false;
  });
  // EMPTY is excluded from the main enumerateVariants pool, but the
  // upper deck needs it so cells can stay blank. Re-add manually.
  const emptyVariant: Variant = {
    id: 'empty@deck',
    def: EMPTY_TILE,
    rotation: 0,
    level: 0,
    weight: 2.0, // low — leaves a few gaps but mostly filled
    ports: [],
    portY: { N: null, E: null, S: null, W: null },
  };
  const variants = [...filtered.filter((v) => v.def.kind !== 'empty'), emptyVariant];
  // Push L=1 elev variants way up so the deck actually fills with Y=2H
  // content. Drop-downs (L=0 elev) are less weighted so they only show
  // up as transitional sections.
  for (const v of variants) {
    if (v.id === 'empty@deck') continue;
    if (v.def.kind === 'elevated-straight-ns') {
      (v as { weight: number }).weight = v.level === 1 ? 8.0 : 1.5;
    } else if (v.def.kind === 'elevated-curve-ne') {
      (v as { weight: number }).weight = v.level === 1 ? 4.0 : 1.0;
    } else if (v.def.kind === 'elevated-tee-nes') {
      (v as { weight: number }).weight = v.level === 1 ? 1.0 : 0.3;
    } else if (v.def.kind === 'ramp-ns') {
      (v as { weight: number }).weight = 0.6; // moderate transition
    }
  }
  const table = buildAdjacencyTable(variants);
  let wfc;
  try {
    wfc = solveWFC(table, { width: size, height: size, rng, maxRetries: 30 });
  } catch {
    return 0;
  }
  const half = Math.floor(size / 2);
  let merged = 0;
  for (const [k, id] of wfc.cells) {
    const v = table.byId.get(id);
    if (!v) continue;
    if (v.def.kind === 'empty') continue;
    const [x, y] = k.split(',').map(Number);
    const gx = (x ?? 0) - half;
    const gz = (y ?? 0) - half;
    const primary = layout.get(gx, gz);
    // Skip cells where Pass 1's primary already has ports at the SAME
    // Y level the deck tile would occupy — otherwise the renderer
    // draws two perpendicular strips through the same cell at the same
    // height and you see overlap instead of a clean intersection.
    if (primary) {
      const exYs = new Set<number>();
      for (const p of effectivePorts(primary)) exYs.add(Math.round(portY(primary, p) * 10));
      let conflict = false;
      for (const p of v.ports) {
        const py = v.portY[p];
        if (!py) continue;
        for (const yy of py) if (exYs.has(Math.round(yy * 10))) { conflict = true; break; }
        if (conflict) break;
      }
      if (conflict) continue;
    }
    // Decor slot — purely visual, invisible to the graph extractor.
    // Tried promoting to primary/under for real train traversal of the
    // upper deck (multi-layer graph), but bridge ramps reliably failed
    // to produce cross-deck edges in practice — Pass 4's deck didn't
    // extend past bridge cells in the directions traces needed. Visual
    // upper deck is the honest scope; train routing stays on Pass 1.
    layout.placeDecor(gx, gz, v.def, v.rotation, undefined, v.level);
    merged++;
  }
  return merged;
}

/** Post-Pass-4 connector. Wherever a Pass-1 elev-straight@L=0 cell has
 *  an axis-aligned neighbour whose Pass-4 decor is elev-straight@L=1
 *  (same rotation, so the ports align on the chain axis), swap that
 *  decor tile for a ramp@L=1 oriented to descend toward Pass 1. Result:
 *  visible ramps connecting the ground network's Y=H content up to the
 *  upper deck's Y=2H content.
 *
 *  Y math: ramp-ns@L=1 rotation 0 has N=Y=H, S=Y=2H. Pass 1's elev-straight
 *  at the north of the swap cell has S port Y=H — matches. Pass 4's
 *  continuing deck cell to the south has N port Y=2H — matches. Both
 *  ends connect cleanly. The other 3 rotations cover the 3 other axis
 *  directions. Each swap is tracked so a single decor cell isn't
 *  replaced twice. */
function bridgeDeckToGround(layout: TrackLayout): number {
  type Cfg = { dx: number; dz: number; elevRot: Rotation; rampRot: Rotation };
  // For each direction Pass 1 → Pass 4, the rotation that produces a
  // ramp climbing FROM Pass 1 (low side) TO Pass 4 (high side).
  // Direction +z (south): ramp rot 0 (N low, S high). Pass 1 is north.
  // Direction -z (north): ramp rot 2 (N high, S low). Pass 1 is south.
  // Direction +x (east):  ramp rot 1 (W low, E high). Pass 1 is west.
  // Direction -x (west):  ramp rot 3 (W high, E low). Pass 1 is east.
  const cfgs: Cfg[] = [
    { dx: 0, dz: 1, elevRot: 0, rampRot: 0 },
    { dx: 0, dz: -1, elevRot: 0, rampRot: 2 },
    { dx: 1, dz: 0, elevRot: 1, rampRot: 1 },
    { dx: -1, dz: 0, elevRot: 1, rampRot: 3 },
  ];
  const swapped = new Set<string>();
  let bridges = 0;
  for (const t of layout.tiles()) {
    if (layout.get(t.gridX, t.gridZ) !== t) continue; // primary only
    if (t.def.kind !== 'elevated-straight-ns') continue;
    if ((t.level ?? 0) !== 0) continue;
    for (const cfg of cfgs) {
      if (t.rotation !== cfg.elevRot && t.rotation !== ((cfg.elevRot + 2) % 4) as Rotation) continue;
      const nx = t.gridX + cfg.dx;
      const nz = t.gridZ + cfg.dz;
      const cellKey = `${nx},${nz}`;
      if (swapped.has(cellKey)) continue;
      // Pass 4 lives in decor — look there for a matching deck tile.
      const decor = layout.getDecorAt(nx, nz);
      const target = decor.find((d) =>
        d.def.kind === 'elevated-straight-ns'
        && (d.level ?? 0) === 1
        && d.rotation === cfg.elevRot,
      );
      if (!target) continue;
      layout.removeDecorAt(nx, nz);
      layout.placeDecor(nx, nz, RAMP_NS, cfg.rampRot, undefined, 1);
      swapped.add(cellKey);
      bridges++;
    }
  }
  return bridges;
}

function constructL2EmptyStrips(
  layout: TrackLayout,
  rng: () => number,
  size: number,
): number {
  const half = Math.floor(size / 2);
  const lo = -half;
  const hi = half;
  type Cfg = {
    dx: number; dz: number;
    rampUpRot: Rotation; rampDownRot: Rotation; elevRot: Rotation;
    // The port (on each boundary tile) that must point INTO the strip.
    // headBoundary is at (x-dx, z-dz); the port it needs is `headBoundaryAddPort`.
    headBoundaryAddPort: Direction;
    tailBoundaryAddPort: Direction;
  };
  const cfgs: Cfg[] = [
    // Vertical strip (x, z..z+2): head boundary is (x, z-1), it needs a S port at Y=0.
    { dx: 0, dz: 1, rampUpRot: 0, rampDownRot: 2, elevRot: 0,
      headBoundaryAddPort: 'S', tailBoundaryAddPort: 'N' },
    // Horizontal strip (x..x+2, z): head boundary is (x-1, z), needs E port at Y=0.
    { dx: 1, dz: 0, rampUpRot: 1, rampDownRot: 3, elevRot: 1,
      headBoundaryAddPort: 'E', tailBoundaryAddPort: 'W' },
  ];
  const cellEmpty = (x: number, z: number): boolean =>
    !layout.get(x, z) && !layout.getUnder(x, z);
  // Find every candidate strip — any 3-cell empty run with upgradeable
  // ground tiles at both ends.
  const candidates: { x: number; z: number; cfg: Cfg;
    headBoundary: PlacedTile; tailBoundary: PlacedTile;
    headUpgrade: { def: TrackTileDef; rotation: Rotation };
    tailUpgrade: { def: TrackTileDef; rotation: Rotation };
  }[] = [];
  for (const cfg of cfgs) {
    for (let z = lo; z <= hi; z++) {
      for (let x = lo; x <= hi; x++) {
        const tailX = x + 2 * cfg.dx;
        const tailZ = z + 2 * cfg.dz;
        if (tailX > hi || tailZ > hi) continue;
        // All 3 strip cells empty.
        let allEmpty = true;
        for (let i = 0; i < 3; i++) {
          if (!cellEmpty(x + i * cfg.dx, z + i * cfg.dz)) { allEmpty = false; break; }
        }
        if (!allEmpty) continue;
        // Boundary cells exist and are upgradeable ground tiles.
        const headBoundary = layout.get(x - cfg.dx, z - cfg.dz);
        const tailBoundary = layout.get(tailX + cfg.dx, tailZ + cfg.dz);
        if (!headBoundary || !tailBoundary) continue;
        if ((headBoundary.level ?? 0) !== 0 || (tailBoundary.level ?? 0) !== 0) continue;
        // Skip cells with stacked unders (under-pass / overpass) — too
        // tricky to upgrade without losing the under layer.
        if (layout.getUnder(headBoundary.gridX, headBoundary.gridZ)) continue;
        if (layout.getUnder(tailBoundary.gridX, tailBoundary.gridZ)) continue;
        const headUpgrade = upgradeAddPort(headBoundary, cfg.headBoundaryAddPort);
        const tailUpgrade = upgradeAddPort(tailBoundary, cfg.tailBoundaryAddPort);
        if (!headUpgrade || !tailUpgrade) continue;
        candidates.push({ x, z, cfg, headBoundary, tailBoundary, headUpgrade, tailUpgrade });
      }
    }
  }
  if (candidates.length === 0) return 0;
  // Shuffle and pick non-overlapping strips greedily (also skip if a
  // boundary cell was already upgraded by a sibling strip).
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [candidates[i], candidates[j]] = [candidates[j]!, candidates[i]!];
  }
  const claimedCells = new Set<string>();
  let placed = 0;
  for (const c of candidates) {
    const { x, z, cfg, headBoundary, tailBoundary, headUpgrade, tailUpgrade } = c;
    const stripKeys: string[] = [];
    let overlap = false;
    for (let i = 0; i < 3; i++) {
      const k = `${x + i * cfg.dx},${z + i * cfg.dz}`;
      if (claimedCells.has(k)) { overlap = true; break; }
      stripKeys.push(k);
    }
    const headKey = `${headBoundary.gridX},${headBoundary.gridZ}`;
    const tailKey = `${tailBoundary.gridX},${tailBoundary.gridZ}`;
    if (overlap || claimedCells.has(headKey) || claimedCells.has(tailKey)) continue;
    // Re-verify the cells haven't changed.
    let stillEmpty = true;
    for (let i = 0; i < 3; i++) {
      if (!cellEmpty(x + i * cfg.dx, z + i * cfg.dz)) { stillEmpty = false; break; }
    }
    if (!stillEmpty) continue;
    if (layout.get(headBoundary.gridX, headBoundary.gridZ) !== headBoundary) continue;
    if (layout.get(tailBoundary.gridX, tailBoundary.gridZ) !== tailBoundary) continue;
    // Upgrade boundaries to expose the new port facing the strip.
    layout.remove(headBoundary.gridX, headBoundary.gridZ);
    layout.place(headBoundary.gridX, headBoundary.gridZ, headUpgrade.def, headUpgrade.rotation, undefined, 0);
    layout.remove(tailBoundary.gridX, tailBoundary.gridZ);
    layout.place(tailBoundary.gridX, tailBoundary.gridZ, tailUpgrade.def, tailUpgrade.rotation, undefined, 0);
    // Drop the bridge.
    layout.place(x, z, RAMP_NS_TALL, cfg.rampUpRot, undefined, 0);
    layout.place(x + cfg.dx, z + cfg.dz, ELEVATED_STRAIGHT_NS, cfg.elevRot, undefined, 1);
    layout.place(x + 2 * cfg.dx, z + 2 * cfg.dz, RAMP_NS_TALL, cfg.rampDownRot, undefined, 0);
    for (const k of stripKeys) claimedCells.add(k);
    claimedCells.add(headKey);
    claimedCells.add(tailKey);
    placed++;
  }
  return placed;
}

function liftStraightChain(
  layout: TrackLayout,
  rng: () => number,
  sourceKind: 'straight-ns' | 'elevated-straight-ns',
  rampDef: TrackTileDef,
  rampLevel: number,
): number {
  type ChainAxis = { dx: number; dz: number; targetRot: Set<Rotation>; rampUpRot: Rotation; rampDownRot: Rotation; elevRot: Rotation };
  const axes: ChainAxis[] = [
    { dx: 0, dz: 1, targetRot: new Set<Rotation>([0, 2]), rampUpRot: 0, rampDownRot: 2, elevRot: 0 },
    { dx: 1, dz: 0, targetRot: new Set<Rotation>([1, 3]), rampUpRot: 1, rampDownRot: 3, elevRot: 1 },
  ];
  const eligible = (t: PlacedTile, targetRot: ReadonlySet<Rotation>): boolean => {
    if (t.def.kind !== sourceKind) return false;
    if ((t.level ?? 0) !== 0) return false;
    if (!targetRot.has(t.rotation)) return false;
    if (layout.getUnder(t.gridX, t.gridZ)) return false;
    return true;
  };
  const chains: { cells: PlacedTile[]; axis: ChainAxis }[] = [];
  for (const axis of axes) {
    const visited = new Set<PlacedTile>();
    for (const start of layout.tiles()) {
      if (visited.has(start)) continue;
      if (!eligible(start, axis.targetRot)) continue;
      const prev = layout.get(start.gridX - axis.dx, start.gridZ - axis.dz);
      if (prev && eligible(prev, axis.targetRot)) continue;
      const cells: PlacedTile[] = [start];
      visited.add(start);
      let cur = start;
      for (;;) {
        const next = layout.get(cur.gridX + axis.dx, cur.gridZ + axis.dz);
        if (!next || visited.has(next)) break;
        if (!eligible(next, axis.targetRot)) break;
        cells.push(next);
        visited.add(next);
        cur = next;
      }
      if (cells.length >= 3) chains.push({ cells, axis });
    }
  }
  if (chains.length === 0) return 0;
  for (let i = chains.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [chains[i], chains[j]] = [chains[j]!, chains[i]!];
  }
  let lifted = 0;
  for (const { cells, axis } of chains) {
    if (cells.some((c) => layout.get(c.gridX, c.gridZ) !== c)) continue;
    const head = cells[0]!;
    const tail = cells[cells.length - 1]!;
    layout.remove(head.gridX, head.gridZ);
    layout.place(head.gridX, head.gridZ, rampDef, axis.rampUpRot, undefined, rampLevel);
    for (let i = 1; i < cells.length - 1; i++) {
      const c = cells[i]!;
      layout.remove(c.gridX, c.gridZ);
      layout.place(c.gridX, c.gridZ, ELEVATED_STRAIGHT_NS, axis.elevRot, undefined, 1);
    }
    layout.remove(tail.gridX, tail.gridZ);
    layout.place(tail.gridX, tail.gridZ, rampDef, axis.rampDownRot, undefined, rampLevel);
    lifted++;
  }
  return lifted;
}

/** Detect elevated chains (primary ELEVATED tiles) that no ramp can
 *  reach and strip their primary so the cell falls back to its under-
 *  tile (or empty if no under). BFS at Y=H starting from every ramp's
 *  high-port-side neighbour; any primary-elevated cell not reachable
 *  is a floating, unreachable upper deck. */
function stripUnreachableUpperDecks(layout: TrackLayout): boolean {
  const reachable = new Set<string>();
  const queue: Array<[number, number]> = [];
  // Seed: each ramp's high-port-side neighbour (Y=H entry).
  for (const tile of layout.tiles()) {
    if (tile.def.kind !== 'ramp-ns') continue;
    if (layout.get(tile.gridX, tile.gridZ) !== tile) continue; // primary only
    for (const p of effectivePorts(tile)) {
      if (Math.abs(portYInLayout(tile, p) - RAMP_HEIGHT) > 0.01) continue;
      const [dx, dz] = dirVector(p);
      const nx = tile.gridX + dx;
      const nz = tile.gridZ + dz;
      const key = `${nx},${nz}`;
      if (reachable.has(key)) continue;
      reachable.add(key);
      queue.push([nx, nz]);
    }
  }
  // BFS along Y=H ports.
  while (queue.length > 0) {
    const [cx, cz] = queue.shift()!;
    const primary = layout.get(cx, cz);
    if (!primary) continue;
    for (const p of effectivePorts(primary)) {
      if (Math.abs(portYInLayout(primary, p) - RAMP_HEIGHT) > 0.01) continue;
      const [dx, dz] = dirVector(p);
      const nx = cx + dx;
      const nz = cz + dz;
      const key = `${nx},${nz}`;
      if (reachable.has(key)) continue;
      const neighbor = layout.get(nx, nz);
      if (!neighbor) continue;
      const want = opposite(p);
      const nPorts = effectivePorts(neighbor);
      if (!nPorts.includes(want)) continue;
      if (Math.abs(portYInLayout(neighbor, want) - RAMP_HEIGHT) > 0.01) continue;
      reachable.add(key);
      queue.push([nx, nz]);
    }
  }
  // Strip primary ELEVATED tiles outside `reachable`.
  let changed = false;
  const snapshot = [...layout.tiles()];
  for (const t of snapshot) {
    if (layout.get(t.gridX, t.gridZ) !== t) continue;
    if (t.def.kind !== 'elevated-straight-ns' && t.def.kind !== 'elevated-curve-ne') continue;
    const key = `${t.gridX},${t.gridZ}`;
    if (reachable.has(key)) continue;
    const under = layout.getUnder(t.gridX, t.gridZ);
    layout.remove(t.gridX, t.gridZ);
    if (under) layout.place(t.gridX, t.gridZ, under.def, under.rotation, under.routing, under.level);
    changed = true;
  }
  return changed;
}

/** Iteratively remove tiles whose ports don't all connect to a
 *  neighbour at matching Y. STATION_N tiles (1-port intentional
 *  dead-end) are exempt. After a tile is removed, neighbours that
 *  pointed INTO it become new dead-ends and are re-evaluated on the
 *  next pass — propagates inward until the layout stabilises with no
 *  tendrils. */
function trimDeadEnds(layout: TrackLayout): void {
  for (let pass = 0; pass < 100; pass++) {
    const toRemove: PlacedTile[] = [];
    for (const tile of layout.tiles()) {
      // Stations are intentional dead-ends.
      if (tile.def.kind === 'station-n') continue;
      const isPrimary = layout.get(tile.gridX, tile.gridZ) === tile;
      const ports = effectivePorts(tile);
      for (const port of ports) {
        const [dx, dz] = dirVector(port);
        const nx = tile.gridX + dx;
        const nz = tile.gridZ + dz;
        const wantY = portYInLayout(tile, port);
        const wantOpp = opposite(port);
        // Look for ANY tile in the neighbour cell whose `wantOpp` port
        // sits at `wantY`. If none, this port is a dead-end.
        const primary = layout.get(nx, nz);
        const under = layout.getUnder(nx, nz);
        const matches = (cand: PlacedTile | undefined): boolean => {
          if (!cand) return false;
          const candPorts = effectivePorts(cand);
          if (!candPorts.includes(wantOpp)) return false;
          return Math.abs(portYInLayout(cand, wantOpp) - wantY) < 0.01;
        };
        if (!matches(primary) && !matches(under)) {
          toRemove.push(tile);
          break;
        }
      }
      void isPrimary;
    }
    if (toRemove.length === 0) return;
    for (const t of toRemove) {
      const primary = layout.get(t.gridX, t.gridZ);
      const under = layout.getUnder(t.gridX, t.gridZ);
      if (primary === t) {
        // If under exists and is keepable, stash + restore so we don't
        // wipe the under-tile together with the primary.
        if (under) {
          const stash = under;
          layout.remove(t.gridX, t.gridZ);
          layout.placeUnder(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
        } else {
          layout.remove(t.gridX, t.gridZ);
        }
      } else if (under === t) {
        if (primary) {
          const stash = primary;
          layout.remove(t.gridX, t.gridZ);
          layout.place(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
        } else {
          layout.remove(t.gridX, t.gridZ);
        }
      }
    }
  }
}

function keepOnlyLargestComponent(layout: TrackLayout): void {
  const tiles = layout.tiles();
  if (tiles.length <= 1) return;
  // Assign each tile to a component via BFS.
  const unvisited = new Set<PlacedTile>(tiles);
  const components: PlacedTile[][] = [];
  while (unvisited.size > 0) {
    const start = unvisited.values().next().value as PlacedTile;
    unvisited.delete(start);
    const queue: PlacedTile[] = [start];
    const component: PlacedTile[] = [start];
    while (queue.length > 0) {
      const t = queue.pop()!;
      const ports = effectivePorts(t);
      for (const port of ports) {
        const [dx, dz] = dirVector(port);
        const yHere = portYInLayout(t, port);
        const wantPort = opposite(port);
        const primary = layout.get(t.gridX + dx, t.gridZ + dz);
        const under = layout.getUnder(t.gridX + dx, t.gridZ + dz);
        for (const cand of [primary, under]) {
          if (!cand || !unvisited.has(cand)) continue;
          const candPorts = effectivePorts(cand);
          if (!candPorts.includes(wantPort)) continue;
          if (Math.abs(portYInLayout(cand, wantPort) - yHere) > 0.01) continue;
          unvisited.delete(cand);
          component.push(cand);
          queue.push(cand);
        }
      }
    }
    components.push(component);
  }
  // Pick the biggest, drop the rest.
  components.sort((a, b) => b.length - a.length);
  const keep = new Set<PlacedTile>(components[0]);
  for (let i = 1; i < components.length; i++) {
    for (const t of components[i]!) {
      // For under-tile removal: layout.remove() drops both primary AND
      // under at the cell. If the primary is in the KEEP set but the
      // under-tile is not, we need to remove only the under-tile.
      const primary = layout.get(t.gridX, t.gridZ);
      const under = layout.getUnder(t.gridX, t.gridZ);
      if (primary === t && (!under || !keep.has(under))) {
        layout.remove(t.gridX, t.gridZ);
      } else if (primary === t) {
        // Primary going away but under stays — replace cell with just
        // the under-tile by stashing/restoring.
        const stash = layout.getUnder(t.gridX, t.gridZ);
        layout.remove(t.gridX, t.gridZ);
        if (stash) layout.placeUnder(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
      } else if (under === t) {
        // Only the under-tile is being dropped, primary stays.
        const stash = layout.get(t.gridX, t.gridZ);
        layout.remove(t.gridX, t.gridZ);
        if (stash) layout.place(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
      }
    }
  }
}

/** Second-pass WFC: pin every non-EMPTY cell from the first pass, crush
 *  EMPTY's weight to ~0, re-solve. Result fills in empty cells with track
 *  tiles wherever adjacency allows. The returned TrackLayout is built
 *  from the densified WFC output and is NOT yet component-filtered. */
function densifyLayout(
  firstPassCells: ReadonlyMap<string, string>,
  table: AdjacencyTable,
  variantById: ReadonlyMap<string, Variant>,
  size: number,
  rng: () => number,
): TrackLayout {
  // Pre-seed: every non-EMPTY cell from the first pass, pinned to its
  // exact variant id (so under-passes decompose the same way).
  const seeds = new Map<string, string>();
  for (const [k, id] of firstPassCells) {
    const v = variantById.get(id);
    if (!v || v.def.kind === 'empty') continue;
    seeds.set(k, id);
  }
  // Weight override: drop EMPTY to a near-zero weight so the solver only
  // picks it when adjacency leaves no other option.
  const weightOverride = new Map<string, number>();
  for (const v of table.variants) {
    if (v.def.kind === 'empty') weightOverride.set(v.id, 0.001);
  }
  const wfc = solveWFC(table, {
    width: size,
    height: size,
    rng,
    preSeed: seeds,
    weightOverride,
    maxRetries: 10,
  });
  // Build a fresh layout from the densified cells (same centering as the
  // first pass — gx = x - half, gz = y - half).
  const half = Math.floor(size / 2);
  const layout = new TrackLayout();
  for (const [k, id] of wfc.cells) {
    const [x, y] = parseKey(k);
    const v = variantById.get(id)!;
    if (v.def.kind === 'empty') continue;
    const gx = x - half;
    const gz = y - half;
    if (v.def.kind === 'under-pass-nesw') {
      const upperHorizontal = v.rotation === 0 || v.rotation === 2;
      const upperRot = upperHorizontal ? 1 : 0;
      const lowerRot = upperHorizontal ? 0 : 1;
      layout.place(gx, gz, ELEVATED_STRAIGHT_NS, upperRot, undefined, v.level);
      layout.placeUnder(gx, gz, STRAIGHT_NS, lowerRot, undefined, v.level);
      continue;
    }
    layout.place(gx, gz, v.def, v.rotation, undefined, v.level);
  }
  return layout;
}

/** Keep only the connected component that contains (gx, gz). Drops every
 *  other tile from the layout. Used after the densify pass to enforce
 *  "new tiles must connect to the original anchor" — any new island the
 *  solver placed but didn't connect back is removed. */
function keepComponentContaining(layout: TrackLayout, gx: number, gz: number): void {
  const seed = layout.get(gx, gz) ?? layout.getUnder(gx, gz);
  if (!seed) return;
  const reachable = new Set<PlacedTile>([seed]);
  const queue: PlacedTile[] = [seed];
  while (queue.length > 0) {
    const t = queue.pop()!;
    for (const port of effectivePorts(t)) {
      const [dx, dz] = dirVector(port);
      const yHere = portYInLayout(t, port);
      const wantPort = opposite(port);
      const primary = layout.get(t.gridX + dx, t.gridZ + dz);
      const under = layout.getUnder(t.gridX + dx, t.gridZ + dz);
      for (const cand of [primary, under]) {
        if (!cand || reachable.has(cand)) continue;
        const candPorts = effectivePorts(cand);
        if (!candPorts.includes(wantPort)) continue;
        if (Math.abs(portYInLayout(cand, wantPort) - yHere) > 0.01) continue;
        reachable.add(cand);
        queue.push(cand);
      }
    }
  }
  // Drop every tile not in `reachable`. Mirrors the primary/under stash
  // dance in keepOnlyLargestComponent so we don't accidentally remove a
  // surviving partner of a partially-reachable cell.
  for (const t of layout.tiles()) {
    if (reachable.has(t)) continue;
    const primary = layout.get(t.gridX, t.gridZ);
    const under = layout.getUnder(t.gridX, t.gridZ);
    if (primary === t && (!under || !reachable.has(under))) {
      layout.remove(t.gridX, t.gridZ);
    } else if (primary === t) {
      const stash = under!;
      layout.remove(t.gridX, t.gridZ);
      layout.placeUnder(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
    } else if (under === t) {
      const stash = primary!;
      layout.remove(t.gridX, t.gridZ);
      layout.place(t.gridX, t.gridZ, stash.def, stash.rotation, stash.routing, stash.level);
    }
  }
}

/** Group stations into connected sub-graphs (via shortestPath probes)
 *  and return the largest group. With multi-component layouts, this is
 *  what the train should cycle between — picking targets across
 *  components would strand the train when shortestPath returns null. */
function largestConnectedStationGroup(graph: TrackGraph, stations: GraphNode[]): GraphNode[] {
  const groups: GraphNode[][] = [];
  const assigned = new Set<GraphNode>();
  for (const s of stations) {
    if (assigned.has(s)) continue;
    const group = [s];
    assigned.add(s);
    for (const other of stations) {
      if (assigned.has(other)) continue;
      if (graph.shortestPath(s, other) !== null) {
        group.push(other);
        assigned.add(other);
      }
    }
    groups.push(group);
  }
  return groups.reduce((a, b) => (b.length > a.length ? b : a), [] as GraphNode[]);
}

/** Return every variant whose port-Y signature COVERS the placed tile's
 *  ports (has at least all of them at matching Y, possibly more). Used
 *  by the additive flow to soft-pin a cumulative tile in a way that
 *  lets WFC pick a richer variant (STRAIGHT → TEE → CROSS). */
function variantsCovering(tile: PlacedTile, table: AdjacencyTable): Set<string> {
  const required: Array<{ dir: 'N' | 'E' | 'S' | 'W'; y: number }> = [];
  for (const p of effectivePorts(tile)) required.push({ dir: p, y: portY(tile, p) });
  const allowed = new Set<string>();
  for (const v of table.variants) {
    let ok = true;
    for (const req of required) {
      const vy = v.portY[req.dir];
      if (vy === null) { ok = false; break; }
      if (!vy.some((y) => Math.abs(y - req.y) < 0.01)) { ok = false; break; }
    }
    if (ok) allowed.add(v.id);
  }
  return allowed;
}

/** Look up the canonical variant id for a given (kind, rotation, level)
 *  triple. enumerateVariants dedupes symmetric rotations, so the literal
 *  `${kind}@${rotation}+L${level}` may not exist; we fall back to any
 *  variant of the same kind+level whose effective port set matches the
 *  one this rotation would produce. */
function findVariantId(
  kind: string,
  rotation: number,
  level: number,
  table: AdjacencyTable,
): string | null {
  const direct = `${kind}@${rotation}${level === 0 ? '' : `+L${level}`}`;
  if (table.byId.has(direct)) return direct;
  // Fallback: any variant of the same kind+level. Symmetric rotations
  // produce identical behavior so picking any of them is fine.
  for (const v of table.variants) {
    if (v.def.kind === kind && v.level === level) return v.id;
  }
  return null;
}

/** Additive WFC roll: pin every tile in `existing` as a pre-seed, crush
 *  EMPTY's weight so the solver fills empty cells with track wherever
 *  adjacency allows, and KEEP all components (no largest-component
 *  filter, no h1/h2/under-pass criteria). The returned layout contains
 *  the cumulative cells PLUS whatever new ones the solve added; callers
 *  can compute the delta if needed. Throws if no valid solve is found
 *  within the retry budget. */
export function extendWFCLayout(
  existing: TrackLayout,
  opts: { size?: number; rng?: () => number; maxRetries?: number } = {},
): TrackLayout {
  const size = opts.size ?? 21;
  const rng = opts.rng ?? Math.random;
  const maxRetries = opts.maxRetries ?? 20;
  const variants = enumerateVariants(1);
  const table = buildAdjacencyTable(variants);
  const variantById = table.byId;
  const half = Math.floor(size / 2);
  // SOFT pre-seed for upgrade-able ground tiles (STRAIGHT / CURVE / TEE):
  // restrict the cell to any variant whose port-Y signature COVERS the
  // existing tile's ports. Lets WFC promote a STRAIGHT_NS to TEE_NES or
  // CROSS_NESW when a new branch wants to attach.
  // HARD pre-seed for non-upgrade-able tiles (stations, ramps, elevated
  // straight/curve, under-pass): variant id pinned exactly.
  const hardPreSeed = new Map<string, string>();
  const softPreSeed = new Map<string, Set<string>>();
  const upgradeKinds = new Set(['straight-ns', 'curve-ne', 'tee-nes']);
  for (const t of existing.tiles()) {
    if (existing.get(t.gridX, t.gridZ) !== t) continue; // skip under-tiles
    const wfcX = t.gridX + half;
    const wfcY = t.gridZ + half;
    if (wfcX < 0 || wfcX >= size || wfcY < 0 || wfcY >= size) continue;
    const cellKey = `${wfcX},${wfcY}`;
    const under = existing.getUnder(t.gridX, t.gridZ);
    // Stacked cells (primary + under). Choose the right virtual tile
    // based on rotation match:
    //   - rotations differ → UNDER_PASS_NESW (perpendicular layers).
    //   - rotations match  → PARALLEL_OVERPASS_NS or _CURVE_NE (same axis).
    // Transition: primary RAMP_NS + under STRAIGHT_NS, any rotation →
    //   PARALLEL_OVERPASS_RAMP_NS at that rotation.
    if (under) {
      const sameRot = under.rotation === t.rotation;
      if (t.def.kind === 'elevated-straight-ns' && under.def.kind === 'straight-ns') {
        if (sameRot) {
          // Parallel overpass straight. Variant rotation 0/2 → both N-S,
          // matches when primary rotation is 0. rotation 1/3 → both E-W.
          const vid = findVariantId('parallel-overpass-ns', t.rotation, t.level ?? 0, table);
          if (vid) hardPreSeed.set(cellKey, vid);
        } else {
          // Under-pass: upper E-W (rotation 1 or 3) → variant rot 0; upper N-S → variant rot 1.
          const upperHorizontal = t.rotation === 1 || t.rotation === 3;
          const upRot = upperHorizontal ? 0 : 1;
          const vid = findVariantId('under-pass-nesw', upRot, t.level ?? 0, table);
          if (vid) hardPreSeed.set(cellKey, vid);
        }
        continue;
      }
      if (t.def.kind === 'elevated-curve-ne' && under.def.kind === 'curve-ne' && sameRot) {
        const vid = findVariantId('parallel-overpass-curve-ne', t.rotation, t.level ?? 0, table);
        if (vid) hardPreSeed.set(cellKey, vid);
        continue;
      }
      if (t.def.kind === 'ramp-ns' && under.def.kind === 'straight-ns' && sameRot) {
        const vid = findVariantId('parallel-overpass-ramp-ns', t.rotation, t.level ?? 0, table);
        if (vid) hardPreSeed.set(cellKey, vid);
        continue;
      }
    }
    // Upgradeable ground tiles: soft-pin to the set of covering variants.
    if (upgradeKinds.has(t.def.kind) && (t.level ?? 0) === 0) {
      const allowed = variantsCovering(t, table);
      if (allowed.size > 0) {
        softPreSeed.set(cellKey, allowed);
        continue;
      }
    }
    // Everything else: hard pin.
    const vid = findVariantId(t.def.kind, t.rotation, t.level ?? 0, table);
    if (vid) hardPreSeed.set(cellKey, vid);
  }
  // Weight override: EMPTY → near-zero so the solver prefers track tiles
  // anywhere adjacency allows them.
  const weightOverride = new Map<string, number>();
  for (const v of table.variants) {
    if (v.def.kind === 'empty') weightOverride.set(v.id, 0.001);
  }
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const wfc = solveWFC(table, {
        width: size,
        height: size,
        rng,
        preSeed: hardPreSeed,
        softPreSeed,
        weightOverride,
        maxRetries: 8,
      });
      const layout = new TrackLayout();
      for (const [k, id] of wfc.cells) {
        const [x, y] = parseKey(k);
        const v = variantById.get(id)!;
        if (v.def.kind === 'empty') continue;
        const gx = x - half;
        const gz = y - half;
        if (v.def.kind === 'under-pass-nesw') {
          const upperHorizontal = v.rotation === 0 || v.rotation === 2;
          const upperRot = upperHorizontal ? 1 : 0;
          const lowerRot = upperHorizontal ? 0 : 1;
          layout.place(gx, gz, ELEVATED_STRAIGHT_NS, upperRot, undefined, v.level);
          layout.placeUnder(gx, gz, STRAIGHT_NS, lowerRot, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-ns') {
          const vertical = v.rotation === 0 || v.rotation === 2;
          const rot = vertical ? 0 : 1;
          layout.place(gx, gz, ELEVATED_STRAIGHT_NS, rot, undefined, v.level);
          layout.placeUnder(gx, gz, STRAIGHT_NS, rot, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-curve-ne') {
          layout.place(gx, gz, ELEVATED_CURVE_NE, v.rotation, undefined, v.level);
          layout.placeUnder(gx, gz, CURVE_NE, v.rotation, undefined, v.level);
          continue;
        }
        if (v.def.kind === 'parallel-overpass-ramp-ns') {
          layout.place(gx, gz, RAMP_NS, v.rotation, undefined, v.level);
          layout.placeUnder(gx, gz, STRAIGHT_NS, v.rotation, undefined, v.level);
          continue;
        }
        layout.place(gx, gz, v.def, v.rotation, undefined, v.level);
      }
      // Keep only the largest connected component. Cumulative cells are
      // pinned and remain connected; new tiles that EXTEND the cumulative
      // ride along; disconnected new loops the solver placed in empty
      // corners get dropped. Without this filter, those loops manifest
      // as dead-ends in the graph trace.
      keepOnlyLargestComponent(layout);
      // Sanity-check: graph extraction must succeed on the filtered
      // layout. If it doesn't, retry the whole solve.
      try {
        extractGraphFromLayout(layout, rng);
      } catch (e) {
        lastErr = e;
        continue;
      }
      return layout;
    } catch (e) {
      lastErr = e;
    }
  }
  throw new Error(`extendWFCLayout: exhausted retries (${(lastErr as Error)?.message})`);
}

/** Build a TrackGraph from an arbitrary TrackLayout — extracted from the
 *  generator so the cumulative-merge flow can rebuild a single graph from
 *  the union of multiple rolls. Picks up to 2 STRAIGHT cells as through-
 *  stations (in addition to whatever 1-port station tiles exist).
 *  Throws if buildGraphFromLayout fails (caller decides what to do). */
export function extractGraphFromLayout(
  layout: TrackLayout,
  rng: () => number = Math.random,
  opts?: { preferPrimary?: boolean },
): { graph: TrackGraph; stations: GraphNode[]; junctions: GraphNode[] } {
  const tiles = layout.tiles();
  const junctionCells: Array<{ gx: number; gz: number; kind: NodeKind; label?: string; tile: PlacedTile }> = [];
  let stationCounter = 0;
  const stationLabel = () => String.fromCharCode(65 + stationCounter++);
  const claimedCells = new Set<string>();
  for (const t of tiles) {
    const ports = effectivePorts(t);
    if (ports.length >= 3) {
      junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'junction', label: 'J', tile: t });
      claimedCells.add(`${t.gridX},${t.gridZ}`);
    } else if (ports.length === 1) {
      junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel(), tile: t });
      claimedCells.add(`${t.gridX},${t.gridZ}`);
    }
  }
  // extractGraphFromLayout is also called outside the WFC pipeline
  // (e.g. after a cumulative-merge rebuild) where there's no maxLevel
  // to enforce — just take whatever levels happen to exist.
  const pickedStations = pickStationCells(tiles, claimedCells, layout, rng, 4) ?? [];
  for (const t of pickedStations) {
    junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel(), tile: t });
    claimedCells.add(`${t.gridX},${t.gridZ}`);
  }
  const graph = buildGraphFromLayout(layout, junctionCells, opts);
  const stations = graph.nodes.filter((n) => n.kind === 'station');
  const junctions = graph.nodes.filter((n) => n.kind === 'junction');
  return { graph, stations, junctions };
}

/** Exported helper for callers that want to inspect adjacency directly. */
export function buildVariants(): { variants: Variant[]; table: AdjacencyTable } {
  const variants = enumerateVariants(0);
  return { variants, table: buildAdjacencyTable(variants) };
}
