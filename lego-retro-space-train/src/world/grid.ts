import * as THREE from 'three';

/** World units per grid cell. Used to align tracks, stations, and buildings. */
export const GRID = 0.5;

/** Snap a value to the nearest grid line. */
export function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Snap a heading (radians) to the nearest cardinal (0, ±π/2, π). */
export function snapHeading(h: number): number {
  const quarter = Math.PI / 2;
  return Math.round(h / quarter) * quarter;
}

/** Snap an [x, y, z] tuple's x/z to grid. y is left untouched. */
export function snapPosition(p: THREE.Vector3Tuple): THREE.Vector3Tuple {
  return [snap(p[0]), p[1], snap(p[2])];
}

/**
 * Returns points along the top or bottom half of a rounded rectangle.
 * The half always starts at the west-middle (cx - hw, cz) and ends at the
 * east-middle (cx + hw, cz), so two halves trivially compose into a full loop.
 *
 * Geometry per half:
 *   - vertical segment of length (hh - r) along the west edge
 *   - quarter-circle of radius r at the far corner (NW for top, SW for bottom)
 *   - horizontal segment of length 2*(hw - r) along the far edge
 *   - quarter-circle of radius r at the other far corner (NE/SE)
 *   - vertical segment of length (hh - r) along the east edge back to cz
 *
 * Sampled at equal arc-length intervals so a CatmullRomCurve3 through the
 * points stays close to the true rounded-rect shape (straight on the
 * straights, circular at the corners).
 */
export function roundedRectHalf(
  cx: number,
  cz: number,
  hw: number,
  hh: number,
  r: number,
  half: 'top' | 'bottom',
  samples: number,
  y = 0,
): THREE.Vector3[] {
  if (r > hw || r > hh) throw new Error('rounded-rect corner radius exceeds half-extents');
  const dir = half === 'top' ? 1 : -1;

  const sideLen = hh - r;
  const arcLen = (Math.PI / 2) * r;
  const topLen = 2 * (hw - r);
  const total = sideLen + arcLen + topLen + arcLen + sideLen;

  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= samples; i++) {
    const s = (i / samples) * total;
    points.push(pointAtHalfArclen(cx, cz, hw, hh, r, dir, s, y, sideLen, arcLen, topLen));
  }
  return points;
}

function pointAtHalfArclen(
  cx: number,
  cz: number,
  hw: number,
  hh: number,
  r: number,
  dir: 1 | -1,
  s: number,
  y: number,
  sideLen: number,
  arcLen: number,
  topLen: number,
): THREE.Vector3 {
  // 1. West edge (going from cz toward cz + dir*(hh-r))
  if (s <= sideLen) {
    return new THREE.Vector3(cx - hw, y, cz + dir * s);
  }
  s -= sideLen;
  // 2. Far-west corner arc, center at (cx - hw + r, cz + dir*(hh - r))
  if (s <= arcLen) {
    const a = Math.PI - dir * (s / r);
    return new THREE.Vector3(
      cx - hw + r + r * Math.cos(a),
      y,
      cz + dir * (hh - r) + r * Math.sin(a),
    );
  }
  s -= arcLen;
  // 3. Far edge
  if (s <= topLen) {
    return new THREE.Vector3(cx - hw + r + s, y, cz + dir * hh);
  }
  s -= topLen;
  // 4. Far-east corner arc, center at (cx + hw - r, cz + dir*(hh - r))
  if (s <= arcLen) {
    const aStart = dir === 1 ? Math.PI / 2 : (3 * Math.PI) / 2;
    const a = aStart - dir * (s / r);
    return new THREE.Vector3(
      cx + hw - r + r * Math.cos(a),
      y,
      cz + dir * (hh - r) + r * Math.sin(a),
    );
  }
  s -= arcLen;
  // 5. East edge back to cz
  return new THREE.Vector3(cx + hw, y, cz + dir * (hh - r - s));
}

/**
 * Closed-loop sampling of a full rounded rectangle (top half + bottom half).
 * Useful for the perimeter road. Duplicate west/east endpoints are removed.
 */
export function roundedRectLoop(
  cx: number,
  cz: number,
  hw: number,
  hh: number,
  r: number,
  samplesPerHalf: number,
  y = 0,
): THREE.Vector3[] {
  const top = roundedRectHalf(cx, cz, hw, hh, r, 'top', samplesPerHalf, y);
  const bottom = roundedRectHalf(cx, cz, hw, hh, r, 'bottom', samplesPerHalf, y);
  // top: west -> east. bottom: west -> east. We want top then bottom-reversed.
  // Drop top's last (== east), then append reversed bottom dropping its last (== west).
  return [...top.slice(0, -1), ...bottom.slice(1).reverse()];
}
