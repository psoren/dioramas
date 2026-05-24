import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { BasePlate } from '../entities/BasePlate';
import { RoadRing } from '../entities/RoadRing';
import { TrackRing } from '../entities/TrackRing';
import { CommandCentre } from '../entities/CommandCentre';
import { StationPlatform } from '../entities/StationPlatform';
import { Elevator } from '../entities/Elevator';
import { MicroAstronaut } from '../entities/MicroAstronaut';
import { MonorailTrain } from '../entities/MonorailTrain';
import { SpaceTruck } from '../entities/SpaceTruck';
import { StationLoader } from '../entities/StationLoader';
import { TrackController } from '../entities/TrackController';
import {
  BlacktronCruiser,
  BlacktronOutpost,
  FuturonStation,
  GalaxyExplorerRover,
  GalaxyExplorerShip,
  IcePlanetDefender,
  MicroRocketLaunchpad,
  MTronMagnetizer,
  RobotHelper,
  SpacePoliceCruiser,
} from '../entities/retroSets';
import { trackPath } from './TrackPath';
import { roadPath } from './RoadPath';
import { getTrackRoute } from './TrackPath';

export type EntityKind =
  | 'basePlate'
  | 'roadRing'
  | 'trackRing'
  | 'commandCentre'
  | 'stationPlatform'
  | 'elevator'
  | 'stationLoader'
  | 'trackController'
  | 'microAstronaut'
  | 'monorailTrain'
  | 'spaceTruck'
  | 'microRocketLaunchpad'
  | 'galaxyExplorerShip'
  | 'galaxyExplorerRover'
  | 'robotHelper'
  | 'blacktronCruiser'
  | 'blacktronOutpost'
  | 'futuronStation'
  | 'mtronMagnetizer'
  | 'icePlanetDefender'
  | 'spacePoliceCruiser';

export interface SceneEntitySpec {
  id: string;
  kind: EntityKind;
  position?: THREE.Vector3Tuple;
  heading?: number;
  speed?: number;
  t?: number;
  direction?: 1 | -1;
  track?: 'monorail' | 'road';
  telemetry?: boolean;
  targetId?: string;
  targetIds?: string[];
  routeId?: string;
  stationId?: string;
  cars?: number;
  carSpacing?: number;
}

export interface BuiltSceneEntity {
  spec: SceneEntitySpec;
  entity: Entity;
}

