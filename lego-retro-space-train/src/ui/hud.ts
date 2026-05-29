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
  /** Optional — when present, the 👁 POV button appears. The callback is
   *  passed the new POV-active state (true = POV mode on, false = back to
   *  orbit). HUD owns the visual toggle state. */
  onTogglePOV?: (active: boolean) => void;
  /** Third-person chase cam above + behind the lead train. */
  onToggleChase?: (active: boolean) => void;
  /** Optional — adds a 🟦 Grid button that toggles a grid overlay showing
   *  the underlying tile cells. */
  /** Optional — adds a 🌊 WFC button that rolls a WFC-generated track. */
  onWFCTrack?: () => void;
  /** Optional — adds a time-of-day cycler button. Callback receives a
   *  dayNess value in [0, 1] for fixed-time modes, or `null` to resume the
   *  automatic day/night cycle. */
  onTimeOfDay?: (dayNess: number | null) => void;
  /** Optional — when present, renders a Trains side panel listing each
   *  entry. Click toggles its selection; the callback receives the
   *  selected index (or null when no train is selected). */
  trains?: ReadonlyArray<{ name: string }>;
  onSelectTrain?: (idx: number | null) => void;
}

/** Public helper: refresh the train side panel after track regeneration.
 *  Re-renders the list and clears any active selection. */
/** Show/hide the "Generating track…" overlay. Pass true before kicking
 *  off WFC, false after the new layout is on screen. Use yieldFrame()
 *  between show() and the WFC call so the browser actually repaints. */
export function setWFCLoading(active: boolean): void {
  const el = document.getElementById('wfc-loading');
  if (el) el.style.display = active ? 'flex' : 'none';
}

/** Resolves on the next animation frame — yields to the browser so a
 *  just-shown overlay actually paints before the caller's blocking work. */
export function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export function refreshTrainList(
  trains: ReadonlyArray<{ name: string }>,
  onSelectTrain: (idx: number | null) => void,
): void {
  const panel = document.getElementById('train-list-panel');
  if (!panel) return;
  renderTrainList(panel, trains, onSelectTrain);
}

/** Latest score breakdown — updated by main.ts after each roll, read
 *  by the info popover when opened. Lives at module scope so the click
 *  handler always sees the freshest score. */
let latestQualityBreakdown: string = '<em>Generate a track first.</em>';

