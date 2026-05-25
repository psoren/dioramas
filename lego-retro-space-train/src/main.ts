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

// Runtime "🎲 Random track" button — disposes the previous random track
// (if any) and adds a fresh extruded TileTrack at the centre of the plate.
const randomTracks: TileTrack[] = [];
function randomizeTrack(): void {
  for (const t of randomTracks) sim.remove(t);
  randomTracks.length = 0;
  const roll = Math.random();
  // 40% twin-track mode: two perpendicular tracks crossing each other,
  // producing multiple visual intersections without needing CROSS_NESW
  // on a single walk. Each track is its own loop.
  // 35% random figure-8 with randomised lobe sizes (one self-crossing).
  // 25% extruded random shape with a ramp bridge (no crossings).
  if (roll < 0.4) {
    // Twin: a random figure-8 + a perpendicular smaller figure-8 offset
    // so they actually cross visually.
    randomTracks.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      randomFigure8: true,
      seed: Math.floor(Math.random() * 1_000_000),
    })));
    randomTracks.push(sim.add(new TileTrack({
      position: [0, 0.06, 0],
      extruded: { iterations: 3 },
      seed: Math.floor(Math.random() * 1_000_000),
    })));
  } else if (roll < 0.75) {
    randomTracks.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      randomFigure8: true,
      seed: Math.floor(Math.random() * 1_000_000),
    })));
  } else {
    randomTracks.push(sim.add(new TileTrack({
      position: [0, 0.02, 0],
      extruded: { iterations: 4, bridges: 1 },
      seed: Math.floor(Math.random() * 1_000_000),
    })));
  }
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
