import * as THREE from 'three';

function std(
  color: number,
  opts: Partial<THREE.MeshStandardMaterialParameters> = {},
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.7,
    metalness: 0.02,
    ...opts,
  });
}

/**
 * Shared palette. Reuse these instead of allocating per-mesh.
 * Underwater scene — sandy floor, vivid coral, fish.
 */
export const MAT = {
  sand: std(0xd4c084, { roughness: 0.95 }),
  sandDark: std(0xa8966a, { roughness: 0.95 }),
  rock: std(0x6a6e73, { roughness: 0.9 }),
  shell: std(0xf0e8d0, { roughness: 0.6 }),

  coralPink: std(0xe85a8a, { roughness: 0.6 }),
  coralOrange: std(0xff8a3c, { roughness: 0.55 }),
  coralMustard: std(0xd9a73a, { roughness: 0.55 }),
  coralPurple: std(0x8a3ccc, { roughness: 0.55 }),
  coralRed: std(0xb02830, { roughness: 0.6 }),
  brainCoral: std(0xe0a040, { roughness: 0.5 }),

  anemoneBase: std(0x6a4080, { roughness: 0.5 }),
  anemoneTendril: std(0xff5080, {
    roughness: 0.4,
    emissive: 0x501020,
    emissiveIntensity: 0.3,
  }),
  anemoneTendrilGreen: std(0x40d090, {
    roughness: 0.4,
    emissive: 0x103020,
    emissiveIntensity: 0.3,
  }),

  fishYellow: std(0xffd040, { roughness: 0.4 }),
  fishBlue: std(0x3080ff, { roughness: 0.4 }),
  fishOrange: std(0xff7030, { roughness: 0.4 }),
  fishSilver: std(0xc8d0d8, { roughness: 0.35, metalness: 0.25 }),
  fishClown: std(0xff5a1c, { roughness: 0.4 }),
  fishTang: std(0x1a3aa8, { roughness: 0.4 }),
  fishLime: std(0x60e040, { roughness: 0.4 }),
  fishPurple: std(0x9040d8, { roughness: 0.4 }),
  fishRed: std(0xd02828, { roughness: 0.4 }),
  fishPink: std(0xff80b0, { roughness: 0.4 }),
  fishCyan: std(0x40e0d0, { roughness: 0.4 }),
  fishGold: std(0xf0c060, { roughness: 0.35, metalness: 0.15 }),

  sharkGray: std(0x5a6068, { roughness: 0.5 }),
  sharkBelly: std(0xd8dce0, { roughness: 0.5 }),

  turtleShell: std(0x4a6a3a, { roughness: 0.7 }),
  turtleShellPattern: std(0x2c4023, { roughness: 0.7 }),
  turtleSkin: std(0x8a7a55, { roughness: 0.85 }),

  mantaTop: std(0x252a38, { roughness: 0.45 }),
  mantaBelly: std(0xe0e8ec, { roughness: 0.5 }),

  jellyfishBell: new THREE.MeshStandardMaterial({
    color: 0xffd8e8,
    emissive: 0xffa0c8,
    emissiveIntensity: 0.45,
    transparent: true,
    opacity: 0.55,
    roughness: 0.15,
    metalness: 0,
    depthWrite: false,
  }),

  jellyfishTendril: new THREE.MeshStandardMaterial({
    color: 0xffc8dc,
    emissive: 0xff90b8,
    emissiveIntensity: 0.3,
    transparent: true,
    opacity: 0.45,
    roughness: 0.2,
    metalness: 0,
    depthWrite: false,
  }),

  diverSuit: std(0x1a1a1c, { roughness: 0.65 }),
  diverSkin: std(0xe8c8a0, { roughness: 0.7 }),
  diverTank: std(0xb8b8c0, { roughness: 0.4, metalness: 0.4 }),

  bubble: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.4,
    roughness: 0.1,
    metalness: 0.0,
  }),

  sunbeam: new THREE.MeshStandardMaterial({
    color: 0xfff8d0,
    transparent: true,
    opacity: 0.08,
    emissive: 0xfff8d0,
    emissiveIntensity: 0.4,
    side: THREE.DoubleSide,
    depthWrite: false,
  }),

  surfaceCanopy: new THREE.MeshStandardMaterial({
    color: 0x60a0c0,
    transparent: true,
    opacity: 0.35,
    side: THREE.DoubleSide,
    roughness: 0.2,
  }),

  eelSkin: std(0x4a5a3a, { roughness: 0.55 }),
  eelBelly: std(0xc8c08a, { roughness: 0.55 }),
  eelMouth: std(0x301818, { roughness: 0.5 }),
  eelHole: std(0x0a0c10, { roughness: 1 }),

  starfishOrange: std(0xd8602a, { roughness: 0.6 }),

  urchinBody: std(0x1a1018, { roughness: 0.8 }),
  urchinSpine: std(0x080608, { roughness: 0.9 }),

  spongeRed: std(0xc04030, { roughness: 0.7 }),
  spongeOrange: std(0xe0703a, { roughness: 0.7 }),
  spongePurple: std(0x603a90, { roughness: 0.7 }),

  kelpDark: std(0x2a4a20, { roughness: 0.55 }),
  kelpLight: std(0x4a7a30, { roughness: 0.55 }),

  octopusBody: std(0xb04060, { roughness: 0.45 }),

  crabShell: std(0xc02828, { roughness: 0.55 }),
  crabClaw: std(0xa02020, { roughness: 0.55 }),
  crabLeg: std(0x801818, { roughness: 0.55 }),

  rayTop: std(0x3a3024, { roughness: 0.55 }),
  rayBelly: std(0xd8c8a8, { roughness: 0.55 }),

  seahorseBody: std(0xf0a830, { roughness: 0.5 }),
} as const;
