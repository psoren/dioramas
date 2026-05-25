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
import { TileTrack } from './entities/TileTrack';
import { JunctionTrack } from './entities/JunctionTrack';
import { GraphTrain } from './entities/GraphTrain';
import { generatePassingSiding } from './world/trackGraphGenerators';
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
// added (track + maybe a train) and rebuilds. Four flavors:
//   - figure-8: one parametric self-crossing.
//   - extruded + ramp bridge: organic shape, no crossings, one elevation.
//   - twisted: extruded shape + algorithmic twist op for ≥1 crossing.
//   - passing-siding: graph mode with TEE junctions + a train alternating
//     between two stations and choosing branches by destination.
const randomEntities: Entity[] = [];
function randomizeTrack(): void {
  for (const e of randomEntities) sim.remove(e);
  randomEntities.length = 0;
  const roll = Math.random();
  const seed = Math.floor(Math.random() * 1_000_000);
  if (roll < 0.25) {
    randomEntities.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      randomFigure8: true,
      seed,
    })));
  } else if (roll < 0.5) {
    randomEntities.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      extruded: { iterations: 4, bridges: 1 },
      seed,
    })));
  } else if (roll < 0.75) {
    randomEntities.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      twisted: { iterations: 2, targetCrossings: 2 },
      seed,
    })));
  } else {
    // Passing siding: build the graph, mount a JunctionTrack, spawn a train
    // that alternates between the two stations.
    const mulberry = mulberry32(seed);
    const { graph, stations } = generatePassingSiding(mulberry);
    const track = sim.add(new JunctionTrack({ graph, position: [0, 0.02, 0] }));
    randomEntities.push(track);
    if (stations.length >= 2) {
      const train = sim.add(new GraphTrain({
        graph,
        targetCycle: stations,
        startAt: stations[0],
      }));
      // Match the track's container translation so the train sits on the rails.
      train.object3d.position.y += 0.02;
      randomEntities.push(train);
    }
  }
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
  setName: 'Micro Command Centre',
  subtitle: tracked && hasTelemetry(tracked.entity) ? 'Classic Space · Telemetry' : 'Classic Space',
  trackedVehicle: tracked && hasTelemetry(tracked.entity) ? tracked.entity : undefined,
  onRandomizeTrack: randomizeTrack,
});

sim.start();

// Expose for debugging from the browser console
if (import.meta.env.DEV) {
  (window as unknown as { sim: Sim }).sim = sim;
}
