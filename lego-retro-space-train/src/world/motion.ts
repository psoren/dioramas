import * as THREE from 'three';

/**
 * Tiny motion helpers shared by entities that bob, sway, or pulse in place.
 * Keep them stateless — the caller owns the `phase` accumulator.
 */

/** Sine bob: `baseY + sin(phase * freq) * amp`. */
export function bobY(baseY: number, phase: number, freq: number, amp: number): number {
  return baseY + Math.sin(phase * freq) * amp;
}

/** Sine sway around 0 — handy for tilts and pendulum-style rotations. */
export function sway(phase: number, freq: number, amp: number): number {
  return Math.sin(phase * freq) * amp;
}

/** Recursively toggle shadow flags on every Mesh in a subtree. */
export function applyShadows(
  root: THREE.Object3D,
  cast = true,
  receive = false,
): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((mesh as THREE.Mesh & { isMesh?: boolean }).isMesh) {
      mesh.castShadow = cast;
      mesh.receiveShadow = receive;
    }
  });
}
