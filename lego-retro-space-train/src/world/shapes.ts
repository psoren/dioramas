import * as THREE from 'three';

/** Rounded square (centered at origin) as a Shape, for use in ExtrudeGeometry. */
export function roundRectShape(size: number, radius: number): THREE.Shape {
  const s = new THREE.Shape();
  traceRoundRect(s, size, radius);
  return s;
}

/** Rounded square as a Path, for use as a hole inside a Shape. */
export function roundRectPath(size: number, radius: number): THREE.Path {
  const p = new THREE.Path();
  traceRoundRect(p, size, radius);
  return p;
}

function traceRoundRect(p: THREE.Shape | THREE.Path, sz: number, r: number): void {
  p.moveTo(-sz + r, -sz);
  p.lineTo(sz - r, -sz);
  p.quadraticCurveTo(sz, -sz, sz, -sz + r);
  p.lineTo(sz, sz - r);
  p.quadraticCurveTo(sz, sz, sz - r, sz);
  p.lineTo(-sz + r, sz);
  p.quadraticCurveTo(-sz, sz, -sz, sz - r);
  p.lineTo(-sz, -sz + r);
  p.quadraticCurveTo(-sz, -sz, -sz + r, -sz);
}
