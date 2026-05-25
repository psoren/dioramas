import { Sim } from '../sim/Sim';
import { subscribe } from '../sim/EventBus';

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
      <button class="btn" id="btn-randomize">🎲 Random track</button>
    </div>

    <div class="panel" id="event-feed">
      <div class="eyebrow">EVENT FEED</div>
      <ul id="event-list"></ul>
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

  const btnRandomize = document.getElementById('btn-randomize') as HTMLButtonElement;
  btnRandomize.addEventListener('click', () => {
    // Random seed gets baked into the URL so reloads/share-links are
    // reproducible. The manifest reads it for the moon-tile-track.
    const url = new URL(window.location.href);
    url.searchParams.set('seed', String(Math.floor(Math.random() * 1_000_000)));
    window.location.assign(url.toString());
  });

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

  // Event feed: append sim events as <li>; cap length at 12.
  const eventList = document.getElementById('event-list') as HTMLUListElement;
  const MAX_EVENTS = 12;
  subscribe((event) => {
    const li = document.createElement('li');
    li.textContent = event.message;
    li.className = `evt evt-${event.kind}`;
    eventList.appendChild(li);
    while (eventList.children.length > MAX_EVENTS) {
      eventList.removeChild(eventList.firstChild!);
    }
    // Fade-in
    requestAnimationFrame(() => li.classList.add('shown'));
  });
}
