// Track quality scoring. Six 0..1 components summed into a 0..100
// "track score" so the dashboard and HUD can rank rolls.
//
// Each component is normalised against a sensible target rather than
// the theoretical max — so a score of 0.5 means "half as good as a
// good layout", not "half as good as the universe of all layouts".

import { TrackGeneratorResult } from './generators';
import { dirVector, effectivePorts, opposite, PlacedTile } from './trackTile';
import { portY } from './trackLayout';

export interface QualityScore {
  /** Weighted total, 0..100 (higher = better). */
  total: number;
  /** Each criterion 0..1. */
  components: {
    coverage: number;
    connectivity: number;
    levelCoverage: number;
    rampPeaks: number;
    stationDistribution: number;
    avgLegLength: number;
  };
  /** Raw counts behind the components — useful for debugging / display. */
  details: {
    tilesPlaced: number;
    gridArea: number;
    componentCount: number;
    elevatedCells: number;
    underPasses: number;
    ramps: number;
    rampPeakCount: number;
    stationCount: number;
    avgEdgesPerLeg: number;
    /** Percent of grid cells with any port at Y=1*H (e.g. "12%"). */
    coverageY1: string;
    /** Same, Y=2H. */
    coverageY2: string;
    /** Same, Y=3H. */
    coverageY3: string;
  };
}

/** Score a generated track. `gridSize` is the grid edge in cells
 *  (square). `requestedMaxLevel` is what the user asked for (HUD's Lvl
 *  dropdown); levelCoverage scores against every Y level up to that
 *  height so a layout that "claims L2" but lacks Y=2H content gets
 *  hammered. Result is deterministic — same layout → same score. */
