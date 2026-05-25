import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { BasePlate } from '../entities/BasePlate';
import { RoadRing } from '../entities/RoadRing';
import { TrackRing } from '../entities/TrackRing';
import { CommandCentre } from '../entities/CommandCentre';
import { StationPlatform } from '../entities/StationPlatform';
import { Elevator } from '../entities/Elevator';
import { MicroAstronaut } from '../entities/MicroAstronaut';
import { AstronautPedestrian } from '../entities/AstronautPedestrian';
import { ApartmentBuilding } from '../entities/ApartmentBuilding';
import { SolarFarm } from '../entities/SolarFarm';
import { ContainerDepot } from '../entities/ContainerDepot';
import { CargoStop } from '../entities/SpaceTruck';
import { TileTrack } from '../entities/TileTrack';
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
import { Earth } from '../entities/Earth';
import { MeteorShower } from '../entities/MeteorShower';
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
  | 'moonSurface'
  | 'earth'
  | 'meteorShower'
  | 'astronautPedestrian'
  | 'apartmentBuilding'
  | 'solarFarm'
  | 'containerDepot'
  | 'tileTrack';

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
  /** For spaceTruck: list of cargo pickup/drop stops along the path. */
  cargoStops?: CargoStop[];
  /** For spaceTruck: start the truck with a cargo container shown. */
  startWithCargo?: boolean;
  /** For monorailTrain: tile-track entity ID to attach to. Replaces routeId
   *  for tile-system tracks. */
  tileTrackId?: string;
}

export interface BuiltSceneEntity {
  spec: SceneEntitySpec;
  entity: Entity;
}

export const defaultSceneManifest: SceneEntitySpec[] = [
  // === Stripped-down scene during the tile-system migration ===
  // Everything except essentials is gone so the new tile track is the
  // sole point of focus. We add things back through the new system as
  // the migration proceeds. See NOTES_BEFORE_MIGRATION.md for what was
  // here previously.
  { id: 'moon', kind: 'moonSurface' },
  { id: 'earth', kind: 'earth' },
  { id: 'base', kind: 'basePlate' },
  { id: 'command-centre', kind: 'commandCentre' },
  // Central tile-system track + one train on it.
  { id: 'main-tile-track', kind: 'tileTrack', position: [0, 0.02, 0] },
  {
    id: 'main-tile-train',
    kind: 'monorailTrain',
    tileTrackId: 'main-tile-track',
    speed: 0.045,
    t: 0.0,
    cars: 1,
    carSpacing: 0.05,
    telemetry: true,
  },
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
    case 'monorailTrain': {
      let path: THREE.CatmullRomCurve3;
      if (spec.tileTrackId) {
        const tt = registry.get(spec.tileTrackId);
        if (!(tt instanceof TileTrack)) {
          throw new Error(`monorailTrain tileTrackId "${spec.tileTrackId}" must point at a TileTrack`);
        }
        path = tt.path;
      } else {
        path = getTrackRoute(spec.routeId).path;
      }
      return new MonorailTrain({
        path,
        speed: signedSpeed(spec, 0.07),
        t: spec.t,
        cars: spec.cars,
        carSpacing: spec.carSpacing,
      });
    }
    case 'spaceTruck':
      return new SpaceTruck({
        path: spec.track === 'monorail' ? trackPath : roadPath,
        speed: signedSpeed(spec, 0.03),
        t: spec.t,
        cargoStops: spec.cargoStops,
        startWithCargo: spec.startWithCargo,
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
    case 'earth':
      return new Earth();
    case 'meteorShower':
      return new MeteorShower();
    case 'apartmentBuilding':
      return new ApartmentBuilding({
        position: spec.position ?? [-16, 0.02, 10],
        heading: spec.heading,
      });
    case 'solarFarm':
      return new SolarFarm({
        position: spec.position ?? [16, 0.02, -10],
        heading: spec.heading,
      });
    case 'containerDepot':
      return new ContainerDepot({
        position: spec.position ?? [13, 0.05, 0],
        heading: spec.heading,
      });
    case 'tileTrack':
      return new TileTrack({
        position: spec.position ?? [0, 0.02, 0],
        // 4×4 cell loop centred on origin → spans roughly -4.8..+4.8 in
        // both X and Z with TILE_SIZE=2.4. Surrounds the command centre.
        rectangle: { gx0: -2, gz0: -2, gx1: 2, gz1: 2 },
      });
    case 'astronautPedestrian':
      // Pedestrians wander an annulus around the baseplate on the moon
      // surface. Default bounds keep them off the plate and out of the fog.
      return new AstronautPedestrian({
        innerRadius: 14,
        outerRadius: 22,
        groundY: 0.02,
        speed: 0.5 + ((spec.t ?? 0) % 0.5),
      });
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
