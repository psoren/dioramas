// Constructive track grower. Builds a TrackLayout incrementally:
//   1. Place a STATION_N at centre. Its one port becomes the seed.
//   2. Maintain a frontier of "open ports" — for each, the cell to fill
//      and the entry-side direction + Y that needs to match.
//   3. At each step pop a random frontier entry. If the target cell is
//      empty, pick a tile that satisfies the entry (TEE with some
//      probability → branch; CURVE next; STRAIGHT as fallback; plus a
//      small chance to RAMP up or stay ELEVATED). If the target cell
//      already has a tile, try to LOOP-CLOSE by either matching ports
//      directly or UPGRADING the existing tile (STRAIGHT/CURVE → TEE,
//      TEE → CROSS) so the new port plugs in.
//   4. Add the placed tile's remaining ports to the frontier.
//   5. Stop when the frontier is empty.
//
// Connectivity is guaranteed by construction — every tile placed
// connects to an existing tile via the port that triggered its
// placement. No disconnected components, no orphan stacked under-tiles,
// no closed loops without junctions.

import {
  CROSS_NESW,
  CURVE_NE,
  Direction,
  ELEVATED_CURVE_NE,
  ELEVATED_STRAIGHT_NS,
  PlacedTile,
  RAMP_HEIGHT,
  RAMP_NS,
  Rotation,
  STATION_N,
  STRAIGHT_NS,
  TEE_NES,
  TrackTileDef,
  dirVector,
  effectivePorts,
  opposite,
} from './trackTile';
import { TrackLayout, portY } from './trackLayout';

export interface GrowOptions {
  size: number;
  rng: () => number;
  /** Probability of trying a TEE first when extending an open port. */
  pBranch?: number;
  /** Probability of trying a CURVE (if TEE skipped / failed). */
  pCurve?: number;
  /** Probability of trying to climb a RAMP (ground → elevated). */
  pRamp?: number;
}

interface OpenSlot {
  gx: number;
  gz: number;
  /** Direction at the target cell that the incoming port arrives from. */
  entry: Direction;
  /** Y of the incoming port. */
  y: number;
}

export function growTrack(opts: GrowOptions): TrackLayout {
  const { size, rng } = opts;
  const pBranch = opts.pBranch ?? 0.35;
  const pCurve = opts.pCurve ?? 0.45;
  const pRamp = opts.pRamp ?? 0.08;
  const half = Math.floor(size / 2);
  const layout = new TrackLayout();

  // Start: a STATION_N at origin, facing north. Its single port opens a
  // frontier slot at (0, -1) on the south side, Y=0.
  layout.place(0, 0, STATION_N, 0);
  const frontier: OpenSlot[] = [
    { gx: 0, gz: -1, entry: 'S', y: 0 },
  ];

  let safety = 0;
  while (frontier.length > 0) {
    if (++safety > size * size * 8) break; // belt-and-braces — should never hit
    const idx = Math.floor(rng() * frontier.length);
    const slot = frontier.splice(idx, 1)[0]!;

    if (Math.abs(slot.gx) > half || Math.abs(slot.gz) > half) {
      // Out of grid → dead-end on this port. Caller can decide to insert
      // a station later if desired; for now we just drop it.
      continue;
    }

    const existing = layout.get(slot.gx, slot.gz);
    if (existing) {
      // Try natural match.
      if (portMatches(existing, slot.entry, slot.y)) continue;
      // Try upgrade (STRAIGHT/CURVE → TEE; TEE → CROSS).
      if (tryUpgradeForPort(layout, slot)) continue;
      // Can't accept this port. Leave as a buried dead-end.
      continue;
    }

    const pick = pickTile(layout, slot, rng, half, pBranch, pCurve, pRamp);
    if (!pick) continue;
    layout.place(slot.gx, slot.gz, pick.def, pick.rotation, undefined, pick.level);
    const placed: PlacedTile = {
      gridX: slot.gx, gridZ: slot.gz,
      def: pick.def, rotation: pick.rotation, level: pick.level,
    };
    for (const p of effectivePorts(placed)) {
      if (p === slot.entry) continue;
      const [dx, dz] = dirVector(p);
      frontier.push({
        gx: slot.gx + dx,
        gz: slot.gz + dz,
        entry: opposite(p),
        y: portY(placed, p),
      });
    }
  }

  return layout;
}

function portMatches(tile: PlacedTile, dir: Direction, y: number): boolean {
  if (!effectivePorts(tile).includes(dir)) return false;
  return Math.abs(portY(tile, dir) - y) < 0.01;
}

// --- Tile picking ---------------------------------------------------------

interface Candidate {
  def: TrackTileDef;
  rotation: Rotation;
  level: number;
}

function pickTile(
  layout: TrackLayout,
  slot: OpenSlot,
  rng: () => number,
  half: number,
  pBranch: number,
  pCurve: number,
  pRamp: number,
): Candidate | null {
  // Build candidate pools, then roll for which pool to draw from. Each
  // candidate is verified to fit (entry port matches, other ports don't
  // conflict with existing neighbours or grid edges).
  const roll = rng();

  // RAMP attempt — only valid when entering at Y=0 (ramp goes UP from
  // ground) or at Y=H (ramp goes DOWN to ground).
  if (roll < pRamp) {
    const ramp = tryCandidates(layout, slot, half, rampCandidates(slot), rng);
    if (ramp) return ramp;
  }

  // Branch / curve / straight chain. Each pool: candidates from a tile
  // family that has the slot's entry port at the right Y.
  if (roll < pRamp + pBranch) {
    const tee = tryCandidates(layout, slot, half, teeCandidates(slot), rng);
    if (tee) return tee;
  }
  if (roll < pRamp + pBranch + pCurve) {
    const curve = tryCandidates(layout, slot, half, curveCandidates(slot), rng);
    if (curve) return curve;
  }
  // Straight as final fallback.
  const straight = tryCandidates(layout, slot, half, straightCandidates(slot), rng);
  if (straight) return straight;
  // Last resort: try ANY candidate that fits.
  return tryCandidates(layout, slot, half, allCandidates(slot), rng);
}

