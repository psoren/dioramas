import * as THREE from 'three';

/**
 * Place an object on a closed CatmullRom path at parameter t in [0, 1),
 * facing along the path tangent. Builds a mesh that points along +X by
 * convention (rotation = atan2(tan.x, tan.z) - PI/2).
 */
export function placeOnPath(
  object3d: THREE.Object3D,
  path: THREE.CatmullRomCurve3,
  t: number,
  yOffset = 0,
): void {
  const u = wrap01(t);
  const pos = path.getPointAt(u);
  const tan = path.getTangentAt(u);
  object3d.position.set(pos.x, pos.y + yOffset, pos.z);
  object3d.rotation.y = Math.atan2(tan.x, tan.z) - Math.PI / 2;
}

export function wrap01(t: number): number {
  return ((t % 1) + 1) % 1;
}
