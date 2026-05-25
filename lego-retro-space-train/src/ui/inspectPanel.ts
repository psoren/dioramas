import { Entity } from '../sim/Entity';

export interface InspectInfo {
  id: string;
  kind: string;
  positionLabel: string;
  /** Optional extra state lines: [key, value] pairs. */
  extras?: Array<[string, string]>;
}

export interface InspectController {
  show(info: InspectInfo): void;
  hide(): void;
}

/**
 * Mounts a fixed side panel that displays info about whichever entity the
 * user last clicked. Hidden by default; populated by `show()` and dismissed
 * by `hide()` (or clicking empty space).
 */
export function mountInspectPanel(): InspectController {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root not found');

  const panel = document.createElement('div');
  panel.className = 'panel inspect-panel';
  panel.id = 'inspect-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <button class="inspect-close" id="inspect-close">✕</button>
    <div class="eyebrow">INSPECT</div>
    <h2 id="inspect-name">—</h2>
    <div class="sub" id="inspect-kind">—</div>
    <div class="divider"></div>
    <div class="stat"><span>Position</span><span id="inspect-pos">—</span></div>
    <div id="inspect-extras"></div>
  `;
  root.appendChild(panel);

  const name = document.getElementById('inspect-name')!;
  const kind = document.getElementById('inspect-kind')!;
  const pos = document.getElementById('inspect-pos')!;
  const extras = document.getElementById('inspect-extras')!;
  const closeBtn = document.getElementById('inspect-close') as HTMLButtonElement;

  const controller: InspectController = {
    show(info) {
      name.textContent = info.id;
      kind.textContent = info.kind;
      pos.textContent = info.positionLabel;
      extras.innerHTML = '';
      for (const [k, v] of info.extras ?? []) {
        const row = document.createElement('div');
        row.className = 'stat';
        row.innerHTML = `<span>${k}</span><span>${v}</span>`;
        extras.appendChild(row);
      }
      panel.style.display = '';
    },
    hide() {
      panel.style.display = 'none';
    },
  };

  closeBtn.addEventListener('click', () => controller.hide());
  return controller;
}

/** Build the per-entity inspect snapshot from an Entity instance. */
export function describeEntity(spec: { id: string; kind: string }, entity: Entity): InspectInfo {
  const p = entity.object3d.position;
  const positionLabel = `${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)}`;
  const extras: Array<[string, string]> = [];
  const anyEnt = entity as Entity & {
    speed?: number;
    laps?: number;
    t?: number;
  };
  if (typeof anyEnt.speed === 'number') extras.push(['Speed', anyEnt.speed.toFixed(3)]);
  if (typeof anyEnt.laps === 'number') extras.push(['Laps', String(anyEnt.laps)]);
  if (typeof anyEnt.t === 'number') extras.push(['Path t', anyEnt.t.toFixed(3)]);
  return { id: spec.id, kind: spec.kind, positionLabel, extras };
}
