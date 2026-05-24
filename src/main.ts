import { Sim } from './sim/Sim';
import { mountHUD } from './ui/hud';
import { OceanFloor, surfaceY } from './entities/OceanFloor';
import { Anemone } from './entities/Anemone';

window.addEventListener('error', (event) => {
  showStartupError('Runtime', event.error ?? event.message);
});
window.addEventListener('unhandledrejection', (event) => {
  showStartupError('Runtime promise', event.reason);
});

try {
  boot();
} catch (error) {
  showStartupError('Boot', error);
  throw error;
}

function boot(): void {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('#scene canvas not found');

  const sim = new Sim(canvas);

  sim.add(new OceanFloor());

  // A small cluster of anemones in the centre of the scene where the reef
  // will eventually grow.
  const placements: Array<{ position: [number, number, number]; variant?: 'pink' | 'green'; scale?: number }> = [
    { position: [0, 0, 0], variant: 'pink', scale: 1.0 },
    { position: [2.0, 0, 1.2], variant: 'green', scale: 0.85 },
    { position: [-1.8, 0, 0.8], variant: 'pink', scale: 0.9 },
    { position: [0.6, 0, -2.1], variant: 'green', scale: 1.1 },
    { position: [-2.4, 0, -1.6], variant: 'pink', scale: 0.75 },
  ];
  for (const p of placements) {
    const y = surfaceY(p.position[0], p.position[2]);
    sim.add(new Anemone({
      position: [p.position[0], y, p.position[2]],
      variant: p.variant,
      scale: p.scale,
    }));
  }

  mountHUD(sim);
  sim.start();
}

function showStartupError(label: string, error: unknown): void {
  const root = document.getElementById('ui-root') ?? document.body;
  const panel = document.createElement('div');
  panel.className = 'panel error-panel';
  const message = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  panel.textContent = `${label} error\n${message}`;
  root.appendChild(panel);
}
