import * as THREE from 'three';
import { Entity } from './Entity';
import { OrbitCamera } from './OrbitCamera';
import { setupLighting, setupStarfield } from './sceneSetup';

/**
 * The simulation container. Owns the renderer, scene, camera, and a
 * registry of entities. Drives the per-frame update loop.
 *
 * Usage:
 *   const sim = new Sim(canvas);
 *   sim.add(new MyThing(...));
 *   sim.start();
 */
export class Sim {
  readonly scene = new THREE.Scene();
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly orbit: OrbitCamera;

  /** When false, entities receive dt=0 (paused). */
  playing = true;
  /** Multiplied into dt before being passed to entities. */
  speedMultiplier = 1.0;

  private readonly clock = new THREE.Clock();
  private readonly entities: Entity[] = [];
  private running = false;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene.background = new THREE.Color(0x05080f);
    this.scene.fog = new THREE.Fog(0x05080f, 28, 75);

    this.camera = new THREE.PerspectiveCamera(
      38,
      window.innerWidth / window.innerHeight,
      0.1,
      200,
    );
    this.orbit = new OrbitCamera(this.camera, this.canvas);

    setupLighting(this.scene);
    setupStarfield(this.scene);

    window.addEventListener('resize', () => this.onResize());
  }

  /** Register an entity, add its object3d to the scene, return it. */
  add<E extends Entity>(entity: E): E {
    this.entities.push(entity);
    this.scene.add(entity.object3d);
    return entity;
  }

  remove(entity: Entity): void {
    const i = this.entities.indexOf(entity);
    if (i === -1) return;
    this.entities.splice(i, 1);
    this.scene.remove(entity.object3d);
    entity.dispose?.();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.clock.start();
    const tick = () => {
      if (!this.running) return;
      requestAnimationFrame(tick);
      const raw = Math.min(this.clock.getDelta(), 0.1);
      const dt = this.playing ? raw * this.speedMultiplier : 0;
      for (const e of this.entities) e.update?.(dt);
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  stop(): void {
    this.running = false;
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}