function tryCandidates(
  layout: TrackLayout,
  slot: OpenSlot,
  half: number,
  cands: Candidate[],
  rng: () => number,
): Candidate | null {
  const shuffled = [...cands];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  for (const c of shuffled) {
    if (candidateFits(layout, slot, half, c)) return c;
  }
  return null;
}

function candidateFits(
  layout: TrackLayout,
  slot: OpenSlot,
  half: number,
  cand: Candidate,
): boolean {
  const placed: PlacedTile = {
    gridX: slot.gx, gridZ: slot.gz, def: cand.def, rotation: cand.rotation, level: cand.level,
  };
  const ports = effectivePorts(placed);
  // Entry port must exist at the slot's Y.
  if (!ports.includes(slot.entry)) return false;
  if (Math.abs(portY(placed, slot.entry) - slot.y) > 0.01) return false;
  // For each NON-entry port, check it doesn't immediately violate.
  for (const p of ports) {
    if (p === slot.entry) continue;
    const [dx, dz] = dirVector(p);
    const nx = slot.gx + dx;
    const nz = slot.gz + dz;
    if (Math.abs(nx) > half || Math.abs(nz) > half) return false; // off grid
    const existing = layout.get(nx, nz);
    if (existing) {
      const exPorts = effectivePorts(existing);
      const want = opposite(p);
      // Either the existing tile already has a matching port (loop-close
      // possible) OR it's upgradeable to one. Conservative: require
      // matching port AND matching Y for now. (Upgrades happen in the
      // tryUpgradeForPort path when the frontier slot is processed.)
      if (!exPorts.includes(want)) {
        // Could be upgradeable — accept tentatively if existing is a
        // basic STRAIGHT/CURVE that we know how to extend.
        if (existing.def.kind !== 'straight-ns' && existing.def.kind !== 'curve-ne' && existing.def.kind !== 'tee-nes') return false;
        // Also require Y compatibility (ground only for upgrades).
        if (slot.y !== 0) return false;
        if (portY(placed, p) !== 0) return false;
      } else {
        if (Math.abs(portY(existing, want) - portY(placed, p)) > 0.01) return false;
      }
    }
  }
  return true;
}

// --- Candidate enumerators ------------------------------------------------

function straightCandidates(slot: OpenSlot): Candidate[] {
  const out: Candidate[] = [];
  if (slot.y === 0) {
    out.push({ def: STRAIGHT_NS, rotation: 0, level: 0 });
    out.push({ def: STRAIGHT_NS, rotation: 1, level: 0 });
  } else {
    out.push({ def: ELEVATED_STRAIGHT_NS, rotation: 0, level: 0 });
    out.push({ def: ELEVATED_STRAIGHT_NS, rotation: 1, level: 0 });
  }
  return out;
}

function curveCandidates(slot: OpenSlot): Candidate[] {
  const out: Candidate[] = [];
  const def = slot.y === 0 ? CURVE_NE : ELEVATED_CURVE_NE;
  for (let r = 0; r < 4; r++) out.push({ def, rotation: r as Rotation, level: 0 });
  return out;
}

function teeCandidates(slot: OpenSlot): Candidate[] {
  // Ground only — no elevated TEE in the palette.
  if (slot.y !== 0) return [];
  const out: Candidate[] = [];
  for (let r = 0; r < 4; r++) out.push({ def: TEE_NES, rotation: r as Rotation, level: 0 });
  return out;
}

function rampCandidates(_slot: OpenSlot): Candidate[] {
  // Enumerate all 4 rotations; candidateFits filters by entry+Y match.
  const out: Candidate[] = [];
  for (let r = 0; r < 4; r++) out.push({ def: RAMP_NS, rotation: r as Rotation, level: 0 });
  return out;
}

function allCandidates(slot: OpenSlot): Candidate[] {
  return [
    ...straightCandidates(slot),
    ...curveCandidates(slot),
    ...teeCandidates(slot),
    ...rampCandidates(slot),
  ];
}

// --- Upgrade-on-collision -------------------------------------------------

function tryUpgradeForPort(layout: TrackLayout, slot: OpenSlot): boolean {
  const tile = layout.get(slot.gx, slot.gz);
  if (!tile) return false;
  if (slot.y !== 0) return false; // only ground upgrades for now
  const ports = effectivePorts(tile);
  const targetSet = new Set([...ports, slot.entry]);
  // STRAIGHT/CURVE → TEE (3 ports).
  if (targetSet.size === 3 && (tile.def.kind === 'straight-ns' || tile.def.kind === 'curve-ne')) {
    for (let r = 0; r < 4; r++) {
      const teePorts = effectivePorts({ gridX: 0, gridZ: 0, def: TEE_NES, rotation: r as Rotation });
      if (teePorts.length === 3 && teePorts.every((p) => targetSet.has(p))) {
        layout.remove(slot.gx, slot.gz);
        layout.place(slot.gx, slot.gz, TEE_NES, r as Rotation);
        return true;
      }
    }
  }
  // TEE → CROSS (4 ports).
  if (targetSet.size === 4 && tile.def.kind === 'tee-nes') {
    layout.remove(slot.gx, slot.gz);
    layout.place(slot.gx, slot.gz, CROSS_NESW, 0);
    return true;
  }
  return false;
}

// RAMP_HEIGHT kept imported in case future grower extensions need it.
void RAMP_HEIGHT;