export const defaultSceneManifest: SceneEntitySpec[] = [
  { id: 'base', kind: 'basePlate' },
  { id: 'road-surface', kind: 'roadRing' },
  { id: 'monorail-track-main', kind: 'trackRing', routeId: 'main' },
  { id: 'monorail-track-aux', kind: 'trackRing', routeId: 'aux' },
  { id: 'monorail-track-shuttle', kind: 'trackRing', routeId: 'shuttle' },
  { id: 'command-centre', kind: 'commandCentre' },
  // Station platforms
  { id: 'station-command-platform', kind: 'stationPlatform', routeId: 'main', stationId: 'command-station' },
  // Futuron hero station replaces the basic platform at north-depot.
  { id: 'station-north-platform', kind: 'futuronStation', routeId: 'main', stationId: 'north-depot' },
  { id: 'station-yard-platform', kind: 'stationPlatform', routeId: 'main', stationId: 'south-yard' },
  { id: 'station-ridge-platform', kind: 'stationPlatform', routeId: 'aux', stationId: 'ridge-station' },
  { id: 'station-south-cargo-platform', kind: 'stationPlatform', routeId: 'aux', stationId: 'south-cargo' },
  { id: 'station-shuttle-north-platform', kind: 'stationPlatform', routeId: 'shuttle', stationId: 'shuttle-north' },
  { id: 'station-shuttle-south-platform', kind: 'stationPlatform', routeId: 'shuttle', stationId: 'shuttle-south' },
  // Buildings sit in the strips between the squircle loops and the perimeter road.
  // All positions snap to GRID (0.5) and all headings to the nearest 90 degrees.
  {
    // Moved into the interior of the left loop (north-depot now occupies the old position).
    id: 'micro-rocket-launchpad',
    kind: 'microRocketLaunchpad',
    position: [-3.0, 0.06, 0.0],
    heading: 0,
  },
  // M-Tron flyer (south-west, low altitude)
  {
    id: 'mtron-magnetizer',
    kind: 'mtronMagnetizer',
    position: [-5.5, 3.0, -6.5],
    heading: Math.PI / 2,
  },
  // Ice Planet defender (centre of north strip, grounded on its skis)
  {
    id: 'ice-planet-defender',
    kind: 'icePlanetDefender',
    position: [0.0, 0.06, 6.5],
    heading: -Math.PI / 2,
  },
  // Space Police cruiser (flying east, slowly circling)
  {
    id: 'space-police-cruiser',
    kind: 'spacePoliceCruiser',
    position: [7.0, 2.5, 0.0],
    heading: Math.PI,
  },
  {
    id: 'galaxy-explorer-flyover',
    kind: 'galaxyExplorerShip',
    position: [-2.5, 3.75, -3.0],
    heading: 0,
  },
  {
    id: 'galaxy-rover',
    kind: 'galaxyExplorerRover',
    position: [1.5, 0.08, -6.5],
    heading: 0,
  },
  {
    id: 'robot-helper',
    kind: 'robotHelper',
    position: [-2.5, 0.08, -6.5],
    heading: Math.PI / 2,
  },
  {
    id: 'blacktron-cruiser',
    kind: 'blacktronCruiser',
    position: [5.0, 2.5, 6.5],
    heading: -Math.PI / 2,
  },
  {
    id: 'blacktron-outpost',
    kind: 'blacktronOutpost',
    position: [5.5, 0.08, -6.0],
    heading: Math.PI / 2,
  },
  { id: 'rear-elevator', kind: 'elevator' },
  {
    id: 'station-astronaut',
    kind: 'microAstronaut',
    position: [-6.5, 0.0, 3.5],
    heading: Math.PI,
  },
  {
    id: 'elevator-astronaut',
    kind: 'microAstronaut',
    position: [-7.0, 0.0, -3.5],
    heading: Math.PI / 2,
  },
  // Three independent loops, each with its own train cycling cargo with destinations.
  { id: 'main-train', kind: 'monorailTrain', routeId: 'main', speed: 0.045, t: 0.5, telemetry: true },
  { id: 'ridge-train', kind: 'monorailTrain', routeId: 'aux', speed: 0.038, t: 0.5 },
  { id: 'shuttle-train', kind: 'monorailTrain', routeId: 'shuttle', speed: 0.06, t: 0.5, cars: 1, carSpacing: 0.08 },
  // Main route loaders
  { id: 'station-command-loader', kind: 'stationLoader', routeId: 'main', stationId: 'command-station', targetId: 'main-train' },
  { id: 'station-north-loader', kind: 'stationLoader', routeId: 'main', stationId: 'north-depot', targetId: 'main-train' },
  { id: 'station-yard-loader', kind: 'stationLoader', routeId: 'main', stationId: 'south-yard', targetId: 'main-train' },
  // Aux route loaders
  { id: 'station-ridge-loader', kind: 'stationLoader', routeId: 'aux', stationId: 'ridge-station', targetId: 'ridge-train' },
  { id: 'station-south-cargo-loader', kind: 'stationLoader', routeId: 'aux', stationId: 'south-cargo', targetId: 'ridge-train' },
  // Shuttle route loaders
  { id: 'station-shuttle-north-loader', kind: 'stationLoader', routeId: 'shuttle', stationId: 'shuttle-north', targetId: 'shuttle-train' },
  { id: 'station-shuttle-south-loader', kind: 'stationLoader', routeId: 'shuttle', stationId: 'shuttle-south', targetId: 'shuttle-train' },
  { id: 'truck-a', kind: 'spaceTruck', speed: 0.035, t: 0.08 },
  { id: 'truck-b', kind: 'spaceTruck', speed: 0.028, direction: -1, t: 0.58 },
];