export function scoreLayout(
  result: TrackGeneratorResult,
  gridSize: number,
  requestedMaxLevel: number = 1,
): QualityScore {
  const layout = result.graph.layout;
  const tiles = layout.tiles();
  const tilesPlaced = tiles.length;
  const gridArea = gridSize * gridSize;

  // 1. Coverage — tiles / area. Target ~70% of grid covered = score 1.
  const coverage = Math.min(1, tilesPlaced / gridArea / 0.7);

  // 2. Connectivity — single component = 1, else 1/N.
  const visited = new Set<typeof result.graph.nodes[number]>();
  let componentCount = 0;
  for (const node of result.graph.nodes) {
    if (visited.has(node)) continue;
    componentCount++;
    const queue = [node];
    visited.add(node);
    while (queue.length > 0) {
      const n = queue.shift()!;
      for (const e of n.edges) {
        const o = e.from === n ? e.to : e.from;
        if (!visited.has(o)) { visited.add(o); queue.push(o); }
      }
    }
  }
  const connectivity = componentCount === 0 ? 0 : 1 / componentCount;

  // 3. Level coverage — fraction of grid cells with any port at each
  // Y level above ground. Replaces the old "verticalDensity" lumped
  // counter because that scored a layout with one Y=2H station the same
  // as one with multiple Y=2H bridges. Now we measure cells-per-level.
  // Cells are deduped per (gx, gz); a single tile contributes to every
  // Y level its ports touch.
  let elevated = 0;
  let ramps = 0;
  let underPasses = 0;
  const cellsAtY: Map<number, Set<string>> = new Map();
  const yKey = (yWorld: number): number => Math.round(yWorld / 1.4);
  // Include decor tiles so the Pass-4 upper deck shows up in the
  // per-level coverage stats — they're visual-only but the user cares
  // about whether Y=2H content actually exists.
  const allTilesForCoverage = [...tiles, ...layout.decorTiles()];
  for (const t of allTilesForCoverage) {
    if (t.def.kind.startsWith('elevated')) elevated++;
    if (t.def.kind.startsWith('ramp')) ramps++;
    if (layout.get(t.gridX, t.gridZ) === t && layout.getUnder(t.gridX, t.gridZ)) underPasses++;
    const cellKey = `${t.gridX},${t.gridZ}`;
    for (const p of effectivePorts(t)) {
      const k = yKey(portY(t, p));
      if (!cellsAtY.has(k)) cellsAtY.set(k, new Set());
      cellsAtY.get(k)!.add(cellKey);
    }
  }
  const cellsAtLevel = (n: number) => cellsAtY.get(n)?.size ?? 0;
  // Per-level target fractions (cells_at_level_n / grid_area). Y=H
  // (the always-present elevated baseline) targets a sensible density;
  // every level above that targets 50% so the metric is harsh on
  // layouts that "have L2" but only via a single station.
  const TARGETS: Record<number, number> = { 1: 0.15, 2: 0.5, 3: 0.5 };
  const perLevelScore = (n: number): number => {
    const cells = cellsAtLevel(n);
    if (cells === 0) return 0;
    return Math.min(1, cells / gridArea / TARGETS[n]!);
  };
  // Score against every level the user asked for, regardless of whether
  // it has content. Picking L2 and getting 0% Y=2H is a FAILURE the
  // score must reflect — earlier version skipped empty levels, which
  // perversely meant bare L2 layouts beat L2 layouts with some Y=2H
  // content.
  const scoredLevels: number[] = [];
  for (let lvl = 1; lvl <= requestedMaxLevel; lvl++) scoredLevels.push(perLevelScore(lvl));
  const levelCoverage = scoredLevels.length === 0
    ? 0
    : scoredLevels.reduce((a, b) => a + b, 0) / scoredLevels.length;
  const pct = (n: number) =>
    `${Math.round(cellsAtLevel(n) / gridArea * 100)}% (${cellsAtLevel(n)}/${gridArea})`;

  // 4. Ramp peaks — count ramp-to-ramp HIGH↔HIGH adjacencies.
  const isRamp = (t: PlacedTile) =>
    t.def.kind === 'ramp-ns' || t.def.kind === 'ramp-ns-tall';
  const peakY = (t: PlacedTile): number => {
    let max = -Infinity;
    for (const p of effectivePorts(t)) {
      const y = portY(t, p);
      if (y > max) max = y;
    }
    return max;
  };
  let peakHalfCount = 0;
  for (const t of tiles) {
    if (!isRamp(t)) continue;
    if (layout.get(t.gridX, t.gridZ) !== t) continue;
    const peak = peakY(t);
    for (const port of effectivePorts(t)) {
      if (Math.abs(portY(t, port) - peak) > 1e-3) continue;
      const [dx, dz] = dirVector(port);
      const nb = layout.get(t.gridX + dx, t.gridZ + dz);
      if (!nb || !isRamp(nb)) continue;
      const nbPeak = peakY(nb);
      if (Math.abs(portY(nb, opposite(port)) - nbPeak) > 1e-3) continue;
      peakHalfCount++;
    }
  }
  const rampPeakCount = Math.floor(peakHalfCount / 2);
  // Each peak deducts 0.25. 0 peaks = 1.0, 4+ peaks = 0.
  const rampPeaks = Math.max(0, 1 - rampPeakCount * 0.25);

  // 5. Station distribution — mean pairwise grid distance / target.
  // Target = 0.5 * grid diagonal (stations spread across half the plate).
  let stationDistribution = 1;
  const stations = result.stations;
  if (stations.length >= 2) {
    let totalDist = 0;
    let pairs = 0;
    for (let i = 0; i < stations.length; i++) {
      for (let j = i + 1; j < stations.length; j++) {
        const dx = stations[i]!.gridX - stations[j]!.gridX;
        const dz = stations[i]!.gridZ - stations[j]!.gridZ;
        totalDist += Math.hypot(dx, dz);
        pairs++;
      }
    }
    const meanDist = pairs > 0 ? totalDist / pairs : 0;
    const target = gridSize * Math.SQRT2 * 0.5;
    stationDistribution = Math.min(1, meanDist / target);
  }

  // 6. Average leg length — edges per station→next-station path.
  let avgEdgesPerLeg = 0;
  let avgLegLength = 0;
  if (stations.length >= 2) {
    let totalEdges = 0;
    let legs = 0;
    for (let i = 0; i < stations.length; i++) {
      const j = (i + 1) % stations.length;
      const path = result.graph.shortestPath(stations[i]!, stations[j]!);
      if (path) { totalEdges += path.length; legs++; }
    }
    avgEdgesPerLeg = legs > 0 ? totalEdges / legs : 0;
    // Ideal leg ~6 edges. Deviation past ±6 drops the score linearly.
    const ideal = 6;
    avgLegLength = Math.max(0, 1 - Math.abs(avgEdgesPerLeg - ideal) / ideal);
  }

  const components = {
    coverage,
    connectivity,
    levelCoverage,
    rampPeaks,
    stationDistribution,
    avgLegLength,
  };
  const sum = coverage + connectivity + levelCoverage + rampPeaks
            + stationDistribution + avgLegLength;
  const total = Math.round((sum / 6) * 100);

  return {
    total,
    components,
    details: {
      tilesPlaced,
      gridArea,
      componentCount,
      elevatedCells: elevated,
      underPasses,
      ramps,
      rampPeakCount,
      stationCount: stations.length,
      avgEdgesPerLeg: Math.round(avgEdgesPerLeg * 10) / 10,
      coverageY1: pct(1),
      coverageY2: pct(2),
      coverageY3: pct(3),
    },
  };
}
