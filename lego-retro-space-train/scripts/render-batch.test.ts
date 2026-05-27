// Run: `npx vitest run scripts/render-batch` (also picks up an
// optional NOTES env var to attach a free-text note to the batch).
//
// Generates a batch of 10 WFC layouts, renders each as a top-down
// SVG into public/batches/<batchId>/, and appends a metadata entry
// to public/batches/index.json. View at /dashboard.html on the dev
// server.

import { describe, it } from 'vitest';
import { generateWFCGraph, extractGraphFromLayout } from '../src/world/wfcGenerator';
import { TrackLayout } from '../src/world/trackLayout';
import { PlacedTile, effectivePorts, sampleWorldPath, TILE_SIZE } from '../src/world/trackTile';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('render WFC batch', () => {
  it('writes 10 sets + updates dashboard index', () => {
    const size = 13;
    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const batchId = `${timestamp}-${commit}`;
    const outDir = path.join('public', 'batches', batchId);
    fs.mkdirSync(outDir, { recursive: true });

    const sets: Array<{
      seed: number;
      ok: boolean;
      tiles?: number;
      parallel?: number;
      elevatedOK?: boolean;
      elevatedThrough?: number;
      error?: string;
    }> = [];
    for (let i = 0; i < 10; i++) {
      const seed = 100_000 + (Number(process.env.SEED_BASE ?? Date.now() % 10_000)) + i * 731;
      let s = seed;
      const rng = () => {
        s |= 0; s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
      try {
        const result = generateWFCGraph({ size, rng, maxRetries: 200 });
        const layout = result.graph.layout;
        // Count parallel-overpass cells (primary ELEVATED + under at SAME
        // rotation — distinguishes from perpendicular under-pass).
        let parallel = 0;
        for (const t of layout.tiles()) {
          if (layout.get(t.gridX, t.gridZ) !== t) continue;
          const under = layout.getUnder(t.gridX, t.gridZ);
          if (!under) continue;
          const isPrimaryElevated = t.def.kind === 'elevated-straight-ns' || t.def.kind === 'elevated-curve-ne';
          if (isPrimaryElevated && t.rotation === under.rotation) parallel++;
        }
        let elevatedOK = false;
        let elevatedThrough = 0;
        try {
          const elev = extractGraphFromLayout(layout, rng, { preferPrimary: true });
          const through = elev.stations.filter((st) => st.edges.length >= 2);
          elevatedThrough = through.length;
          elevatedOK = through.length >= 2;
        } catch { /* falls back to ground */ }
        const svg = renderLayoutSvg(layout, size, parallel, elevatedOK);
        fs.writeFileSync(path.join(outDir, `set-${i + 1}.svg`), svg);
        sets.push({ seed, ok: true, tiles: layout.tiles().length, parallel, elevatedOK, elevatedThrough });
      } catch (e) {
        sets.push({ seed, ok: false, error: (e as Error).message.slice(0, 200) });
      }
    }

    // Aggregate stats for the batch header.
    const okCount = sets.filter((s) => s.ok).length;
    const parallelTotal = sets.reduce((a, b) => a + (b.parallel ?? 0), 0);
    const layoutsWithParallel = sets.filter((s) => (s.parallel ?? 0) > 0).length;
    const elevatedOKCount = sets.filter((s) => s.elevatedOK).length;

    const indexPath = path.join('public', 'batches', 'index.json');
    let index: BatchEntry[] = [];
    if (fs.existsSync(indexPath)) {
      try { index = JSON.parse(fs.readFileSync(indexPath, 'utf8')); } catch { /* keep empty */ }
    }
    const notes = process.env.NOTES ?? '';
    const entry: BatchEntry = {
      batchId,
      commit,
      timestamp: new Date().toISOString(),
      size,
      stats: {
        solves: okCount,
        total: sets.length,
        layoutsWithParallel,
        parallelTotal,
        elevatedOK: elevatedOKCount,
      },
      sets,
      notes,
    };
    index.unshift(entry);
    fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
    console.log(`\nBatch ${batchId} written.`);
    console.log(`  solves: ${okCount}/${sets.length}, layoutsWithParallel: ${layoutsWithParallel}, elevatedOK: ${elevatedOKCount}`);
    console.log(`  Open /dashboard.html on the dev server.`);
  }, 60_000);
});

interface BatchEntry {
  batchId: string;
  commit: string;
  timestamp: string;
  size: number;
  stats: {
    solves: number;
    total: number;
    layoutsWithParallel: number;
    parallelTotal: number;
    elevatedOK: number;
  };
  sets: Array<{
    seed: number;
    ok: boolean;
    tiles?: number;
    parallel?: number;
    elevatedOK?: boolean;
    elevatedThrough?: number;
    error?: string;
  }>;
  notes: string;
}

function renderLayoutSvg(
  layout: TrackLayout,
  size: number,
  parallelCount: number,
  elevatedOK: boolean,
): string {
  const half = Math.floor(size / 2);
  const cellPx = 22;
  const W = size * cellPx;
  const H = size * cellPx;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H + 18}" preserveAspectRatio="xMidYMid meet">`);
  // Background + grid.
  out.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#1a1a22"/>`);
  for (let i = 0; i <= size; i++) {
    out.push(`<line x1="0" y1="${i * cellPx}" x2="${W}" y2="${i * cellPx}" stroke="#262633"/>`);
    out.push(`<line x1="${i * cellPx}" y1="0" x2="${i * cellPx}" y2="${H}" stroke="#262633"/>`);
  }
  // Draw EVERY tile in layout. Project tile.samplePath (XZ → SVG XY).
  // Stacked cells render both layers; under tiles get drawn first (lower
  // alpha) so the primary overlays them.
  const renderOrder: Array<{ tile: PlacedTile; isPrimary: boolean }> = [];
  for (const t of layout.tiles()) {
    const isPrimary = layout.get(t.gridX, t.gridZ) === t;
    renderOrder.push({ tile: t, isPrimary });
  }
  renderOrder.sort((a, b) => (a.isPrimary ? 1 : 0) - (b.isPrimary ? 1 : 0));
  for (const { tile, isPrimary } of renderOrder) {
    const gx = tile.gridX + half;
    const gz = tile.gridZ + half;
    if (gx < 0 || gx >= size || gz < 0 || gz >= size) continue;
    const cx = (gx + 0.5) * cellPx;
    const cy = (gz + 0.5) * cellPx;
    const stroke = tileColor(tile, isPrimary);
    const strokeW = isPrimary ? 2.6 : 1.8;
    const ports = effectivePorts(tile);
    if (ports.length === 1) {
      // Station: small filled square at cell centre.
      out.push(`<rect x="${cx - 4}" y="${cy - 4}" width="8" height="8" fill="${stroke}"/>`);
      continue;
    }
    if (ports.length === 2) {
      // 2-port: sample the path between the two ports, project XZ.
      try {
        const pts = sampleWorldPath(tile, ports[0]!, ports[1]!, 8);
        const polyline = pts.map((p) => {
          const sx = (p.x / TILE_SIZE + half + 0.5) * cellPx;
          const sy = (p.z / TILE_SIZE + half + 0.5) * cellPx;
          return `${sx.toFixed(1)},${sy.toFixed(1)}`;
        }).join(' ');
        out.push(`<polyline points="${polyline}" fill="none" stroke="${stroke}" stroke-width="${strokeW}" stroke-linecap="round"/>`);
      } catch {
        out.push(`<circle cx="${cx}" cy="${cy}" r="3" fill="${stroke}"/>`);
      }
      continue;
    }
    // 3+ ports: draw a small filled square as junction marker + spokes.
    out.push(`<circle cx="${cx}" cy="${cy}" r="${isPrimary ? 4 : 3}" fill="${stroke}"/>`);
    for (const p of ports) {
      const [dx, dz] = dirVecFor(p);
      const ex = cx + dx * cellPx * 0.45;
      const ey = cy + dz * cellPx * 0.45;
      out.push(`<line x1="${cx}" y1="${cy}" x2="${ex}" y2="${ey}" stroke="${stroke}" stroke-width="${strokeW}"/>`);
    }
  }
  // Footer chip with stats.
  const chip = `parallel=${parallelCount}  elevated=${elevatedOK ? 'OK' : '-'}`;
  out.push(`<text x="4" y="${H + 13}" font-family="ui-monospace,monospace" font-size="11" fill="#888">${chip}</text>`);
  out.push(`</svg>`);
  return out.join('\n');
}

function dirVecFor(d: 'N' | 'E' | 'S' | 'W'): [number, number] {
  switch (d) {
    case 'N': return [0, -1];
    case 'E': return [1, 0];
    case 'S': return [0, 1];
    case 'W': return [-1, 0];
  }
}

function tileColor(tile: PlacedTile, isPrimary: boolean): string {
  const lower = !isPrimary;
  switch (tile.def.kind) {
    case 'straight-ns': return lower ? '#7088aa' : '#9bb';
    case 'curve-ne': return lower ? '#7088aa' : '#9bb';
    case 'tee-nes': return '#dca';
    case 'cross-nesw': return '#dca';
    case 'ramp-ns': case 'ramp-ns-tall': return '#ffa500';
    case 'elevated-straight-ns': case 'elevated-curve-ne': return '#5cf';
    case 'station-n': return '#5f5';
    default: return '#aaa';
  }
}
