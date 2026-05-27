import * as THREE from 'three';
import { Sim } from './sim/Sim';
import { mountHUD } from './ui/hud';
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
import { generateRandomGraphTrack } from './world/trackGraphGenerators';
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
// the manifest's lighting setup added to the scene.
addEntity('day-night-cycle', () => new DayNightCycle(sim));

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
// Optional pin: ?seed=N in the URL forces every "random" roll to use the
// same seed, so a layout can be reproduced for debugging. The HUD click
// of "Random Track" still re-rolls a NEW random seed (unless ?seed is
// present at page load — then it sticks).
const URL_SEED = (() => {
  const p = new URLSearchParams(window.location.search);
  const v = p.get('seed');
  return v ? Number(v) : null;
})();
function randomizeTrack(): void {
  for (const e of randomEntities) sim.remove(e);
  randomEntities.length = 0;
  const seed = URL_SEED ?? Math.floor(Math.random() * 1_000_000);
  console.log(`track seed: ${seed} (pin with ?seed=${seed})`);
  const mulberry = mulberry32(seed);
  const { graph, stations } = generateRandomGraphTrack(mulberry);
  const track = sim.add(new JunctionTrack({ graph, position: [0, 0.02, 0] }));
  randomEntities.push(track);
  if (stations.length >= 2) {
    const train = sim.add(new GraphTrain({
      graph,
      targetCycle: stations,
      startAt: stations[0],
    }));
    train.object3d.position.y += 0.02;
    randomEntities.push(train);
    currentTrain = train;

    // Per-frame switch updater: aims each junction's arrow toward the
    // exit port the train will take when it next reaches that junction.
    const switchUpdater: Entity = {
      object3d: new THREE.Group(),
      update: () => updateSwitches(track, train, graph),
    };
    randomEntities.push(sim.add(switchUpdater));
  }
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
// Grid overlay — toggled by the 🟦 Grid button. Spans the full base plate
// (±BASE_SIZE), with cyan lines on every TILE_SIZE cell boundary. Floats
// above the deck so it's always visible (depthTest off + high renderOrder).
const gridGroup = (() => {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({
    color: 0x00ffff,
    transparent: true,
    opacity: 0.85,
    depthTest: false,
    depthWrite: false,
  });
  const tile = 2.4;
  const PLATE_HALF = 28; // BASE_SIZE
  const span = 2 * PLATE_HALF;
  const halfCells = Math.ceil(PLATE_HALF / tile); // 12
  const lineThickness = 0.06;
  const yLine = 1.6;
  for (let i = -halfCells; i <= halfCells; i++) {
    const x = (i + 0.5) * tile;
    if (Math.abs(x) > PLATE_HALF + tile) continue;
    const v = new THREE.Mesh(new THREE.BoxGeometry(lineThickness, 0.01, span), mat);
    v.position.set(x, yLine, 0);
    v.renderOrder = 999;
    g.add(v);
    const h2 = new THREE.Mesh(new THREE.BoxGeometry(span, 0.01, lineThickness), mat);
    h2.position.set(0, yLine, x);
    h2.renderOrder = 999;
    g.add(h2);
  }
  g.visible = false;
  return g;
})();
sim.scene.add(gridGroup);

mountHUD(sim, {
  setNumber: '40786',
  setName: 'Micro Command Centre',
  subtitle: tracked && hasTelemetry(tracked.entity) ? 'Classic Space · Telemetry' : 'Classic Space',
  trackedVehicle: tracked && hasTelemetry(tracked.entity) ? tracked.entity : undefined,
  onRandomizeTrack: randomizeTrack,
  onToggleGrid: (active) => { gridGroup.visible = active; },
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
});

sim.start();

// Expose for debugging from the browser console
if (import.meta.env.DEV) {
  (window as unknown as { sim: Sim }).sim = sim;
}