export function buildSceneEntity(
  spec: SceneEntitySpec,
  registry: ReadonlyMap<string, Entity> = new Map(),
): Entity {
  switch (spec.kind) {
    case 'basePlate':
      return new BasePlate();
    case 'roadRing':
      return new RoadRing();
    case 'trackRing':
      return new TrackRing({ routeId: spec.routeId });
    case 'commandCentre':
      return new CommandCentre();
    case 'stationPlatform':
      return new StationPlatform(stationPlatformOptions(spec));
    case 'elevator':
      return new Elevator();
    case 'stationLoader': {
      const target = spec.targetId ? registry.get(spec.targetId) : undefined;
      if (!(target instanceof MonorailTrain)) {
        throw new Error(`StationLoader target "${spec.targetId ?? ''}" must be a MonorailTrain`);
      }
      return new StationLoader(target, { routeId: spec.routeId, stationId: spec.stationId });
    }
    case 'trackController': {
      const trains = (spec.targetIds ?? [])
        .map((targetId) => registry.get(targetId))
        .filter((entity): entity is MonorailTrain => entity instanceof MonorailTrain);
      if (trains.length === 0) throw new Error('TrackController needs at least one train target');
      return new TrackController({ routeId: spec.routeId, trains });
    }
    case 'microAstronaut':
      return new MicroAstronaut({
        position: spec.position ?? [0, 0, 0],
        heading: spec.heading,
      });
    case 'monorailTrain':
      return new MonorailTrain({
        path: getTrackRoute(spec.routeId).path,
        speed: signedSpeed(spec, 0.07),
        t: spec.t,
        cars: spec.cars,
        carSpacing: spec.carSpacing,
      });
    case 'spaceTruck':
      return new SpaceTruck({
        path: spec.track === 'monorail' ? trackPath : roadPath,
        speed: signedSpeed(spec, 0.03),
        t: spec.t,
      });
    case 'microRocketLaunchpad':
      return new MicroRocketLaunchpad({ position: spec.position, heading: spec.heading });
    case 'galaxyExplorerShip':
      return new GalaxyExplorerShip({ position: spec.position, heading: spec.heading });
    case 'galaxyExplorerRover':
      return new GalaxyExplorerRover({ position: spec.position, heading: spec.heading });
    case 'robotHelper':
      return new RobotHelper({ position: spec.position, heading: spec.heading });
    case 'blacktronCruiser':
      return new BlacktronCruiser({ position: spec.position, heading: spec.heading });
    case 'blacktronOutpost':
      return new BlacktronOutpost({ position: spec.position, heading: spec.heading });
    case 'futuronStation':
      // If a stationId is given, resolve position/heading from the station def
      // (same convention as StationPlatform). Otherwise use spec.position/heading.
      return new FuturonStation(spec.stationId ? stationPlatformOptions(spec) : { position: spec.position, heading: spec.heading });
    case 'mtronMagnetizer':
      return new MTronMagnetizer({ position: spec.position, heading: spec.heading });
    case 'icePlanetDefender':
      return new IcePlanetDefender({ position: spec.position, heading: spec.heading });
    case 'spacePoliceCruiser':
      return new SpacePoliceCruiser({ position: spec.position, heading: spec.heading });
  }
}

function stationPlatformOptions(spec: SceneEntitySpec): { position?: THREE.Vector3Tuple; heading?: number } {
  const route = getTrackRoute(spec.routeId);
  const station = route.stations.find((candidate) => candidate.id === spec.stationId);
  if (!station) return {};
  const q = new THREE.Vector3().fromArray(station.queueDirection).normalize();
  return {
    position: station.position,
    heading: Math.atan2(q.x, q.z),
  };
}

export function signedSpeed(spec: SceneEntitySpec, fallback: number): number {
  const magnitude = spec.speed ?? fallback;
  return magnitude * (spec.direction ?? 1);
}

export function hasTelemetry(entity: Entity): entity is Entity & { speed: number; laps: number } {
  return 'speed' in entity && 'laps' in entity;
}
