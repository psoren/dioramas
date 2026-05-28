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
  /** Optional — adds a 🌊 WFC button that rolls a WFC-generated track. */
  onWFCTrack?: () => void;
  /** Optional — adds a time-of-day cycler button. Callback receives a
   *  dayNess value in [0, 1] for fixed-time modes, or `null` to resume the
   *  automatic day/night cycle. */
  onTimeOfDay?: (dayNess: number | null) => void;
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
  const wfcBtn = opts.onWFCTrack
    ? `<button class="btn" id="btn-wfc">🌊 WFC</button>
       <button class="btn" id="btn-prims">🧱 Prim's</button>
       <button class="btn seed-badge" id="seed-badge" title="Click to copy">seed —</button>`
    : '';
  const todBtn = opts.onTimeOfDay
    ? `<button class="btn" id="btn-tod">🔄 Cycle</button>`
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
      ${todBtn}
      ${randomizeBtn}
      ${wfcBtn}
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

  if (opts.onWFCTrack) {
    // The two buttons both call onWFCTrack — algorithm is selected via
    // the URL's ?algo= param, which main.ts reads inside the handler.
    // Clicking either button updates the param (replaceState so reload
    // remembers the choice) and triggers a fresh generation.
    const wfc = document.getElementById('btn-wfc') as HTMLButtonElement;
    const prims = document.getElementById('btn-prims') as HTMLButtonElement | null;
    const setAlgo = (name: string) => {
      const u = new URL(window.location.href);
      u.searchParams.set('algo', name);
      window.history.replaceState({}, '', u.toString());
    };
    wfc.addEventListener('click', () => { setAlgo('wfc'); opts.onWFCTrack!(); });
    if (prims) prims.addEventListener('click', () => { setAlgo('prims'); opts.onWFCTrack!(); });
    // Click the seed badge to copy the seed to clipboard.
    const seedBtn = document.getElementById('seed-badge') as HTMLButtonElement | null;
    if (seedBtn) {
      seedBtn.addEventListener('click', async () => {
        const m = seedBtn.textContent?.match(/(\d+)/);
        if (!m) return;
        const seed = m[1]!;
        try {
          await navigator.clipboard.writeText(seed);
          const prevText = seedBtn.textContent;
          seedBtn.textContent = `seed ${seed} ✓`;
          setTimeout(() => { if (seedBtn) seedBtn.textContent = prevText ?? ''; }, 1200);
        } catch {
          // Fallback: select via prompt so user can hand-copy.
          window.prompt('seed (copy):', seed);
        }
      });
    }
  }

  if (opts.onTimeOfDay) {
    const btn = document.getElementById('btn-tod') as HTMLButtonElement;
    // Cycle through: Auto (null) → Noon (1) → Sunset (0.35) → Night (0.05) → Sunrise (0.45)
    const modes: Array<{ label: string; dayNess: number | null }> = [
      { label: '🔄 Cycle',   dayNess: null },
      { label: '☀️ Noon',    dayNess: 1.0 },
      { label: '🌇 Sunset',  dayNess: 0.35 },
      { label: '🌙 Night',   dayNess: 0.05 },
      { label: '🌅 Sunrise', dayNess: 0.45 },
    ];
    let idx = 0;
    btn.addEventListener('click', () => {
      idx = (idx + 1) % modes.length;
      btn.textContent = modes[idx]!.label;
      opts.onTimeOfDay!(modes[idx]!.dayNess);
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
