import * as THREE from 'three';
import {
  TRACK_OUTER,
  TRACK_INNER,
  TRACK_CORNER_R_OUT,
  TRACK_CORNER_R_IN,
} from './constants';

/** Build a closed rounded-square Catmull-Rom curve along the track centerline. */
function buildTrackCurve(): THREE.CatmullRomCurve3 {
  const sz = (TRACK_OUTER + TRACK_INNER) / 2;
  const r = (TRACK_CORNER_R_OUT + TRACK_CORNER_R_IN) / 2;

  const corners = [
    { cx: sz - r, cz: sz - r, a0: 0 },
    { cx: -sz + r, cz: sz - r, a0: Math.PI / 2 },
    { cx: -sz + r, cz: -sz + r, a0: Math.PI },
    { cx: sz - r, cz: -sz + r, a0: (3 * Math.PI) / 2 },
  ];

  const cornerSegs = 10;
  const straightSegs = 6;
  const pts: THREE.Vector3[] = [];

  for (let i = 0; i < 4; i++) {
    const c = corners[i]!;
    // Corner arc
    for (let j = 0; j <= cornerSegs; j++) {
      const a = c.a0 + (j / cornerSegs) * (Math.PI / 2);
      pts.push(new THREE.Vector3(c.cx + r * Math.cos(a), 0, c.cz + r * Math.sin(a)));
    }
    // Straight segment to next corner
    const next = corners[(i + 1) % 4]!;
    const endPt = new THREE.Vector3(
      c.cx + r * Math.cos(c.a0 + Math.PI / 2),
      0,
      c.cz + r * Math.sin(c.a0 + Math.PI / 2),
    );
    const startPt = new THREE.Vector3(
      next.cx + r * Math.cos(next.a0),
      0,
      next.cz + r * Math.sin(next.a0),
    );
    for (let j = 1; j < straightSegs; j++) {
      const t = j / straightSegs;
      pts.push(new THREE.Vector3().lerpVectors(endPt, startPt, t));
    }
  }

  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

/** The monorail loop. Use `.getPointAt(t)` and `.getTangentAt(t)` with t in [0, 1). */
export const trackPath = buildTrackCurve();
