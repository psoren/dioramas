import { Sim } from '../sim/Sim';

export interface VehicleTelemetry {
  speed: number;
  laps: number;
}

export interface HUDOptions {
  setNumber: string;
  setName: string;
  subtitle?: string;
  /** The vehicle whose stats appear in the HUD. */
  trackedVehicle: VehicleTelemetry;
}

export function mountHUD(sim: Sim, opts: HUDOptions): void {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root not found');

  root.innerHTML = `
    <div class="panel" id="hud">
      <div class="eyebrow">LEGO INSIDERS · ${opts.setNumber}</div>
      <h1>${opts.setName}</h1>
      <div class="sub">${opts.subtitle ?? ''}</div>
      <div class="divider"></div>
      <div class="stat"><span><span class="blink"></span>Monorail</span><span id="stat-status">CIRCULATING</span></div>
      <div class="stat"><span>Velocity</span><span id="stat-vel">—</span></div>
      <div class="stat"><span>Laps</span><span id="stat-laps">0</span></div>
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
    </div>
  `;

  const btnPlay = document.getElementById('btn-play') as HTMLButtonElement;
  const btnReset = document.getElementById('btn-reset') as HTMLButtonElement;
  const speed = document.getElementById('speed') as HTMLInputElement;
  const statStatus = document.getElementById('stat-status') as HTMLElement;
  const statVel = document.getElementById('stat-vel') as HTMLElement;
  const statLaps = document.getElementById('stat-laps') as HTMLElement;

  btnPlay.addEventListener('click', () => {
    sim.playing = !sim.playing;
    btnPlay.textContent = sim.playing ? '⏸ Pause' : '▶ Play';
    statStatus.textContent = sim.playing ? 'CIRCULATING' : 'HOLD';
    statStatus.style.color = sim.playing ? '' : '#ff9050';
  });

  btnReset.addEventListener('click', () => sim.orbit.reset());

  speed.addEventListener('input', () => {
    sim.speedMultiplier = parseFloat(speed.value);
  });

  // Update telemetry on a slow interval (no need for per-frame)
  setInterval(() => {
    const v = opts.trackedVehicle;
    const effectiveSpeed = sim.playing ? v.speed * sim.speedMultiplier : 0;
    statVel.textContent = (effectiveSpeed * 100).toFixed(0) + ' u/s';
    statLaps.textContent = String(v.laps);
  }, 100);
}
