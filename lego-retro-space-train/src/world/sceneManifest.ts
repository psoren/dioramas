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
import { TileTrackCrossing } from '../entities/TileTrackCrossing';
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
  | 'tileTrack'
  | 'tileTrackCrossing';

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
  /** For monorailTrain or stationPlatform: tile-track entity ID to attach to. */
  tileTrackId?: string;
  /** For stationPlatform / stationLoader: which tile cell on `tileTrackId`. */
  cell?: [number, number];
  /** For stationLoader on a tile track: station IDs to ship cargo to. */
  destinationIds?: string[];
  /** For tileTrack: explicit rectangle layout in grid coords. */
  rectangle?: { gx0: number; gz0: number; gx1: number; gz1: number };
  /** For tileTrackCrossing: which trains share the cell, with cell + priority. */
  crossingTrains?: Array<{
    trainId: string;
    trackId: string;
    cell: [number, number];
    priority: number;
  }>;
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
  // Central tile-system track: 4×4 cells centred on the baseplate origin.
  {
    id: 'main-tile-track',
    kind: 'tileTrack',
    position: [0, 0.02, 0],
    rectangle: { gx0: -2, gz0: -2, gx1: 2, gz1: 2 },
  },
  // A second, smaller loop out on the moon to validate the multi-track case.
  {
    id: 'moon-tile-track',
    kind: 'tileTrack',
    position: [13, 0.02, -13],
    rectangle: { gx0: -1, gz0: -1, gx1: 1, gz1: 1 },
  },
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
  // Two tile-cell-based stations on opposite edges of the loop. Position
  // and heading are derived entirely from the tile-track's layout.
  { id: 'station-north', kind: 'stationPlatform', tileTrackId: 'main-tile-track', cell: [0, -2] },
  { id: 'station-south', kind: 'stationPlatform', tileTrackId: 'main-tile-track', cell: [0, 2] },
  // Loaders connecting each station to the train; cargo cycles back and forth.
  {
    id: 'loader-north',
    kind: 'stationLoader',
    tileTrackId: 'main-tile-track',
    cell: [0, -2],
    targetId: 'main-tile-train',
    destinationIds: ['station-south'],
  },
  {
    id: 'loader-south',
    kind: 'stationLoader',
    tileTrackId: 'main-tile-track',
    cell: [0, 2],
    targetId: 'main-tile-train',
    destinationIds: ['station-north'],
  },
  // Second train: runs the smaller moon loop.
  {
    id: 'moon-tile-train',
    kind: 'monorailTrain',
    tileTrackId: 'moon-tile-track',
    speed: 0.06,
    t: 0.0,
    cars: 0,
    carSpacing: 0,
  },
  // Express track: a wide flat rectangle crossing through the main loop's
  // east and west sides. Sharing cells (-2,-1) and (2,-1) with main, plus
  // (-2,1) and (2,1) on its S edge.
  {
    id: 'express-tile-track',
    kind: 'tileTrack',
    position: [0, 0.02, 0],
    rectangle: { gx0: -4, gz0: -1, gx1: 4, gz1: 1 },
  },
  {
    id: 'express-tile-train',
    kind: 'monorailTrain',
    tileTrackId: 'express-tile-track',
    speed: 0.055,
    t: 0.25,
    cars: 0,
    carSpacing: 0,
  },
  // Intersection at the cell shared between main's W edge and express's N edge.
  // Main train has higher priority — express yields when main is in the cell.
  {
    id: 'crossing-w-mid',
    kind: 'tileTrackCrossing',
    crossingTrains: [
      { trainId: 'main-tile-train',    trackId: 'main-tile-track',    cell: [-2, -1], priority: 2 },
      { trainId: 'express-tile-train', trackId: 'express-tile-track', cell: [-2, -1], priority: 1 },
    ],
  },
  {
    id: 'crossing-e-mid',
    kind: 'tileTrackCrossing',
    crossingTrains: [
      { trainId: 'main-tile-train',    trackId: 'main-tile-track',    cell: [2, -1], priority: 2 },
      { trainId: 'express-tile-train', trackId: 'express-tile-track', cell: [2, -1], priority: 1 },
    ],
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
      if (spec.tileTrackId && spec.cell) {
        return new StationPlatform(stationPlatformOnTile(spec, registry));
      }
      return new StationPlatform(stationPlatformOptions(spec));
    case 'elevator':
      return new Elevator();
    case 'stationLoader': {
      const target = spec.targetId ? registry.get(spec.targetId) : undefined;
      if (!(target instanceof MonorailTrain)) {
        throw new Error(`StationLoader target "${spec.targetId ?? ''}" must be a MonorailTrain`);
      }
      if (spec.tileTrackId && spec.cell) {
        return new StationLoader(target, stationLoaderOnTile(spec, registry));
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
        rectangle: spec.rectangle ?? { gx0: -2, gz0: -2, gx1: 2, gz1: 2 },
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
    case 'tileTrackCrossing': {
      if (!spec.crossingTrains) throw new Error('tileTrackCrossing needs crossingTrains');
      const trains = spec.crossingTrains.map(({ trainId, trackId, cell, priority }) => {
        const train = registry.get(trainId);
        const track = registry.get(trackId);
        if (!(train instanceof MonorailTrain)) throw new Error(`crossingTrains: ${trainId} is not a MonorailTrain`);
        if (!(track instanceof TileTrack)) throw new Error(`crossingTrains: ${trackId} is not a TileTrack`);
        return { train, track, cell, priority };
      });
      return new TileTrackCrossing({ id: spec.id, trains });
    }
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

/** Distance (units) from the rail centreline to the station platform's centre. */
const STATION_LATERAL_OFFSET = 1.15;
/** Platform Y so it sits on the baseplate. */
const STATION_Y = 0.32;

/** Sample the tile-track at a cell to recover (position, queueDir, t, heading)
 *  used by both the platform builder and the loader builder. */
function tileCellSample(
  spec: SceneEntitySpec,
  registry: ReadonlyMap<string, Entity>,
): {
  worldPos: THREE.Vector3Tuple;
  queueDir: THREE.Vector3Tuple;
  tValue: number;
  heading: number;
} {
  const tt = registry.get(spec.tileTrackId!);
  if (!(tt instanceof TileTrack)) {
    throw new Error(`tileTrackId "${spec.tileTrackId}" must point at a TileTrack`);
  }
  const [gx, gz] = spec.cell!;
  const span = tt.loop.tileSpans.find((s) => s.gridX === gx && s.gridZ === gz);
  if (!span) {
    throw new Error(`No tile at cell (${gx},${gz}) on tileTrack "${spec.tileTrackId}"`);
  }
  const tMid = (span.tStart + span.tEnd) / 2;
  const localP = tt.path.getPointAt(tMid);
  const tan = tt.path.getTangentAt(tMid);
  const perpX = tan.z;
  const perpZ = -tan.x;
  const trackPos = tt.object3d.position;
  const px = trackPos.x + localP.x + perpX * STATION_LATERAL_OFFSET;
  const pz = trackPos.z + localP.z + perpZ * STATION_LATERAL_OFFSET;
  return {
    worldPos: [px, STATION_Y, pz],
    // queueDirection points from the rail toward the platform.
    queueDir: [perpX, 0, perpZ],
    tValue: tMid,
    heading: Math.atan2(tan.x, tan.z) - Math.PI / 2,
  };
}

function stationPlatformOnTile(
  spec: SceneEntitySpec,
  registry: ReadonlyMap<string, Entity>,
): { position: THREE.Vector3Tuple; heading: number } {
  const s = tileCellSample(spec, registry);
  return { position: s.worldPos, heading: s.heading };
}

function stationLoaderOnTile(
  spec: SceneEntitySpec,
  registry: ReadonlyMap<string, Entity>,
): {
  stationPosition: THREE.Vector3Tuple;
  stationQueueDirection: THREE.Vector3Tuple;
  stationT: number;
  stationId: string;
  destinationIds: string[];
} {
  const s = tileCellSample(spec, registry);
  return {
    stationPosition: s.worldPos,
    stationQueueDirection: s.queueDir,
    stationT: s.tValue,
    stationId: spec.id,
    destinationIds: spec.destinationIds ?? [],
  };
}

export function signedSpeed(spec: SceneEntitySpec, fallback: number): number {
  const magnitude = spec.speed ?? fallback;
  return magnitude * (spec.direction ?? 1);
}

export function hasTelemetry(entity: Entity): entity is Entity & { speed: number; laps: number } {
  return 'speed' in entity && 'laps' in entity;
}
