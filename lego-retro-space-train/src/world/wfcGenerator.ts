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
}

/** Run WFC, build a graph from the result, validate the contract (≥1
 *  intersection, ≥2 stations, all nodes reachable from one another).
 *  Restarts the pipeline on contradiction or contract failure. */
export function generateWFCGraph(opts: WFCGenOptions = {}): WFCGenResult {
  // Default to a plate-spanning 11×11 grid (the plate is ±5.5 tiles wide
  // at TILE_SIZE 2.4 ≈ BASE_SIZE 28). Multi-level variants enabled (level
  // 0 + level 1) so the solver can produce taller bridges + viaducts.
  const size = opts.size ?? 11;
  const rng = opts.rng ?? Math.random;
  const maxRetries = opts.maxRetries ?? 60;

  const variants = enumerateVariants(1);
  const table = buildAdjacencyTable(variants);
  const variantById = table.byId;
  const preSeed = buildMultiLevelPreSeed(size, table);

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
      const straightCandidates = tiles.filter((t) =>
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

/** Exported helper for callers that want to inspect adjacency directly. */
export function buildVariants(): { variants: Variant[]; table: AdjacencyTable } {
  const variants = enumerateVariants(0);
  return { variants, table: buildAdjacencyTable(variants) };
}