/** Public: update the HUD's score badge + info-popover content. */
export function setQualityScore(
  total: number,
  components: Record<string, number>,
  details: Record<string, number | string>,
): void {
  const badge = document.getElementById('quality-badge');
  if (badge) {
    badge.textContent = `${total}/100`;
    badge.style.color = total >= 70 ? '#7df59f' : total >= 50 ? '#f5dc7d' : '#f57d7d';
  }
  // Build a verbose breakdown with formulas + raw values.
  const FORMULAS: Record<string, string> = {
    coverage: 'tiles / area, target 70%',
    connectivity: '1 / N (N = component count)',
    levelCoverage: 'per-Y-level: cells-with-port@Y / area, mean over active levels (targets Y=H 15%, Y=2H 50%, Y=3H 50%)',
    rampPeaks: '1 − 0.25 × peak count',
    stationDistribution: 'mean pairwise grid distance / (½ × grid diagonal)',
    avgLegLength: '1 − |avg edges per leg − 6| / 6',
  };
  const rows = Object.entries(components).map(([k, v]) => {
    const pct = Math.round(v * 100);
    const bar = '█'.repeat(Math.round(v * 12)).padEnd(12, '·');
    return `<div class="qrow"><div class="qrow-head"><b>${k}</b> <span>${pct}/100</span></div><div class="qbar">${bar}</div><div class="qformula">${FORMULAS[k] ?? ''}</div></div>`;
  }).join('');
  const detailRows = Object.entries(details)
    .map(([k, v]) => `<div class="qdetail"><span>${k}</span><span>${v}</span></div>`)
    .join('');
  latestQualityBreakdown = `
    <div class="qtotal">Total <b>${total}</b> / 100</div>
    <div class="qrows">${rows}</div>
    <div class="qdetails-head">Raw counts</div>
    <div class="qdetails">${detailRows}</div>
  `;
  // If the popover is currently open, refresh its content live.
  const body = document.getElementById('quality-popover-body');
  if (body) body.innerHTML = latestQualityBreakdown;
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
  const povBtn = opts.onTogglePOV
    ? `<button class="btn" id="btn-pov">👁 POV</button>`
    : '';
  const chaseBtn = opts.onToggleChase
    ? `<button class="btn" id="btn-chase">🛰 Chase</button>`
    : '';
  const wfcBtn = opts.onWFCTrack
    ? `<button class="btn" id="btn-wfc">🌊 WFC</button>
       <button class="btn seed-badge" id="seed-badge" title="Click to copy">seed —</button>
       <span class="btn quality-badge" id="quality-badge" title="Track quality score">— /100</span>
       <button class="btn info-btn" id="quality-info" title="How is this scored?">ⓘ</button>
       <label class="levels-wrap" title="Max upper deck level (1-3). Higher = more variants, slower WFC.">
         <span>Lvl</span>
         <select class="btn" id="levels-select">
           <option value="1">1</option>
           <option value="2">2</option>
           <option value="3">3</option>
         </select>
       </label>`
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

    <div id="wfc-loading" style="display:none;">
      <div class="wfc-spinner"></div>
      <div class="wfc-loading-label">Generating track…</div>
    </div>

    <div class="panel" id="train-list-panel" style="${opts.trains && opts.trains.length > 0 ? '' : 'display:none;'}">
      <div class="eyebrow">TRAINS</div>
    </div>

    <div class="panel" id="quality-popover" style="display:none;">
      <div class="eyebrow">TRACK SCORE</div>
      <div id="quality-popover-body"></div>
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
      ${chaseBtn}
      ${todBtn}
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

  // POV + Chase are mutually exclusive — turning one ON turns the
  // other OFF. Both share the camera-override slot.
  let povActive = false;
  let chaseActive = false;
  const povBtnEl = opts.onTogglePOV ? document.getElementById('btn-pov') as HTMLButtonElement : null;
  const chaseBtnEl = opts.onToggleChase ? document.getElementById('btn-chase') as HTMLButtonElement : null;
  const refreshLabels = () => {
    if (povBtnEl) povBtnEl.textContent = povActive ? '🗺 Orbit' : '👁 POV';
    if (chaseBtnEl) chaseBtnEl.textContent = chaseActive ? '🗺 Orbit' : '🛰 Chase';
  };
  if (povBtnEl) {
    povBtnEl.addEventListener('click', () => {
      povActive = !povActive;
      if (povActive && chaseActive) { chaseActive = false; opts.onToggleChase?.(false); }
      refreshLabels();
      opts.onTogglePOV!(povActive);
    });
  }
  if (chaseBtnEl) {
    chaseBtnEl.addEventListener('click', () => {
      chaseActive = !chaseActive;
      if (chaseActive && povActive) { povActive = false; opts.onTogglePOV?.(false); }
      refreshLabels();
      opts.onToggleChase!(chaseActive);
    });
  }

  if (opts.onWFCTrack) {
    const wfc = document.getElementById('btn-wfc') as HTMLButtonElement;
    wfc.addEventListener('click', () => { opts.onWFCTrack!(); });
    // Quality info popover toggle.
    const infoBtn = document.getElementById('quality-info') as HTMLButtonElement | null;
    const pop = document.getElementById('quality-popover') as HTMLElement | null;
    const popBody = document.getElementById('quality-popover-body') as HTMLElement | null;
    if (infoBtn && pop && popBody) {
      infoBtn.addEventListener('click', () => {
        const open = pop.style.display !== 'none';
        if (open) {
          pop.style.display = 'none';
        } else {
          popBody.innerHTML = latestQualityBreakdown;
          pop.style.display = '';
        }
      });
    }
    // Max-level select — read initial value from URL, persist changes
    // back to URL, regenerate on change.
    const levelsSel = document.getElementById('levels-select') as HTMLSelectElement | null;
    if (levelsSel) {
      const initial = new URLSearchParams(window.location.search).get('levels') ?? '1';
      if (['1', '2', '3'].includes(initial)) levelsSel.value = initial;
      levelsSel.addEventListener('change', () => {
        const u = new URL(window.location.href);
        u.searchParams.set('levels', levelsSel.value);
        window.history.replaceState({}, '', u.toString());
        opts.onWFCTrack!();
      });
    }
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

  if (opts.trains && opts.onSelectTrain) {
    const panel = document.getElementById('train-list-panel') as HTMLElement;
    renderTrainList(panel, opts.trains, opts.onSelectTrain);
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

/** Render the train-list panel. Clicking a row toggles selection;
 *  clicking the active row again deselects. */
function renderTrainList(
  panel: HTMLElement,
  trains: ReadonlyArray<{ name: string }>,
  onSelectTrain: (idx: number | null) => void,
): void {
  // Clear existing rows (keep the eyebrow header).
  while (panel.children.length > 1) panel.removeChild(panel.lastChild!);
  panel.style.display = trains.length > 0 ? '' : 'none';
  let selected: number | null = null;
  trains.forEach((t, i) => {
    const btn = document.createElement('button');
    btn.className = 'btn train-row';
    btn.textContent = t.name;
    btn.addEventListener('click', () => {
      const next = selected === i ? null : i;
      selected = next;
      Array.from(panel.querySelectorAll('.train-row')).forEach((el, j) => {
        el.classList.toggle('active', j === next);
      });
      onSelectTrain(next);
    });
    panel.appendChild(btn);
  });
}
