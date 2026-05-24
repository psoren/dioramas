import { Sim } from '../sim/Sim';

export function mountHUD(_sim: Sim): void {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root not found');

  root.innerHTML = `
    <div class="panel" id="hud">
      <div class="eyebrow">DIORAMA</div>
      <h1>Coral Reef</h1>
      <div class="sub">Procedural underwater scene</div>
    </div>

    <div class="panel" id="hint">
      <kbd>drag</kbd> orbit · <kbd>scroll</kbd> zoom
    </div>
  `;
}
