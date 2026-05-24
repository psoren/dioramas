import * as THREE from 'three';
import { roundedRectLoop } from './grid';

export interface StationDef {
  id: string;
  t: number;
  position: THREE.Vector3Tuple;
  queueDirection: THREE.Vector3Tuple;
}

export interface TrackIntersectionDef {
  id: string;
  tValues: number[];
  position: THREE.Vector3Tuple;
  activeRadius: number;
  approachDistance: number;
}

export interface TrackRoute {
  id: string;
  path: THREE.CatmullRomCurve3;
  stations: StationDef[];
  intersections: TrackIntersectionDef[];
}

const MAIN_HW = 2.5;
const MAIN_HH = 5.0;
const MAIN_R = 1.0;
const MAIN_SAMPLES = 44;
const LEFT_CX = -4;
const RIGHT_CX = 4;

const SHUTTLE_HW = 0.5;
const SHUTTLE_HH = 3.0;
const SHUTTLE_R = 0.5;
const SHUTTLE_SAMPLES = 24;

function buildLoop(
  cx: number,
  cz: number,
  hw: number,
  hh: number,
  r: number,
  samples: number,
): THREE.CatmullRomCurve3 {
  const pts = roundedRectLoop(cx, cz, hw, hh, r, samples);
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

// Three independent loops, all grid-aligned.
// Main loops: 5x10 squircles at (-4, 0) and (4, 0). Gap of 3 units at x in [-1.5, 1.5].
// Shuttle: small vertical pill (1 wide x 6 tall) sitting in the gap, with its own train.
// Sampled with t in [0, 1): t=0 -> west middle, 0.25 -> north, 0.5 -> east, 0.75 -> south.
const leftPath = buildLoop(LEFT_CX, 0, MAIN_HW, MAIN_HH, MAIN_R, MAIN_SAMPLES);
const rightPath = buildLoop(RIGHT_CX, 0, MAIN_HW, MAIN_HH, MAIN_R, MAIN_SAMPLES);
const shuttlePath = buildLoop(0, 0, SHUTTLE_HW, SHUTTLE_HH, SHUTTLE_R, SHUTTLE_SAMPLES);

const mainRoute: TrackRoute = {
  id: 'main',
  path: leftPath,
  stations: [
    {
      id: 'command-station',
      t: 0.0, // west middle (-6.5, 0)
      position: [-7.0, 0.0, 0.0],
      queueDirection: [1, 0, 0],
    },
    {
      id: 'north-depot',
      t: 0.25, // north middle (-4, 5)
      position: [-4.0, 0.0, 6.0],
      queueDirection: [0, 0, -1],
    },
    {
      id: 'south-yard',
      t: 0.75, // south middle (-4, -5)
      position: [-4.0, 0.0, -6.0],
      queueDirection: [0, 0, 1],
    },
  ],
  intersections: [],
};

const auxRoute: TrackRoute = {
  id: 'aux',
  path: rightPath,
  stations: [
    {
      id: 'ridge-station',
      t: 0.25, // north middle (4, 5)
      position: [4.0, 0.0, 6.0],
      queueDirection: [0, 0, -1],
    },
    {
      id: 'south-cargo',
      t: 0.75, // south middle (4, -5)
      position: [4.0, 0.0, -6.0],
      queueDirection: [0, 0, 1],
    },
  ],
  intersections: [],
};

const shuttleRoute: TrackRoute = {
  id: 'shuttle',
  path: shuttlePath,
  stations: [
    {
      id: 'shuttle-north',
      t: 0.25, // north of pill (0, 3)
      position: [0.0, 0.0, 4.0],
      queueDirection: [0, 0, -1],
    },
    {
      id: 'shuttle-south',
      t: 0.75, // south of pill (0, -3)
      position: [0.0, 0.0, -4.0],
      queueDirection: [0, 0, 1],
    },
  ],
  intersections: [],
};

export const trackRoutes: Record<string, TrackRoute> = {
  main: mainRoute,
  aux: auxRoute,
  shuttle: shuttleRoute,
};

/** Default monorail route. */
export const trackPath = mainRoute.path;

export function getTrackRoute(id = 'main'): TrackRoute {
  return trackRoutes[id] ?? mainRoute;
}
