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

/**
 * Cross-route crossing point. Lists every train that passes through the same
 * physical point on its own route, with that train's `t` value when at the
 * crossing. A `CrossRouteIntersection` entity coordinates trains so only one
 * occupies the crossing region at a time.
 */
export interface CrossRouteCrossingDef {
  id: string;
  position: THREE.Vector3Tuple;
  activeRadius: number;       // |t - tValue| within this = the train is AT the crossing
  approachDistance: number;   // forward t-distance within this = approaching
  /** One entry per train that passes through this crossing. */
  trains: Array<{ trainId: string; tValue: number }>;
}

function buildLoop(
  cx: number,
  cz: number,
  hw: number,
  hh: number,
  r: number,
  samples: number,
  y = 0,
): THREE.CatmullRomCurve3 {
  const pts = roundedRectLoop(cx, cz, hw, hh, r, samples, y);
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

// --- Geometry constants -----------------------------------------------------

const CORNER_HW = 2.5;
const CORNER_HH = 2.5;
const CORNER_R = 1.0;
const CORNER_SAMPLES = 32;
const CORNER_OFFSET = 5.0; // corner loop centers at (±5, ±5)

const RING_HW = 9.0;
const RING_HH = 9.0;
const RING_R = 2.0;
const RING_SAMPLES = 60;

const EXPRESS_LONG = 10.5;
const EXPRESS_NARROW = 0.5;
const EXPRESS_R = 0.5;
const EXPRESS_SAMPLES = 56;
const V_EXPRESS_Y = 1.0; // overpass height for the vertical expressway

// --- Route definitions ------------------------------------------------------

const ringPath = buildLoop(0, 0, RING_HW, RING_HH, RING_R, RING_SAMPLES);
const nwPath = buildLoop(-CORNER_OFFSET, CORNER_OFFSET, CORNER_HW, CORNER_HH, CORNER_R, CORNER_SAMPLES);
const nePath = buildLoop(CORNER_OFFSET, CORNER_OFFSET, CORNER_HW, CORNER_HH, CORNER_R, CORNER_SAMPLES);
const swPath = buildLoop(-CORNER_OFFSET, -CORNER_OFFSET, CORNER_HW, CORNER_HH, CORNER_R, CORNER_SAMPLES);
const sePath = buildLoop(CORNER_OFFSET, -CORNER_OFFSET, CORNER_HW, CORNER_HH, CORNER_R, CORNER_SAMPLES);
// H expressway: long flat stadium at z=0, y=0. Spans x in [-EXPRESS_LONG, EXPRESS_LONG].
const hPath = buildLoop(0, 0, EXPRESS_LONG, EXPRESS_NARROW, EXPRESS_R, EXPRESS_SAMPLES);
// V expressway: long vertical stadium at x=0, lifted to y=V_EXPRESS_Y (overpass).
const vPath = buildLoop(0, 0, EXPRESS_NARROW, EXPRESS_LONG, EXPRESS_R, EXPRESS_SAMPLES, V_EXPRESS_Y);

// --- Stations: helper to build a station def from a cardinal position -------
// roundedRectLoop has the following parameterisation:
//   t = 0    -> west middle  (cx - hw, cz)
//   t = 0.25 -> north middle (cx, cz + hh)
//   t = 0.5  -> east middle  (cx + hw, cz)
//   t = 0.75 -> south middle (cx, cz - hh)

function st(
  id: string,
  t: number,
  position: THREE.Vector3Tuple,
  queueDirection: THREE.Vector3Tuple,
): StationDef {
  return { id, t, position, queueDirection };
}

// --- Routes -----------------------------------------------------------------

const ringRoute: TrackRoute = {
  id: 'ring',
  path: ringPath,
  stations: [
    st('ring-west', 0.0, [-10.0, 0, 0], [1, 0, 0]),
    st('ring-east', 0.5, [10.0, 0, 0], [-1, 0, 0]),
  ],
  intersections: [],
};

const nwRoute: TrackRoute = {
  id: 'nw',
  path: nwPath,
  stations: [
    st('nw-north', 0.25, [-CORNER_OFFSET, 0, CORNER_OFFSET + CORNER_HH + 1.0], [0, 0, -1]),
    st('nw-south', 0.75, [-CORNER_OFFSET, 0, CORNER_OFFSET - CORNER_HH - 1.0], [0, 0, 1]),
  ],
  intersections: [],
};

const neRoute: TrackRoute = {
  id: 'ne',
  path: nePath,
  stations: [
    st('ne-north', 0.25, [CORNER_OFFSET, 0, CORNER_OFFSET + CORNER_HH + 1.0], [0, 0, -1]),
    st('ne-south', 0.75, [CORNER_OFFSET, 0, CORNER_OFFSET - CORNER_HH - 1.0], [0, 0, 1]),
  ],
  intersections: [],
};

const swRoute: TrackRoute = {
  id: 'sw',
  path: swPath,
  stations: [
    st('sw-north', 0.25, [-CORNER_OFFSET, 0, -CORNER_OFFSET + CORNER_HH + 1.0], [0, 0, -1]),
    st('sw-south', 0.75, [-CORNER_OFFSET, 0, -CORNER_OFFSET - CORNER_HH - 1.0], [0, 0, 1]),
  ],
  intersections: [],
};

const seRoute: TrackRoute = {
  id: 'se',
  path: sePath,
  stations: [
    st('se-north', 0.25, [CORNER_OFFSET, 0, -CORNER_OFFSET + CORNER_HH + 1.0], [0, 0, -1]),
    st('se-south', 0.75, [CORNER_OFFSET, 0, -CORNER_OFFSET - CORNER_HH - 1.0], [0, 0, 1]),
  ],
  intersections: [],
};

const hRoute: TrackRoute = {
  id: 'h',
  path: hPath,
  stations: [
    st('h-west', 0.0, [-EXPRESS_LONG - 0.7, 0, 0], [1, 0, 0]),
    st('h-east', 0.5, [EXPRESS_LONG + 0.7, 0, 0], [-1, 0, 0]),
  ],
  intersections: [],
};

const vRoute: TrackRoute = {
  id: 'v',
  // V is the overpass; stations sit at the same elevated y.
  path: vPath,
  stations: [
    st('v-north', 0.25, [0, V_EXPRESS_Y, EXPRESS_LONG + 0.7], [0, 0, -1]),
    st('v-south', 0.75, [0, V_EXPRESS_Y, -EXPRESS_LONG - 0.7], [0, 0, 1]),
  ],
  intersections: [],
};

export const trackRoutes: Record<string, TrackRoute> = {
  ring: ringRoute,
  nw: nwRoute,
  ne: neRoute,
  sw: swRoute,
  se: seRoute,
  h: hRoute,
  v: vRoute,
  // 'main' alias to preserve backwards compatibility with any code/manifest
  // entries that still reference the old default. Maps to the H expressway.
  main: hRoute,
};

/** Default monorail route (H expressway). */
export const trackPath = hRoute.path;

export function getTrackRoute(id = 'h'): TrackRoute {
  return trackRoutes[id] ?? hRoute;
}

// --- Cross-route crossings --------------------------------------------------
//
// The H expressway runs at z=0 and crosses the outer ring's east and west
// edges at (±9, 0). Both at y=0, so trains MUST coordinate.
// The V expressway runs at y=V_EXPRESS_Y so it overpasses everything it crosses;
// those crossings are visual-only, no coordination needed.
//
// tValue per train per crossing — computed by hand from the parameterisation:
//   H expressway at z=0: cardinal points at t=0 (W), 0.5 (E). Outer ring east/west
//   at t=0.5 (E)/0 (W). So at (-9, 0), H train is somewhere between t=0 and t=0.5
//   on the lower half of the stadium; specifically, on a stadium with hw=10.5,
//   hh=0.5, r=0.5, the point (-9, 0) is on the bottom-left side, somewhere
//   between sample 35 and 45 out of 112. Approximate t for H at (-9, 0): ~0.07
//   (between W middle at t=0 and the SW corner). And at (9, 0): ~0.43.
//
// We use approximate values; the controller uses `activeRadius` and
// `approachDistance` to handle slight imprecision.

export const crossRouteCrossings: CrossRouteCrossingDef[] = [
  {
    id: 'h-ring-west',
    position: [-9.0, 0.1, 0],
    activeRadius: 0.04,
    approachDistance: 0.10,
    trains: [
      { trainId: 'h-train', tValue: 0.07 },
      { trainId: 'ring-train', tValue: 0.0 },
    ],
  },
  {
    id: 'h-ring-east',
    position: [9.0, 0.1, 0],
    activeRadius: 0.04,
    approachDistance: 0.10,
    trains: [
      { trainId: 'h-train', tValue: 0.43 },
      { trainId: 'ring-train', tValue: 0.5 },
    ],
  },
];
