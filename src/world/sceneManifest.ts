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
import { CrossRouteIntersection } from '../entities/CrossRouteIntersection';
import { MoonSurface } from '../entities/MoonSurface';
import { trackPath, crossRouteCrossings } from './TrackPath';
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
  | 'spacePoliceCruiser'
  | 'crossRouteIntersection'
  | 'moonSurface';

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
  /** For crossRouteIntersection: which named crossing to use. */
  crossingId?: string;
}

export interface BuiltSceneEntity {
  spec: SceneEntitySpec;
  entity: Entity;
}

export const defaultSceneManifest: SceneEntitySpec[] = [
  { id: 'moon', kind: 'moonSurface' },
  { id: 'base', kind: 'basePlate' },
  { id: 'road-surface', kind: 'roadRing' },
  // Seven independent routes
  { id: 'track-ring', kind: 'trackRing', routeId: 'ring' },
  { id: 'track-nw', kind: 'trackRing', routeId: 'nw' },
  { id: 'track-ne', kind: 'trackRing', routeId: 'ne' },
  { id: 'track-sw', kind: 'trackRing', routeId: 'sw' },
  { id: 'track-se', kind: 'trackRing', routeId: 'se' },
  { id: 'track-h', kind: 'trackRing', routeId: 'h' },
  { id: 'track-v', kind: 'trackRing', routeId: 'v' },
  { id: 'command-centre', kind: 'commandCentre' },
  // Station platforms — Futuron hero piece on a corner loop, basic platforms elsewhere.
  { id: 'platform-nw-north', kind: 'futuronStation', routeId: 'nw', stationId: 'nw-north' },
  { id: 'platform-nw-south', kind: 'stationPlatform', routeId: 'nw', stationId: 'nw-south' },
  { id: 'platform-ne-north', kind: 'stationPlatform', routeId: 'ne', stationId: 'ne-north' },
  { id: 'platform-ne-south', kind: 'stationPlatform', routeId: 'ne', stationId: 'ne-south' },
  { id: 'platform-sw-north', kind: 'stationPlatform', routeId: 'sw', stationId: 'sw-north' },
  { id: 'platform-sw-south', kind: 'stationPlatform', routeId: 'sw', stationId: 'sw-south' },
  { id: 'platform-se-north', kind: 'stationPlatform', routeId: 'se', stationId: 'se-north' },
  { id: 'platform-se-south', kind: 'stationPlatform', routeId: 'se', stationId: 'se-south' },
  { id: 'platform-ring-west', kind: 'stationPlatform', routeId: 'ring', stationId: 'ring-west' },
  { id: 'platform-ring-east', kind: 'stationPlatform', routeId: 'ring', stationId: 'ring-east' },
  { id: 'platform-h-west', kind: 'stationPlatform', routeId: 'h', stationId: 'h-west' },
  { id: 'platform-h-east', kind: 'stationPlatform', routeId: 'h', stationId: 'h-east' },
  { id: 'platform-v-north', kind: 'stationPlatform', routeId: 'v', stationId: 'v-north' },
  { id: 'platform-v-south', kind: 'stationPlatform', routeId: 'v', stationId: 'v-south' },
  // Trains: one per route
  { id: 'ring-train', kind: 'monorailTrain', routeId: 'ring', speed: 0.025, t: 0.25, telemetry: true },
  { id: 'nw-train', kind: 'monorailTrain', routeId: 'nw', speed: 0.05, t: 0.5, cars: 1, carSpacing: 0.07 },
  { id: 'ne-train', kind: 'monorailTrain', routeId: 'ne', speed: 0.05, t: 0.5, cars: 1, carSpacing: 0.07 },
  { id: 'sw-train', kind: 'monorailTrain', routeId: 'sw', speed: 0.05, t: 0.5, cars: 1, carSpacing: 0.07 },
  { id: 'se-train', kind: 'monorailTrain', routeId: 'se', speed: 0.05, t: 0.5, cars: 1, carSpacing: 0.07 },
  { id: 'h-train', kind: 'monorailTrain', routeId: 'h', speed: 0.045, t: 0.25, cars: 2, carSpacing: 0.04 },
  { id: 'v-train', kind: 'monorailTrain', routeId: 'v', speed: 0.045, t: 0.25, cars: 2, carSpacing: 0.04 },
  // Cross-route intersections (H expressway crosses outer ring at-grade at x=±9)
  { id: 'crossing-h-ring-west', kind: 'crossRouteIntersection', crossingId: 'h-ring-west', targetIds: ['h-train', 'ring-train'] },
  { id: 'crossing-h-ring-east', kind: 'crossRouteIntersection', crossingId: 'h-ring-east', targetIds: ['h-train', 'ring-train'] },
  // Loaders — paired to each route's train and stations
  { id: 'loader-nw-north', kind: 'stationLoader', routeId: 'nw', stationId: 'nw-north', targetId: 'nw-train' },
  { id: 'loader-nw-south', kind: 'stationLoader', routeId: 'nw', stationId: 'nw-south', targetId: 'nw-train' },
  { id: 'loader-ne-north', kind: 'stationLoader', routeId: 'ne', stationId: 'ne-north', targetId: 'ne-train' },
  { id: 'loader-ne-south', kind: 'stationLoader', routeId: 'ne', stationId: 'ne-south', targetId: 'ne-train' },
  { id: 'loader-sw-north', kind: 'stationLoader', routeId: 'sw', stationId: 'sw-north', targetId: 'sw-train' },
  { id: 'loader-sw-south', kind: 'stationLoader', routeId: 'sw', stationId: 'sw-south', targetId: 'sw-train' },
  { id: 'loader-se-north', kind: 'stationLoader', routeId: 'se', stationId: 'se-north', targetId: 'se-train' },
  { id: 'loader-se-south', kind: 'stationLoader', routeId: 'se', stationId: 'se-south', targetId: 'se-train' },
  { id: 'loader-ring-west', kind: 'stationLoader', routeId: 'ring', stationId: 'ring-west', targetId: 'ring-train' },
  { id: 'loader-ring-east', kind: 'stationLoader', routeId: 'ring', stationId: 'ring-east', targetId: 'ring-train' },
  { id: 'loader-h-west', kind: 'stationLoader', routeId: 'h', stationId: 'h-west', targetId: 'h-train' },
  { id: 'loader-h-east', kind: 'stationLoader', routeId: 'h', stationId: 'h-east', targetId: 'h-train' },
  { id: 'loader-v-north', kind: 'stationLoader', routeId: 'v', stationId: 'v-north', targetId: 'v-train' },
  { id: 'loader-v-south', kind: 'stationLoader', routeId: 'v', stationId: 'v-south', targetId: 'v-train' },
  // Buildings — repositioned for the bigger plate. Things are spread out across the open
  // ground between/around loops. Flying entities raised a bit to clear the V overpass.
  { id: 'micro-rocket-launchpad', kind: 'microRocketLaunchpad', position: [8.0, 0.06, -8.0], heading: 0 },
  { id: 'mtron-magnetizer', kind: 'mtronMagnetizer', position: [-8.0, 3.5, -8.0], heading: Math.PI / 2 },
  { id: 'ice-planet-defender', kind: 'icePlanetDefender', position: [-8.0, 0.06, 8.0], heading: -Math.PI / 2 },
  { id: 'space-police-cruiser', kind: 'spacePoliceCruiser', position: [10.5, 3.0, 0.0], heading: Math.PI },
  { id: 'galaxy-explorer-flyover', kind: 'galaxyExplorerShip', position: [8.0, 4.0, 8.0], heading: -Math.PI / 4 },
  { id: 'galaxy-rover', kind: 'galaxyExplorerRover', position: [-2.5, 0.08, 8.5], heading: 0 },
  { id: 'robot-helper', kind: 'robotHelper', position: [2.5, 0.08, 8.5], heading: Math.PI / 2 },
  { id: 'blacktron-cruiser', kind: 'blacktronCruiser', position: [0.0, 4.5, -10.5], heading: -Math.PI / 2 },
  { id: 'blacktron-outpost', kind: 'blacktronOutpost', position: [-2.5, 0.08, -8.5], heading: Math.PI / 2 },
  { id: 'rear-elevator', kind: 'elevator' },
  { id: 'station-astronaut', kind: 'microAstronaut', position: [-6.0, 0.0, 6.0], heading: Math.PI },
  { id: 'elevator-astronaut', kind: 'microAstronaut', position: [-7.0, 0.0, -3.5], heading: Math.PI / 2 },
  // Both space trucks now run the SAME direction so they can't head-on collide.
  { id: 'truck-a', kind: 'spaceTruck', speed: 0.035, t: 0.08 },
  { id: 'truck-b', kind: 'spaceTruck', speed: 0.022, t: 0.5 },
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
    case 'moonSurface':
      return new MoonSurface();
    case 'crossRouteIntersection': {
      const crossing = crossRouteCrossings.find((c) => c.id === spec.crossingId);
      if (!crossing) throw new Error(`No cross-route crossing found with id "${spec.crossingId ?? ''}"`);
      const trainsByCrossing = crossing.trains.map(({ trainId, tValue }) => {
        const entity = registry.get(trainId);
        if (!(entity instanceof MonorailTrain)) {
          throw new Error(`CrossRouteIntersection target "${trainId}" must be a MonorailTrain`);
        }
        return { trainId, train: entity, tValue };
      });
      return new CrossRouteIntersection({ crossing, trains: trainsByCrossing });
    }
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
