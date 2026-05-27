import * as THREE from 'three';
import { Entity } from '../sim/Entity';

/**
 * Caustics — animated bright ripple pattern projected onto the sand. Sits
 * just above the ocean floor, additively blended so it brightens the sand
 * without darkening any region. Pure shader; no textures.
 *
 * The pattern is layered sine waves at different frequencies / phases —
 * multiplied together so peaks coincide as bright spots and the rest stays
 * dim. A radial mask softens the edges so the ring doesn't have a hard
 * boundary.
 */
export class Caustics implements Entity {
  readonly object3d: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private time = 0;

  constructor(radius = 22) {
    const geo = new THREE.CircleGeometry(radius, 64);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.object3d = new THREE.Mesh(geo, this.material);
    // Just above the highest dune crest so the pattern projects onto the sand
    // without z-fighting. Floor dunes have amplitude ~0.45 + 0.32.
    this.object3d.position.y = 0.85;
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
  }

  dispose(): void {
    this.material.dispose();
    (this.object3d.geometry as THREE.BufferGeometry).dispose();
  }
}

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  varying vec2 vUv;
  uniform float uTime;

  float wave(vec2 p) {
    return 0.5 + 0.5 * sin(p.x + sin(p.y + uTime * 0.6));
  }

  void main() {
    // Centered uv in [-1,1].
    vec2 c = vUv * 2.0 - 1.0;

    vec2 p = vUv * 9.0;
    float a = wave(p + vec2(uTime * 0.25, 0.0));
    float b = wave(p.yx * 1.4 - vec2(uTime * 0.4, uTime * 0.2));
    float d = wave(p * 0.7 + vec2(0.0, uTime * 0.55));

    // Multiply layers: bright only where all three peak. Then sharpen with pow.
    float v = pow(a * b * d, 2.5);

    // Radial fade so the disc edge isn't visible.
    float r = length(c);
    float mask = smoothstep(1.0, 0.55, r);

    // Warm-white caustic tint over cool sand.
    gl_FragColor = vec4(vec3(1.0, 0.97, 0.85) * v, v * mask * 0.7);
  }
`;
