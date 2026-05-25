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
import { GROUND_OBJECT_Y, LAUNCHPAD_GROUND_Y } from './constants';

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
  { id: 'moon', kind: 'moonSurface' },
  { id: 'earth', kind: 'earth' },
  { id: 'meteor-shower', kind: 'meteorShower' },
  { id: 'base', kind: 'basePlate' },
  { id: 'road-surface', kind: 'roadRing' },
  // === MIGRATION: old track network removed. See NOTES_BEFORE_MIGRATION.md ===
  // The seven hand-built TrackPath routes + 7 trains + 14 stations + 14
  // loaders + 2 cross-route intersections were stripped here. They'll be
  // rebuilt on top of the new tile system, one piece at a time. The first
  // new-system render is `main-tile-track` below.
  { id: 'command-centre', kind: 'commandCentre' },
  // Buildings spread across the open ground between/around the loops.
  // Flying entities sit at fixed altitudes; ground entities use the shared
  // GROUND_OBJECT_Y so they line up consistently.
  { id: 'micro-rocket-launchpad', kind: 'microRocketLaunchpad', position: [8.0, LAUNCHPAD_GROUND_Y, -8.0], heading: 0 },
  { id: 'mtron-magnetizer', kind: 'mtronMagnetizer', position: [-8.0, 3.5, -8.0], heading: Math.PI / 2 },
  { id: 'ice-planet-defender', kind: 'icePlanetDefender', position: [-8.0, LAUNCHPAD_GROUND_Y, 8.0], heading: -Math.PI / 2 },
  { id: 'space-police-cruiser', kind: 'spacePoliceCruiser', position: [10.5, 3.0, 0.0], heading: Math.PI },
  { id: 'galaxy-explorer-flyover', kind: 'galaxyExplorerShip', position: [8.0, 4.0, 8.0], heading: -Math.PI / 4 },
  { id: 'galaxy-rover', kind: 'galaxyExplorerRover', position: [-2.5, GROUND_OBJECT_Y, 8.5], heading: 0 },
  { id: 'robot-helper', kind: 'robotHelper', position: [2.5, GROUND_OBJECT_Y, 8.5], heading: Math.PI / 2 },
  { id: 'blacktron-cruiser', kind: 'blacktronCruiser', position: [0.0, 4.5, -10.5], heading: -Math.PI / 2 },
  { id: 'blacktron-outpost', kind: 'blacktronOutpost', position: [-2.5, GROUND_OBJECT_Y, -8.5], heading: Math.PI / 2 },
  { id: 'rear-elevator', kind: 'elevator' },
  { id: 'station-astronaut', kind: 'microAstronaut', position: [-6.0, 0.0, 6.0], heading: Math.PI },
  { id: 'elevator-astronaut', kind: 'microAstronaut', position: [-7.0, 0.0, -3.5], heading: Math.PI / 2 },
  // Road trucks share a single direction so they can't head-on collide.
  // truck-a is a cargo runner shuttling between the two container depots —
  // loads at the north depot (t≈0.25), unloads at the south depot (t≈0.75).
  {
    id: 'truck-a',
    kind: 'spaceTruck',
    speed: 0.035,
    t: 0.08,
    cargoStops: [
      { t: 0.25, action: 'load',   label: 'north depot' },
      { t: 0.75, action: 'unload', label: 'south depot' },
    ],
  },
  { id: 'truck-b', kind: 'spaceTruck', speed: 0.022, t: 0.5 },
  // Container depots either side of the road. Trucks pick up at north,
  // deliver to south.
  { id: 'depot-north', kind: 'containerDepot', position: [0, 0.05, 13], heading: 0 },
  { id: 'depot-south', kind: 'containerDepot', position: [0, 0.05, -13], heading: Math.PI },
  // First track rendered with the new tile system — a 4×4 rectangle loop
  // centred on the baseplate, surrounding the command centre.
  {
    id: 'main-tile-track',
    kind: 'tileTrack',
    position: [0, 0.02, 0],
  },
  // First train on the new system. References `main-tile-track` via
  // `tileTrackId` instead of a routeId; the manifest builder grabs the
  // tile-track entity's `.path` and feeds it to MonorailTrain.
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
  // Astronaut apartment on the moon surface — pedestrians use it as "home".
  // Door faces the baseplate (heading rotates +X toward origin).
  { id: 'apartment-1', kind: 'apartmentBuilding', position: [-16, 0.02, 10], heading: Math.PI * 0.75 },
  // Solar farm on the opposite side. Panels track the sun through the day/night cycle.
  { id: 'solar-farm-1', kind: 'solarFarm', position: [16, 0.02, -10], heading: 0 },
  // Pedestrian astronauts wandering the moon surface around the baseplate.
  // `t` is used as a per-instance speed jitter (see manifest builder).
  { id: 'pedestrian-1', kind: 'astronautPedestrian', t: 0.0 },
  { id: 'pedestrian-2', kind: 'astronautPedestrian', t: 0.12 },
  { id: 'pedestrian-3', kind: 'astronautPedestrian', t: 0.27 },
  { id: 'pedestrian-4', kind: 'astronautPedestrian', t: 0.34 },
  { id: 'pedestrian-5', kind: 'astronautPedestrian', t: 0.42 },
  { id: 'pedestrian-6', kind: 'astronautPedestrian', t: 0.05 },
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
