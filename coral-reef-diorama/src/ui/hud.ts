import { Sim } from '../sim/Sim';

export function mountHUD(sim: Sim): void {
  const root = document.getElementById('ui-root');
  if (!root) throw new Error('#ui-root not found');

  root.innerHTML = `
    <div class="panel" id="hud">
      <div class="eyebrow">DIORAMA</div>
      <h1>Coral Reef</h1>
      <div class="sub">Procedural underwater scene</div>
      <div class="focus-row">
        <span class="focus-tag">NOW SHOWING</span>
        <span class="focus-label"></span>
      </div>
    </div>
  `;

  const hud = document.getElementById('hud') as HTMLDivElement | null;
  const labelEl = hud?.querySelector('.focus-label') as HTMLDivElement | null;
  if (!hud || !labelEl) return;

  // Poll the orbit camera each frame for the current focus subject. Cheap
  // string compare keeps DOM writes off the hot path when nothing changes.
  let shown: string | null = null;
  const tick = (): void => {
    const label = sim.orbit.focusLabel;
    if (label !== shown) {
      shown = label;
      if (label) {
        labelEl.textContent = label;
        hud.classList.add('focused');
      } else {
        hud.classList.remove('focused');
      }
    }
    requestAnimationFrame(tick);
  };
  tick();
}
