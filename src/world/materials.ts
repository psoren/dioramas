import * as THREE from 'three';

function std(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.42,
    metalness: 0.04,
    ...opts,
  });
}

/**
 * Shared materials. Reuse these instead of allocating new ones per mesh —
 * it cuts GPU state changes and keeps the LEGO color palette consistent.
 */
export const MAT = {
  blue: std(0x0a55c4),
  blueDark: std(0x083a85),
  white: std(0xe8e8e6),
  gray: std(0xa3a7ab),
  grayDark: std(0x5b6168),
  black: std(0x1a1a1c),
  yellow: std(0xf5c518),

  yellowTrans: new THREE.MeshStandardMaterial({
    color: 0xfac80a,
    transparent: true,
    opacity: 0.78,
    emissive: 0xfac80a,
    emissiveIntensity: 0.45,
    roughness: 0.2,
    metalness: 0,
  }),
  blueTrans: new THREE.MeshStandardMaterial({
    color: 0x68c3e2,
    transparent: true,
    opacity: 0.78,
    emissive: 0x4ba8c8,
    emissiveIntensity: 0.55,
    roughness: 0.15,
    metalness: 0,
  }),
  greenLED: new THREE.MeshStandardMaterial({
    color: 0x60ff90,
    emissive: 0x60ff90,
    emissiveIntensity: 2.5,
    roughness: 0.2,
    metalness: 0,
  }),
  redLED: new THREE.MeshStandardMaterial({
    color: 0xff5060,
    emissive: 0xff5060,
    emissiveIntensity: 1.8,
    roughness: 0.2,
    metalness: 0,
  }),
} as const;
