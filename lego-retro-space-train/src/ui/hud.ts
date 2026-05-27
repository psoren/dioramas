import { Sim } from '../sim/Sim';

export interface VehicleTelemetry {
  speed: number;
  laps: number;
}

export interface HUDOptions {
  setNumber: string;
  setName: string;
  subtitle?: string;
  /** Optional — when present the HUD shows velocity + lap stats. */
  trackedVehicle?: VehicleTelemetry;
  /** Optional — when present, the 🎲 Random track button appears and
   *  clicking it invokes this callback. */
  onRandomizeTrack?: () => void;
  /** Optional — when present, the 👁 POV button appears. The callback is
   *  passed the new POV-active state (true = POV mode on, false = back to
   *  orbit). HUD owns the visual toggle state. */
  onTogglePOV?: (active: boolean) => void;
  /** Optional — adds a 🟦 Grid button that toggles a grid overlay showing
   *  the underlying tile cells. */
  onToggleGrid?: (active: boolean) => void;
}

export function mountHUD(sim: Sim, opts: HUDOptions): void {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root not found');

  const telemetryRows = opts.trackedVehicle
    ? `
      <div class="stat"><span><span class="blink"></span>Monorail</span><span id="stat-status">CIRCULATING</span></div>
      <div class="stat"><span>Velocity</span><span id="stat-vel">—</span></div>
      <div class="stat"><span>Laps</span><span id="stat-laps">0</span></div>
      <div class="divider"></div>
    `
    : '';
  const randomizeBtn = opts.onRandomizeTrack
    ? `<button class="btn" id="btn-randomize">🎲 Random track</button>`
    : '';
  const povBtn = opts.onTogglePOV
    ? `<button class="btn" id="btn-pov">👁 POV</button>`
    : '';
  const gridBtn = opts.onToggleGrid
    ? `<button class="btn" id="btn-grid">🟦 Grid</button>`
    : '';

  root.innerHTML = `
    <div class="panel" id="hud">
      <div class="eyebrow">LEGO INSIDERS · ${opts.setNumber}</div>
      <h1>${opts.setName}</h1>
      <div class="sub">${opts.subtitle ?? ''}</div>
      <div class="divider"></div>
      ${telemetryRows}
    </div>

    <div class="panel" id="hint">
      <kbd>drag</kbd> orbit · <kbd>scroll</kbd> zoom
    </div>

    <div class="panel" id="controls">
      <button class="btn" id="btn-play">⏸ Pause</button>
      <div class="sep"></div>
      <div class="slider-wrap">
        <span>Speed</span>
        <input type="range" id="speed" min="0" max="3" step="0.05" value="1">
      </div>
      <div class="sep"></div>
      <button class="btn" id="btn-reset">Reset View</button>
      ${povBtn}
      ${gridBtn}
      ${randomizeBtn}
    </div>
  `;

  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
  const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
  const speed = document.getElementById('speed') as HTMLInputElement;

  btnPlay.addEventListener('click', () => {
    sim.playing = !sim.playing;
    btnPlay.textContent = sim.playing ? '⏸ Pause' : '▶ Play';
    const statStatus = document.getElementById('stat-status');
    if (statStatus) {
      statStatus.textContent = sim.playing ? 'CIRCULATING' : 'HOLD';
      statStatus.style.color = sim.playing ? '' : '#ff9050';
    }
  });

  btnReset.addEventListener('click', () => sim.orbit.reset());

  speed.addEventListener('input', () => {
    sim.speedMultiplier = parseFloat(speed.value);
  });

  if (opts.onRandomizeTrack) {
    const btn = document.getElementById('btn-randomize') as HTMLButtonElement;
    btn.addEventListener('click', () => opts.onRandomizeTrack!());
  }

  if (opts.onTogglePOV) {
    const btn = document.getElementById('btn-pov') as HTMLButtonElement;
    let active = false;
    btn.addEventListener('click', () => {
      active = !active;
      btn.textContent = active ? '🗺 Orbit' : '👁 POV';
      opts.onTogglePOV!(active);
    });
  }

  if (opts.onToggleGrid) {
    const btn = document.getElementById('btn-grid') as HTMLButtonElement;
    let active = false;
    btn.addEventListener('click', () => {
      active = !active;
      btn.classList.toggle('active', active);
      opts.onToggleGrid!(active);
    });
  }

  if (opts.trackedVehicle) {
    const statVel = document.getElementById('stat-vel') as HTMLElement;
    const statLaps = document.getElementById('stat-laps') as HTMLElement;
    setInterval(() => {
      const v = opts.trackedVehicle!;
      const effectiveSpeed = sim.playing ? v.speed * sim.speedMultiplier : 0;
      statVel.textContent = (effectiveSpeed * 100).toFixed(0) + ' u/s';
      statLaps.textContent = String(v.laps);
    }, 100);
  }
}
