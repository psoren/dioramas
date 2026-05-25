import * as THREE from 'three';
import { roundedRectLoop } from './grid';

// Half-width / -height match the road visual's centerline in RoadRing.ts
// (outer 11.75, inner 10.85 → centre 11.3). Keep these in sync if the road
// geometry changes.
const ROAD_HW = 11.3;
const ROAD_HH = 11.3;
const ROAD_CORNER_R = 1.5;
const SAMPLES_PER_HALF = 48;

function buildRoadCurve(): THREE.CatmullRomCurve3 {
  const pts = roundedRectLoop(0, 0, ROAD_HW, ROAD_HH, ROAD_CORNER_R, SAMPLES_PER_HALF, 0);
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export const roadPath = buildRoadCurve();
