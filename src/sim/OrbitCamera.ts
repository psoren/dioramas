import * as THREE from 'three';

export interface OrbitState {
  azimuth: number;
  elevation: number;
  distance: number;
}

const MIN_EL = -0.25; // allow looking slightly up from below
const MAX_EL = Math.PI / 2 - 0.05;
const MIN_DIST = 4;
const MAX_DIST = 60;

/**
 * Custom orbit camera. Not the three.js addon — we keep deps minimal.
 * Underwater-tuned defaults: closer-in, slightly downward elevation.
 */
export class OrbitCamera {
  readonly target = new THREE.Vector3(0, 2, 0);
  private readonly state: OrbitState;
  private readonly defaultState: OrbitState;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    initial: OrbitState = { azimuth: Math.PI * 0.25, elevation: 0.35, distance: 22 },
  ) {
    this.state = { ...initial };
    this.defaultState = { ...initial };
    this.apply();
    this.bindInput();
  }

  reset(): void {
    Object.assign(this.state, this.defaultState);
    this.apply();
  }

  private apply(): void {
    const { azimuth: az, elevation: el, distance: d } = this.state;
    this.camera.position.set(
      this.target.x + d * Math.cos(el) * Math.sin(az),
      this.target.y + d * Math.sin(el),
      this.target.z + d * Math.cos(el) * Math.cos(az),
    );
    this.camera.lookAt(this.target);
  }

  private bindInput(): void {
    let dragging = false;
    let prevX = 0;
    let prevY = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      this.state.azimuth -= dx * 0.005;
      this.state.elevation = Math.max(MIN_EL, Math.min(MAX_EL, this.state.elevation + dy * 0.005));
      this.apply();
    });
    const stop = () => { dragging = false; };
    this.canvas.addEventListener('pointerup', stop);
    this.canvas.addEventListener('pointercancel', stop);
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.state.distance = Math.max(
          MIN_DIST,
          Math.min(MAX_DIST, this.state.distance * (1 + e.deltaY * 0.0015)),
        );
        this.apply();
      },
      { passive: false },
    );
  }
}
