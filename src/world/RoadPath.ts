import * as THREE from 'three';
import { roundedRectLoop } from './grid';

const ROAD_HW = 11.0;
const ROAD_HH = 11.0;
const ROAD_CORNER_R = 1.5;
const SAMPLES_PER_HALF = 48;

function buildRoadCurve(): THREE.CatmullRomCurve3 {
  const pts = roundedRectLoop(0, 0, ROAD_HW, ROAD_HH, ROAD_CORNER_R, SAMPLES_PER_HALF, 0);
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

export const roadPath = buildRoadCurve();
