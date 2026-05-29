import * as THREE from 'three';
import { Sim } from './sim/Sim';
import { mountHUD, refreshTrainList, setQualityScore, setWFCLoading, yieldFrame } from './ui/hud';

// Dev: pipe browser console output to /tmp/sim-console.log via the Vite
// dev server's POST endpoint, so a CLI agent can read what the browser
// is logging without driving the browser.
if (import.meta.env.DEV) {
  const post = (level: 'log' | 'warn' | 'error', msg: string) => {
    fetch('/__sim_log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, msg }),
    }).catch(() => { /* swallow — we don't want logging to crash anything */ });
  };
  const stringify = (a: unknown): string => {
    if (typeof a === 'string') return a;
    if (a instanceof Error) return `${a.name}: ${a.message}`;
    try { return JSON.stringify(a); } catch { return String(a); }
  };
  for (const level of ['log', 'warn', 'error'] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      post(level, args.map(stringify).join(' '));
      orig(...args);
    };
  }
}
import { Entity } from './sim/Entity';
import {
  buildSceneEntity,
  defaultSceneManifest,
  hasTelemetry,
} from './world/sceneManifest';
import { DayNightCycle } from './entities/DayNightCycle';
import { MonorailTrain } from './entities/MonorailTrain';
import { SpaceTruck } from './entities/SpaceTruck';
import { AstronautPedestrian } from './entities/AstronautPedestrian';
import { ApartmentBuilding } from './entities/ApartmentBuilding';
import { JunctionTrack } from './entities/JunctionTrack';
import { GraphTrain } from './entities/GraphTrain';
import { TrainRouteHighlight } from './entities/TrainRouteHighlight';
import { BlockRegistry } from './world/BlockRegistry';
import { generateRandomGraphTrack } from './world/trackGraphGenerators';
import { generateWFCGraph, extractGraphFromLayout, extendWFCLayout } from './world/wfcGenerator';
import { pickGenerator } from './world/generators';
import { TrackLayout } from './world/trackLayout';
import { scoreLayout } from './world/trackQuality';
import { mountInspectPanel, describeEntity } from './ui/inspectPanel';

