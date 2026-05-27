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
import { UNDER_PASS_NESW } from './trackTile';
import { buildGraphFromLayout, NodeKind, TrackGraph, GraphNode } from './trackGraph';
import {
  dirVector, effectivePorts, opposite, PlacedTile, STRAIGHT_NS,
  ELEVATED_STRAIGHT_NS,
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
}

export interface WFCGenOptions {
  /** Grid size in cells (square). */
  size?: number;
  /** RNG. */
  rng?: () => number;
  /** Max WFC pipeline retries before giving up. */
  maxRetries?: number;
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
  // Default to a 21×21 grid (≈50 world units across at TILE_SIZE 2.4 ≈
  // full BASE_SIZE 28 plate with a small margin). Multi-level variants
  // enabled (level 0 + level 1) so the solver can produce taller bridges
  // + viaducts.
  const size = opts.size ?? 21;
  const rng = opts.rng ?? Math.random;
  const maxRetries = opts.maxRetries ?? 60;

  const variants = enumerateVariants(1);
  const table = buildAdjacencyTable(variants);
  const variantById = table.byId;
  const preSeed = buildMultiLevelPreSeed(size, table);
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
        layout.place(gx, gz, v.def, v.rotation, undefined, v.level);
      }

      if (layout.tiles().length < 4) { bump('too-sparse'); continue; }

      // Connectivity: WFC's local rules don't enforce global connectivity,
      // so the output may have multiple disconnected blobs. Instead of
      // rejecting (which kills success rate), we find the LARGEST
      // connected component and drop every tile not in it.
      keepOnlyLargestComponent(layout);
      const tiles = layout.tiles(); // REFRESH after the filter — orphans gone.
      if (tiles.length < 4) { bump('too-sparse-after-component-filter'); continue; }

      // Try to add an under-pass (best-effort — only succeeds if a
      // level-0 elevated cell happens to have ground neighbors on its
      // perpendicular axis).
      tryAddUnderpass(layout);

      // STRICT criteria after the component filter dropped any orphans:
      //   1. A bridge at height 1 (level-0 ELEVATED somewhere).
      //   2. A bridge at height 2 (level-1 ELEVATED — guaranteed by the
      //      pre-seed but could be dropped if the anchor's cell ended up
      //      in a disconnected blob).
      //   3. An under-pass (a cell with both primary AND under-tile).
      // If any of these is missing from the SURVIVING layout, retry.
      let hasHeight1 = false;
      let hasHeight2 = false;
      let hasUnderpass = false;
      for (const t of layout.tiles()) {
        if (t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne') {
          const lvl = t.level ?? 0;
          if (lvl === 0) hasHeight1 = true;
          if (lvl >= 1) hasHeight2 = true;
        }
        if (layout.get(t.gridX, t.gridZ) === t && layout.getUnder(t.gridX, t.gridZ)) {
          hasUnderpass = true;
        }
      }
      if (!hasHeight1) { bump('missing-height-1'); continue; }
      if (!hasHeight2) { bump('missing-height-2'); continue; }
      if (!hasUnderpass) { bump('missing-underpass'); continue; }

      // --- DENSIFY PASS ---
      // Re-run WFC with every non-EMPTY cell from the first pass pinned,
      // and EMPTY's weight crushed to ~0. The solver fills empty cells with
      // track tiles wherever adjacency allows; cells that can't host a
      // track (no port-compatible variant) fall back to EMPTY.
      //
      // After the new solve, replace the layout with the densified one,
      // then drop any tile that isn't connected to the original anchor —
      // that's how we enforce "new tiles must connect to old ones".
      try {
        const denseLayout = densifyLayout(wfc.cells, table, variantById, size, rng);
        // Anchor cell — the pinned level-1 ELEVATED at grid center,
        // mapped to layout coordinates by the same `- half` offset.
        const anchor = { gx: Math.floor(size / 2) - Math.floor(size / 2), gz: Math.floor(size / 2) - Math.floor(size / 2) };
        keepComponentContaining(denseLayout, anchor.gx, anchor.gz);
        // Re-run the under-pass helper on the densified layout (the
        // original under-pass cells from wfc.cells are preserved because
        // they were pinned as `under-pass-nesw@…`).
        tryAddUnderpass(denseLayout);
        // The densified layout SHOULD still satisfy the criteria — pinned
        // cells are immutable across the second pass — but defensively
        // re-check so a malformed densify doesn't ship.
        let h1 = false, h2 = false, up = false;
        for (const t of denseLayout.tiles()) {
          if (t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne') {
            const lvl = t.level ?? 0;
            if (lvl === 0) h1 = true;
            if (lvl >= 1) h2 = true;
          }
          if (denseLayout.get(t.gridX, t.gridZ) === t && denseLayout.getUnder(t.gridX, t.gridZ)) {
            up = true;
          }
        }
        if (h1 && h2 && up) {
          // Densify succeeded — adopt the new layout.
          layout.clear();
          for (const t of denseLayout.tiles()) {
            if (denseLayout.get(t.gridX, t.gridZ) === t) {
              layout.place(t.gridX, t.gridZ, t.def, t.rotation, t.routing, t.level);
            } else {
              layout.placeUnder(t.gridX, t.gridZ, t.def, t.rotation, t.routing, t.level);
            }
          }
          bump('densify-applied');
        } else {
          bump('densify-criteria-fail');
        }
      } catch (e) {
        bump(`densify-threw:${(e as Error).message.slice(0, 40)}`);
        // Fall through with the sparse layout.
      }

      // Refresh the tiles list after densify (it may have changed the set).
      const tilesPostDensify = layout.tiles();
      const junctionCells: Array<{ gx: number; gz: number; kind: NodeKind; label?: string }> = [];
      let stationCounter = 0;
      const stationLabel = () => String.fromCharCode(65 + stationCounter++);
      const claimedCells = new Set<string>();
      for (const t of tilesPostDensify) {
        const ports = effectivePorts(t);
        if (ports.length >= 3) {
          junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'junction', label: 'J' });
          claimedCells.add(`${t.gridX},${t.gridZ}`);
        } else if (ports.length === 1) {
          // 1-port = dead-end station. Rendered as a stub with buffer stop;
          // NOT added to the train's target cycle (would force reversal).
          junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel() });
          claimedCells.add(`${t.gridX},${t.gridZ}`);
        }
      }
      // Add THROUGH-stations: pick 2 plain STRAIGHT cells and mark them
      // as station nodes. Restricted to PRIMARY tiles (not under-tiles)
      // at ground level so the station node is at y=0 and the cell still
      // has 2 normal ports.
      const straightCandidates = tilesPostDensify.filter((t) =>
        t.def.kind === 'straight-ns' &&
        !claimedCells.has(`${t.gridX},${t.gridZ}`) &&
        layout.get(t.gridX, t.gridZ) === t &&
        (t.level ?? 0) === 0,
      );
      // Shuffle deterministically via rng so the chosen cells vary per roll.
      const shuffled = [...straightCandidates];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
      }
      for (let i = 0; i < Math.min(2, shuffled.length); i++) {
        const t = shuffled[i]!;
        junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel() });
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
      const stations = graph.nodes.filter((n) => n.kind === 'station');
      const junctions = graph.nodes.filter((n) => n.kind === 'junction');
      if (stations.length < 2) { bump('not-enough-station-nodes'); continue; }
      const ok = stations.every((s) =>
        stations.every((t) => s === t || graph.shortestPath(s, t) !== null),
      );
      if (!ok) { bump('disconnected'); continue; }

      console.log(`wfc generator: attempt ${attempt}, internal retries ${totalRetries}, reasons:`, reasons);
      return { graph, stations, junctions, retries: totalRetries + attempt };
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
      if (vy === null || Math.abs(vy - req.y) > 0.01) { ok = false; break; }
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
    // Under-passes: hard-pin to the under-pass variant (no useful upgrade).
    if (under && t.def.kind === 'elevated-straight-ns' && under.def.kind === 'straight-ns') {
      const upperHorizontal = t.rotation === 1 || t.rotation === 3;
      const upRot = upperHorizontal ? 0 : 1;
      const vid = findVariantId('under-pass-nesw', upRot, t.level ?? 0, table);
      if (vid) hardPreSeed.set(cellKey, vid);
      continue;
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
): { graph: TrackGraph; stations: GraphNode[]; junctions: GraphNode[] } {
  const tiles = layout.tiles();
  const junctionCells: Array<{ gx: number; gz: number; kind: NodeKind; label?: string }> = [];
  let stationCounter = 0;
  const stationLabel = () => String.fromCharCode(65 + stationCounter++);
  const claimedCells = new Set<string>();
  for (const t of tiles) {
    const ports = effectivePorts(t);
    if (ports.length >= 3) {
      junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'junction', label: 'J' });
      claimedCells.add(`${t.gridX},${t.gridZ}`);
    } else if (ports.length === 1) {
      junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel() });
      claimedCells.add(`${t.gridX},${t.gridZ}`);
    }
  }
  const straightCandidates = tiles.filter((t) =>
    t.def.kind === 'straight-ns' &&
    !claimedCells.has(`${t.gridX},${t.gridZ}`) &&
    layout.get(t.gridX, t.gridZ) === t &&
    (t.level ?? 0) === 0,
  );
  const shuffled = [...straightCandidates];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  for (let i = 0; i < Math.min(2, shuffled.length); i++) {
    const t = shuffled[i]!;
    junctionCells.push({ gx: t.gridX, gz: t.gridZ, kind: 'station', label: stationLabel() });
    claimedCells.add(`${t.gridX},${t.gridZ}`);
  }
  const graph = buildGraphFromLayout(layout, junctionCells);
  const stations = graph.nodes.filter((n) => n.kind === 'station');
  const junctions = graph.nodes.filter((n) => n.kind === 'junction');
  return { graph, stations, junctions };
}

/** Exported helper for callers that want to inspect adjacency directly. */
export function buildVariants(): { variants: Variant[]; table: AdjacencyTable } {
  const variants = enumerateVariants(0);
  return { variants, table: buildAdjacencyTable(variants) };
}
