import * as THREE from 'three';

export interface OrbitState {
  azimuth: number;
  elevation: number;
  distance: number;
}

const MIN_EL = 0.08;
const MAX_EL = Math.PI / 2 - 0.05;
const MIN_DIST = 8;
const MAX_DIST = 80;

// Auto-drift kicks in after the user goes idle for this long.
const RESUME_AFTER_IDLE = 3.0;
const AZIMUTH_DRIFT_RATE = 0.02;
const ELEVATION_DRIFT_AMP = 0.10;
const DISTANCE_DRIFT_AMP = 4.0;

// Click vs drag: any pointer movement past this threshold (px, summed L1)
// converts the gesture into a camera-rotate and a click won't fire on release.
const CLICK_DRAG_THRESHOLD = 6;

/**
 * Custom orbit camera. Three behaviour layers:
 *  1. User drag/wheel — manual control. Always wins; pauses auto modes.
 *  2. Auto-drift — slow sum-of-sines orbit + breathing distance/elevation,
 *     starting after `RESUME_AFTER_IDLE` seconds of no input.
 *  3. Cinematic focus — picks a random `focusCandidate` every
 *     `focusInterval` seconds (or on click-to-follow) and pulls in tight on
 *     it for `focusDuration` seconds before releasing.
 *
 * `tickWithFocus(dt)` is the entry point Sim should call every frame.
 */
export class OrbitCamera {
  readonly target = new THREE.Vector3(0, 1.2, 0);
  private readonly state: OrbitState;
  private readonly defaultState: OrbitState;
  private idleTime = 0;
  private driftTime = 0;
  private restElevation: number;
  private restDistance: number;

  /** Toggle auto-drift entirely (e.g. from a HUD button). */
  autoDrift = true;

  // --- Cinematic focus state ------------------------------------------------
  /** Object3Ds the auto-camera may pick to focus on. Set externally. */
  focusCandidates: THREE.Object3D[] = [];
  /** Seconds of drift between auto-focus picks. */
  focusInterval = 16;
  /** How long each focus lasts before pulling back out. */
  focusDuration = 9;
  /** Camera distance while focused. */
  focusDistance = 12;

  private timeSinceLastFocus = 0;
  private focusTarget: THREE.Object3D | null = null;
  private focusTimeRemaining = 0;
  private readonly tempVec = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly canvas: HTMLCanvasElement,
    initial: OrbitState = { azimuth: Math.PI * 0.18, elevation: 0.55, distance: 35 },
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
    this.exitFocus();
    this.apply();
  }

  /** Force-focus on an object (called externally for explicit click-to-follow). */
  focusOn(target: THREE.Object3D): void {
    this.focusTarget = target;
    this.focusTimeRemaining = this.focusDuration;
  }

  exitFocus(): void {
    this.focusTarget = null;
    this.focusTimeRemaining = 0;
    this.timeSinceLastFocus = 0;
  }

  /**
   * Per-frame tick. Handles auto-drift and cinematic focus together.
   * Called with raw (non-paused) dt so the camera keeps moving when paused.
   */
  tickWithFocus(dt: number): void {
    if (this.focusTarget) {
      this.focusTimeRemaining -= dt;
      this.focusTarget.getWorldPosition(this.tempVec);
      // Ease the look-at target toward the subject.
      this.target.lerp(this.tempVec, 0.05);
      // Pull distance toward the focus distance.
      this.state.distance += (this.focusDistance - this.state.distance) * 0.04;
      // Slow circling shot.
      this.driftTime += dt;
      this.state.azimuth += dt * 0.15;
      this.apply();

      if (this.focusTimeRemaining <= 0) {
        this.focusTarget = null;
        this.timeSinceLastFocus = 0;
        this.restDistance = this.defaultState.distance;
      }
      return;
    }

    // Not focused: ease look-at back toward the default centre then drift.
    this.target.lerp(this.tempVec.set(0, 1.2, 0), 0.03);
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

  /** Drift only (no focus). Called from tickWithFocus during the unfocused branch. */
  private tick(dt: number): void {
    this.idleTime += dt;
    if (!this.autoDrift || this.idleTime < RESUME_AFTER_IDLE) return;

    this.driftTime += dt;
    this.state.azimuth += AZIMUTH_DRIFT_RATE * dt;
    this.state.azimuth += Math.sin(this.driftTime * 0.27) * 0.001;

    this.state.elevation =
      this.restElevation +
      Math.sin(this.driftTime * 0.13) * ELEVATION_DRIFT_AMP +
      Math.sin(this.driftTime * 0.041) * ELEVATION_DRIFT_AMP * 0.5;
    this.state.elevation = Math.max(MIN_EL, Math.min(MAX_EL, this.state.elevation));

    this.state.distance =
      this.restDistance +
      Math.sin(this.driftTime * 0.07) * DISTANCE_DRIFT_AMP +
      Math.sin(this.driftTime * 0.023) * DISTANCE_DRIFT_AMP * 0.4;
    this.state.distance = Math.max(MIN_DIST, Math.min(MAX_DIST, this.state.distance));

    this.apply();
  }

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
    let dragDist = 0;

    this.canvas.addEventListener('pointerdown', (e) => {
      dragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
      dragDist = 0;
      this.canvas.setPointerCapture(e.pointerId);
      // Don't exit focus yet — wait to see whether this is a click or a drag.
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - prevX;
      const dy = e.clientY - prevY;
      prevX = e.clientX;
      prevY = e.clientY;
      dragDist += Math.abs(dx) + Math.abs(dy);
      if (dragDist <= CLICK_DRAG_THRESHOLD) return; // still might be a click
      // Promoted to a drag: rotate and break out of focus.
      this.exitFocus();
      this.state.azimuth -= dx * 0.005;
      this.state.elevation = Math.max(MIN_EL, Math.min(MAX_EL, this.state.elevation + dy * 0.005));
      this.apply();
      this.noteInteraction();
    });

    const stop = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      if (dragDist <= CLICK_DRAG_THRESHOLD) {
        this.tryClickFocus(e.clientX, e.clientY);
      }
    };
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

  private tryClickFocus(clientX: number, clientY: number): void {
    if (this.focusCandidates.length === 0) {
      this.noteInteraction();
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.focusCandidates, true);
    if (hits.length === 0) {
      // Clicked empty space — exit any active focus.
      this.exitFocus();
      this.noteInteraction();
      return;
    }
    const candidate = this.resolveCandidate(hits[0]!.object);
    if (candidate) this.focusOn(candidate);
    else this.noteInteraction();
  }

  /** Walk up the parent chain until we find one of the registered candidates. */
  private resolveCandidate(hit: THREE.Object3D): THREE.Object3D | null {
    const set = new Set(this.focusCandidates);
    let cur: THREE.Object3D | null = hit;
    while (cur) {
      if (set.has(cur)) return cur;
      cur = cur.parent;
    }
    return null;
  }
}
