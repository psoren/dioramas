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
 *
 * Auto-drift: when the user hasn't touched the camera for a few seconds, it
 * slowly orbits on its own using a sum of slow sines with different periods,
 * which feels random without being jittery. Any user interaction pauses
 * the drift; it resumes after `RESUME_AFTER_IDLE` seconds.
 */
const RESUME_AFTER_IDLE = 3.0;     // seconds of no input before drift resumes
const AZIMUTH_DRIFT_RATE = 0.025;  // rad/sec base rate
const ELEVATION_DRIFT_AMP = 0.12;  // rad amplitude around the resting elevation
const DISTANCE_DRIFT_AMP = 2.5;    // units amplitude around the resting distance

export class OrbitCamera {
  readonly target = new THREE.Vector3(0, 2, 0);
  private readonly state: OrbitState;
  private readonly defaultState: OrbitState;
  /** Time since the user last interacted, in seconds. */
  private idleTime = 0;
  /** Accumulated drift time — drives the sines. */
  private driftTime = 0;
  /** Reference elevation/distance that the drift oscillates around. */
  private restElevation: number;
  private restDistance: number;
  /** Whether auto-drift is enabled (can be toggled off externally). */
  autoDrift = true;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    initial: OrbitState = { azimuth: Math.PI * 0.25, elevation: 0.35, distance: 22 },
  ) {
    this.state = { ...initial };
    this.defaultState = { ...initial };
    this.restElevation = initial.elevation;
    this.restDistance = initial.distance;
    this.apply();
    this.bindInput();
  }

  reset(): void {
    Object.assign(this.state, this.defaultState);
    this.restElevation = this.defaultState.elevation;
    this.restDistance = this.defaultState.distance;
    this.idleTime = 0;
    this.apply();
  }

  /**
   * Called by Sim per frame. Advances idle time and, if past the threshold,
   * applies a slow drift to azimuth/elevation/distance.
   */
  tick(dt: number): void {
    this.idleTime += dt;
    if (!this.autoDrift || this.idleTime < RESUME_AFTER_IDLE) return;

    this.driftTime += dt;
    // Azimuth: monotonic slow orbit + a slight wobble so it isn't perfectly steady.
    this.state.azimuth += AZIMUTH_DRIFT_RATE * dt;
    this.state.azimuth += Math.sin(this.driftTime * 0.27) * 0.001;

    // Elevation: oscillate gently around the rest value.
    this.state.elevation =
      this.restElevation +
      Math.sin(this.driftTime * 0.13) * ELEVATION_DRIFT_AMP +
      Math.sin(this.driftTime * 0.041) * ELEVATION_DRIFT_AMP * 0.5;
    this.state.elevation = Math.max(MIN_EL, Math.min(MAX_EL, this.state.elevation));

    // Distance: very slow breathe in and out.
    this.state.distance =
      this.restDistance +
      Math.sin(this.driftTime * 0.07) * DISTANCE_DRIFT_AMP +
      Math.sin(this.driftTime * 0.023) * DISTANCE_DRIFT_AMP * 0.4;
    this.state.distance = Math.max(MIN_DIST, Math.min(MAX_DIST, this.state.distance));

    this.apply();
  }

  /** Called from input handlers to pause the drift and remember the new resting pose. */
  private noteInteraction(): void {
    this.idleTime = 0;
    this.restElevation = this.state.elevation;
    this.restDistance = this.state.distance;
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
      // User grabbed the camera — break out of any auto-mode.
      this.exitFocus();
      this.noteInteraction();
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
      this.noteInteraction();
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
        this.exitFocus();
        this.noteInteraction();
      },
      { passive: false },
    );
  }

  // --- Cinematic focus on a specific Object3D --------------------------------
  //
  // While focused: every frame, the camera target eases toward the subject's
  // world position and the orbit distance eases toward the focus distance.
  // After `focusDuration` seconds the camera pulls back out and rejoins drift.

  /** Object3Ds the auto-camera may pick to focus on. Set externally. */
  focusCandidates: THREE.Object3D[] = [];

  /** Seconds between auto-focus picks. Drift in between. */
  focusInterval = 18;
  /** How long each focus lasts. */
  focusDuration = 9;
  /** Camera distance while focused. */
  focusDistance = 6;

  private timeSinceLastFocus = 0;
  private focusTarget: THREE.Object3D | null = null;
  private focusTimeRemaining = 0;
  private readonly tempVec = new THREE.Vector3();

  /** Force the camera to pull subject into view for `focusDuration` seconds. */
  focusOn(target: THREE.Object3D): void {
    this.focusTarget = target;
    this.focusTimeRemaining = this.focusDuration;
  }

  exitFocus(): void {
    this.focusTarget = null;
    this.focusTimeRemaining = 0;
    this.timeSinceLastFocus = 0;
  }

  /** Wrapper around tick(dt) that also handles focus pick/track logic. */
  tickWithFocus(dt: number): void {
    if (this.focusTarget) {
      this.focusTimeRemaining -= dt;
      // Track the subject: target eases toward the subject's world position.
      this.focusTarget.getWorldPosition(this.tempVec);
      this.target.lerp(this.tempVec, 0.05);
      // Pull distance toward focus distance.
      this.state.distance += (this.focusDistance - this.state.distance) * 0.04;
      // Keep azimuth drifting gently around the subject so we get a "circling" shot.
      this.driftTime += dt;
      this.state.azimuth += dt * 0.18;
      this.apply();

      if (this.focusTimeRemaining <= 0) {
        this.focusTarget = null;
        this.timeSinceLastFocus = 0;
        // Reset the resting distance/target so drift resumes naturally.
        this.restDistance = this.defaultState.distance;
      }
      return;
    }

    // Not focused — normal drift, with target easing back toward the default look-at.
    this.target.lerp(this.tempVec.set(0, 2, 0), 0.03);
    this.tick(dt);

    // Maybe pick a new focus subject.
    if (!this.autoDrift || this.idleTime < RESUME_AFTER_IDLE) {
      this.timeSinceLastFocus = 0;
      return;
    }
    this.timeSinceLastFocus += dt;
    if (this.timeSinceLastFocus >= this.focusInterval && this.focusCandidates.length > 0) {
      const pick = this.focusCandidates[Math.floor(Math.random() * this.focusCandidates.length)]!;
      this.focusOn(pick);
    }
  }
}