window.addEventListener('error', (event) => {
  showStartupError('Runtime', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  showStartupError('Runtime promise', event.reason);
});

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const sim = new Sim(canvas);

function addEntity<E extends Entity>(label: string, create: () => E): E | undefined {
  try {
    return sim.add(create());
  } catch (error) {
    showStartupError(label, error);
    return undefined;
  }
}

function showStartupError(label: string, error: unknown): void {
  const root = document.getElementById('ui-root');
  if (!root) return;
  const panel = document.createElement('div');
  panel.className = 'panel error-panel';
  const message = error instanceof Error ? error.message : String(error);
  panel.textContent = `${label} failed: ${message}`;
  root.appendChild(panel);
  console.error(`${label} failed`, error);
}

const registry = new Map<string, Entity>();
const builtEntities = [];
for (const spec of defaultSceneManifest) {
  const entity = addEntity(spec.id, () => buildSceneEntity(spec, registry));
  if (!entity) continue;
  registry.set(spec.id, entity);
  builtEntities.push({ spec, entity });
}

// Wire any pedestrians to the first apartment as their home address.
const apartment = builtEntities
  .map(({ entity }) => entity)
  .find((e): e is ApartmentBuilding => e instanceof ApartmentBuilding);
if (apartment) {
  for (const { entity } of builtEntities) {
    if (entity instanceof AstronautPedestrian) entity.setHome(apartment.doorPosition);
  }
}

// Day/night cycle. Built after the manifest so it can discover the lights
// the manifest's lighting setup added to the scene. Held in a variable so
// the HUD time-of-day button can lock it to a fixed time.
const dayNightCycle = new DayNightCycle(sim);
sim.add(dayNightCycle);

// Cinematic auto-camera: the things worth focusing on are the moving
// vehicles (trains, trucks) and the wandering pedestrians. Stationary set
// pieces aren't interesting to "circle" — they'd just sit there.
sim.orbit.focusCandidates = builtEntities
  .filter(({ entity }) =>
    entity instanceof MonorailTrain ||
    entity instanceof SpaceTruck ||
    entity instanceof AstronautPedestrian,
  )
  .map(({ entity }) => entity.object3d);

// Click-to-inspect: build a uuid→entity map and wire the orbit camera's
// pick hook to populate the inspect panel.
const byUuid = new Map<string, { spec: typeof builtEntities[number]['spec']; entity: Entity }>();
for (const built of builtEntities) byUuid.set(built.entity.object3d.uuid, built);
const inspect = mountInspectPanel();
sim.orbit.onPick = (obj) => {
  const built = byUuid.get(obj.uuid);
  if (built) inspect.show(describeEntity(built.spec, built.entity));
};
sim.orbit.onPickMiss = () => inspect.hide();

const tracked = builtEntities.find(({ spec, entity }) => spec.telemetry && hasTelemetry(entity));

// Runtime "🎲 Random track" button — disposes whatever the previous click
// added (track + train) and rebuilds. Every roll is a passing-siding with
// an elevated branch, so each track has at least one intersection and one
// elevated section. (Variety comes from dimension rolls inside the
// generator + the train's random destination cadence.)
//
// The figure-8 / extruded / twisted modes from earlier rolls still live
// in TileTrack but are no longer wired into the random button.
const randomEntities: Entity[] = [];
// Module-level handle to the active train so the POV button can target it.
let currentTrain: GraphTrain | null = null;
// All trains currently on the plate (for the side-panel list). Repopulated
// each time the track is regenerated.
const activeTrains: Array<{ name: string; train: GraphTrain }> = [];
// Highlight entity for the selected train's route. Reused across selections.
let routeHighlight: TrainRouteHighlight | null = null;
// Cumulative WFC layout — each WFC roll's tiles are merged into this
// (new tile wins on cell conflicts). The visible track is rebuilt from
// this union on every click, so each roll APPENDS to the network rather
// than replacing it.
const cumulativeLayout = new TrackLayout();
function placeTrackOnGraph(
  graph: ReturnType<typeof generateRandomGraphTrack>['graph'],
  stations: ReturnType<typeof generateRandomGraphTrack>['stations'],
): void {
  console.log(
    `placeTrackOnGraph: ${graph.nodes.length} nodes, ${graph.edges.length} edges, ` +
    `${stations.length} stations (${stations.filter((s) => s.edges.length >= 2).length} through)`,
  );
  // Fresh roll: drop any prior train selections and reset the panel state.
  activeTrains.length = 0;
  if (routeHighlight) routeHighlight.setTrain(null);
  // Random saturated hue per roll so consecutive layouts look obviously
  // different — useful for confirming a click actually rebuilt the track.
  // Decor deck (Pass 4 upper deck) gets a second random hue OFFSET by
  // ~0.4 from the ground hue so the two networks don't look the same.
  const groundHue = Math.random();
  const decorHue = (groundHue + 0.35 + Math.random() * 0.3) % 1;
  const deckColor = new THREE.Color().setHSL(groundHue, 0.55, 0.55).getHex();
  const decorDeckColor = new THREE.Color().setHSL(decorHue, 0.6, 0.6).getHex();
  console.log(`track deck color: #${deckColor.toString(16).padStart(6, '0')} / decor #${decorDeckColor.toString(16).padStart(6, '0')}`);
  const track = sim.add(new JunctionTrack({ graph, position: [0, 0.02, 0], deckColor, decorDeckColor }));
  randomEntities.push(track);
  // Targets = through-stations in the order extractGraphFromLayout
  // assigned their labels (A, B, C, …). Train walks station → next
  // station via shortest-path between each pair, so a route like
  // A→B→C→D→A spans multiple edges per leg — the user can SEE the
  // train heading to its next stop. (Eulerian tour gave every node
  // as a target, which collapsed the "next stop" to one edge and
  // made the route-highlight feature pointless.)
  const targets = stations.filter((s) => s.edges.length >= 2);
  if (targets.length >= 2) {
    // Single BlockRegistry, shared between BOTH trains since they
    // run on the same graph. Different graphs would mean different
    // edge id namespaces and no contention — which silently failed
    // wherever the elevated graph traced through ground cells.
    const groundBlocks = new BlockRegistry();
    const train = sim.add(new GraphTrain({
      graph,
      targetCycle: targets,
      startAt: targets[0],
      blockRegistry: groundBlocks,
    }));
    train.object3d.position.y += 0.02;
    randomEntities.push(train);
    currentTrain = train;
    activeTrains.push({ name: 'Train 1', train });
    const switchUpdater: Entity = {
      object3d: new THREE.Group(),
      update: () => updateSwitches(track, train, graph),
    };
    randomEntities.push(sim.add(switchUpdater));
    // Second train at an offset start so they don't spawn on top of
    // each other. Same registry → block-signaling forces them apart.
    if (targets.length >= 3) {
      const startIdx = Math.floor(targets.length / 2);
      const train2 = sim.add(new GraphTrain({
        graph,
        targetCycle: targets,
        startAt: targets[startIdx],
        blockRegistry: groundBlocks,
      }));
      train2.object3d.position.y += 0.02;
      randomEntities.push(train2);
      activeTrains.push({ name: 'Train 2', train: train2 });
    }
  }
  // Repopulate the side-panel list with this roll's trains.
  refreshTrainList(activeTrains, onSelectTrain);
}

/** Wire a train selection from the side panel → glowing rainbow route.
 *  The highlight polls the train each frame so it shortens as it
 *  advances and refreshes at every arrival. */
function onSelectTrain(idx: number | null): void {
  if (!routeHighlight) {
    routeHighlight = sim.add(new TrainRouteHighlight()) as TrainRouteHighlight;
  }
  const entry = idx === null ? null : activeTrains[idx];
  routeHighlight.setTrain(entry?.train ?? null);
}

async function wfcTrack(seedOverride?: number): Promise<void> {
  // Show the loading overlay and wait one animation frame so the
  // browser actually paints it before WFC starts blocking the main
  // thread. Without the yield, the overlay show + WFC + overlay hide
  // all run in one tick and the user sees a blank screen instead.
  setWFCLoading(true);
  try {
    await yieldFrame();
    await wfcTrackInner(seedOverride);
  } finally {
    setWFCLoading(false);
  }
}

function wfcTrackInner(seedOverride?: number): Promise<void> {
  return new Promise((resolve) => {
    wfcTrackSync(seedOverride);
    resolve();
  });
}

function wfcTrackSync(seedOverride?: number): void {
  // Generate FIRST, then tear down — if WFC fails we keep the existing
  // layout on screen instead of clearing to nothing. No template
  // fallback: this button is exclusively WFC, otherwise it'd silently
  // hand back the rectangle/spur template the user is trying to escape.
  // Instead we retry at progressively smaller grid sizes (easier for the
  // solver). If every size fails we leave the previous layout intact.
  const seed = seedOverride ?? Math.floor(Math.random() * 1_000_000);
  // Pick generator algorithm from URL param `?algo=wfc|prims`.
  const params = new URLSearchParams(window.location.search);
  const algo = params.get('algo');
  const generator = pickGenerator(algo);
  // Max level for the WFC variant pool — capped at 3 (HUD limit).
  const levelsParam = Number(params.get('levels'));
  const maxLevel = Number.isFinite(levelsParam) && levelsParam >= 1 && levelsParam <= 3
    ? Math.floor(levelsParam)
    : 1;
  console.log(`gen seed: ${seed}  algo: ${algo ?? 'wfc'}  maxLevel: ${maxLevel}`);
  // Persist seed in the URL (?wfc-seed=N) so a refresh reproduces the
  // same layout, and surface it in the HUD seed badge so it can be
  // copied with one click.
  {
    const u = new URL(window.location.href);
    u.searchParams.set('wfc-seed', String(seed));
    window.history.replaceState({}, '', u.toString());
    const badge = document.getElementById('seed-badge');
    if (badge) badge.textContent = `seed ${seed}`;
  }
  const mulberry = mulberry32(seed);
  // Each click starts fresh — the additive (extend) flow only makes
  // sense for WFC and got muddy across algorithm switches.
  cumulativeLayout.clear();
  const firstRoll = cumulativeLayout.tiles().length === 0;
  let rolledLayout: ReturnType<typeof generateWFCGraph>['graph']['layout'] | null = null;
  if (firstRoll) {
    // First roll: use the chosen generator.
    let result: ReturnType<typeof generator> | null = null;
    for (const size of [13, 11, 9]) {
      try {
        const r = generator({ size, rng: mulberry, maxLevel });
        result = r;
        console.log(`${algo ?? 'wfc'} ${size}x${size} (first roll) done after ${r.retries ?? 0} retries`);
        // Compute + surface quality score for this roll.
        const score = scoreLayout(r, size, maxLevel);
        setQualityScore(score.total, score.components, score.details);
        console.log(`quality: ${score.total}/100`, score.components, score.details);
        break;
      } catch (err) {
        console.warn(`${algo ?? 'wfc'} ${size}x${size} failed:`, err);
      }
    }
    if (!result) {
      console.error('gen: all sizes failed; keeping previous layout');
      return;
    }
    rolledLayout = result.graph.layout;
  } else {
    // Subsequent rolls: additive — pin cumulative cells, crush EMPTY
    // weight, no criteria check, keep disconnected components. The new
    // solve produces a layout that includes the cumulative tiles + new
    // ones placed in adjacency-compatible empty cells (often forming
    // additional disconnected loops).
    for (const size of [13, 11, 9]) {
      try {
        rolledLayout = extendWFCLayout(cumulativeLayout, { size, rng: mulberry });
        console.log(`wfc ${size}x${size} (additive) succeeded`);
        break;
      } catch (err) {
        console.warn(`wfc ${size}x${size} additive failed:`, err);
      }
    }
    if (!rolledLayout) {
      console.error('wfc additive: all sizes failed; keeping previous layout');
      return;
    }
  }
  // Adopt the rolled layout as the new cumulative — it already includes
  // the prior cells (since they were pinned) plus whatever new ones the
  // solver added.
  cumulativeLayout.clear();
  for (const t of rolledLayout.tiles()) {
    const isPrimary = rolledLayout.get(t.gridX, t.gridZ) === t;
    if (isPrimary) {
      cumulativeLayout.place(t.gridX, t.gridZ, t.def, t.rotation, t.routing, t.level);
    } else {
      cumulativeLayout.placeUnder(t.gridX, t.gridZ, t.def, t.rotation, t.routing, t.level);
    }
  }
  // Decor tiles (Pass 4 upper deck) — invisible to graph extraction but
  // the renderer needs them. Copy after primary/under so cell ordering
  // doesn't matter.
  for (const t of rolledLayout.decorTiles()) {
    cumulativeLayout.placeDecor(t.gridX, t.gridZ, t.def, t.rotation, t.routing, t.level);
  }
  // Build a single combined graph from the cumulative layout.
  let combined: ReturnType<typeof extractGraphFromLayout>;
  try {
    combined = extractGraphFromLayout(cumulativeLayout, mulberry);
  } catch (err) {
    console.error('merged graph build failed; keeping previous layout', err);
    return;
  }
  console.log(
    `cumulative layout: ${cumulativeLayout.tiles().length} tiles, ` +
    `${combined.graph.nodes.length} graph nodes, ${combined.graph.edges.length} edges`,
  );
  // Tear down old visible track + train, then place the combined one.
  for (const e of randomEntities) sim.remove(e);
  randomEntities.length = 0;
  placeTrackOnGraph(combined.graph, combined.stations);
}

function updateSwitches(
  track: JunctionTrack,
  train: GraphTrain,
  graph: ReturnType<typeof generateRandomGraphTrack>['graph'],
): void {
  const currentEdge = (train as unknown as { currentEdge: typeof graph.edges[number] }).currentEdge;
  const direction = (train as unknown as { direction: 1 | -1 }).direction;
  const heading = direction === 1 ? currentEdge.to : currentEdge.from;
  const target = (train as unknown as { currentTargetNode(): typeof graph.nodes[number] }).currentTargetNode();
  const path = target === heading ? [] : graph.shortestPath(heading, target) ?? [];
  // Walk the planned path; at every TEE sub-node we cross, record the
  // outgoing exit direction so the chevron at that cell can point there.
  const states = new Map<string, 'N' | 'E' | 'S' | 'W'>();
  let node = heading;
  for (const edge of path) {
    if (node.mainSide !== undefined) {
      const key = `${node.gridX},${node.gridZ}`;
      if (!states.has(key)) {
        const exitPort = edge.from === node ? edge.fromExitPort : edge.toEntryPort;
        states.set(key, exitPort);
      }
    }
    node = edge.from === node ? edge.to : edge.from;
  }
  track.setSwitchStates(states);
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

// ----- UI -----

mountHUD(sim, {
  setNumber: '40786',
  setName: 'Micro Train Centre',
  subtitle: tracked && hasTelemetry(tracked.entity) ? 'Classic Space · Telemetry' : 'Classic Space',
  trackedVehicle: tracked && hasTelemetry(tracked.entity) ? tracked.entity : undefined,
  onWFCTrack: wfcTrack,
  onTimeOfDay: (dayNess) => { dayNightCycle.lockTo(dayNess); },
  trains: activeTrains,
  onSelectTrain,
  onTogglePOV: (active) => {
    if (!active || !currentTrain) {
      sim.cameraOverride = undefined;
      return;
    }
    const fwd = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    sim.cameraOverride = () => {
      const loco = currentTrain!.locomotive;
      // World-space forward for a +X-facing train mesh.
      fwd.set(1, 0, 0).applyQuaternion(loco.quaternion);
      // Eye: just above the locomotive's nose, slightly forward of the cab.
      eye.copy(loco.position).addScaledVector(fwd, 0.65);
      eye.y += 0.4;
      look.copy(eye).addScaledVector(fwd, 2);
      sim.camera.position.copy(eye);
      sim.camera.up.set(0, 1, 0);
      sim.camera.lookAt(look);
    };
  },
  onToggleChase: (active) => {
    if (!active || !currentTrain) {
      sim.cameraOverride = undefined;
      return;
    }
    const fwd = new THREE.Vector3();
    const eye = new THREE.Vector3();
    const look = new THREE.Vector3();
    const targetEye = new THREE.Vector3();
    const targetLook = new THREE.Vector3();
    let init = false;
    sim.cameraOverride = () => {
      const loco = currentTrain!.locomotive;
      fwd.set(1, 0, 0).applyQuaternion(loco.quaternion);
      // Behind + above the locomotive, looking slightly ahead.
      targetEye.copy(loco.position).addScaledVector(fwd, -3.2);
      targetEye.y += 2.4;
      targetLook.copy(loco.position).addScaledVector(fwd, 1.5);
      targetLook.y += 0.3;
      // Smooth follow so the camera doesn't snap on turns.
      if (!init) { eye.copy(targetEye); look.copy(targetLook); init = true; }
      else { eye.lerp(targetEye, 0.12); look.lerp(targetLook, 0.18); }
      sim.camera.position.copy(eye);
      sim.camera.up.set(0, 1, 0);
      sim.camera.lookAt(look);
    };
  },
});

sim.start();

// Expose for debugging from the browser console
if (import.meta.env.DEV) {
  (window as unknown as { sim: Sim }).sim = sim;
}

// Auto-trigger WFC if ?wfc-seed=N is in the URL. Used by the Playwright
// screenshot pipeline so the dashboard's 3D render matches the seed
// recorded in the batch metadata.
{
  const p = new URLSearchParams(window.location.search);
  const wfcSeed = p.get('wfc-seed');
  if (wfcSeed !== null) {
    // Defer by a frame so the scene mounts cleanly before WFC builds.
    requestAnimationFrame(() => wfcTrack(Number(wfcSeed)));
  }
  // For headless screenshots: optional ?nohud=1 hides the HUD panels.
  if (p.get('nohud') === '1') {
    const hudRoot = document.getElementById('ui-root');
    if (hudRoot) hudRoot.style.display = 'none';
  }
}
