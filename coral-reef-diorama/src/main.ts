import * as THREE from 'three';
import { Sim } from './sim/Sim';
import { mountHUD } from './ui/hud';
import { OceanFloor, surfaceY } from './entities/OceanFloor';
import { Anemone } from './entities/Anemone';
import { ReefStructure } from './entities/ReefStructure';
import { FishSchool } from './entities/FishSchool';
import { Sunbeams } from './entities/Sunbeams';
import { SeaTurtle } from './entities/SeaTurtle';
import { MantaRay } from './entities/MantaRay';
import { Jellyfish } from './entities/Jellyfish';
import { DayNightCycle } from './entities/DayNightCycle';
import { MAT } from './world/materials';

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

  // God rays from the surface — drifts slowly. Adds the "light from above" feel.
  sim.add(new Sunbeams());

  // Coral reef centerpiece — replaces the central anemone slot. Anemones
  // ring it instead.
  sim.add(new ReefStructure());

  // A ring of anemones around the reef.
  const anemones: Array<{ position: [number, number, number]; variant?: 'pink' | 'green'; scale?: number }> = [
    { position: [3.4, 0, 1.6], variant: 'pink', scale: 0.9 },
    { position: [-3.2, 0, 1.0], variant: 'green', scale: 0.85 },
    { position: [1.0, 0, -3.4], variant: 'green', scale: 1.0 },
    { position: [-3.6, 0, -2.0], variant: 'pink', scale: 0.75 },
    { position: [3.8, 0, -2.4], variant: 'pink', scale: 0.85 },
    { position: [0.4, 0, 3.6], variant: 'green', scale: 0.95 },
  ];
  for (const p of anemones) {
    const y = surfaceY(p.position[0], p.position[2]);
    sim.add(new Anemone({
      position: [p.position[0], y, p.position[2]],
      variant: p.variant,
      scale: p.scale,
    }));
  }

  // Three fish schools — different species, different temperaments. Each
  // operates independently so they can interweave visually without merging.
  sim.add(new FishSchool({
    count: 34,
    centre: [0, 4.5, 0],
    boundRadius: 6,
    material: MAT.fishYellow,
    fishLength: 0.28,
    speed: 1.4,
    separationWeight: 1.6,
    alignmentWeight: 1.0,
    cohesionWeight: 0.9,
    neighbourRadius: 1.4,
  }));

  sim.add(new FishSchool({
    count: 22,
    centre: [-4, 3.5, 3],
    boundRadius: 4.5,
    material: MAT.fishBlue,
    fishLength: 0.38,
    speed: 1.0,
    separationWeight: 1.4,
    alignmentWeight: 1.2,
    cohesionWeight: 1.0,
    neighbourRadius: 1.8,
  }));

  sim.add(new FishSchool({
    count: 26,
    centre: [4, 5.5, -3],
    boundRadius: 5,
    material: MAT.fishSilver,
    fishLength: 0.22,
    speed: 1.9, // jittery silver minnows
    separationWeight: 2.0,
    alignmentWeight: 0.9,
    cohesionWeight: 0.7,
    neighbourRadius: 1.2,
  }));

  // Sea turtle: slow loop near the upper water, well clear of the reef.
  const turtlePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(8, 8, 0),
    new THREE.Vector3(5, 8.5, 7),
    new THREE.Vector3(-3, 8, 8),
    new THREE.Vector3(-8, 9, 2),
    new THREE.Vector3(-7, 8, -6),
    new THREE.Vector3(0, 8.5, -8),
    new THREE.Vector3(7, 8, -4),
  ], true, 'centripetal');
  const turtle = sim.add(new SeaTurtle({ path: turtlePath, speed: 0.025, t: 0.3 }));

  // Manta ray: much bigger, even slower, much wider loop, slightly different
  // altitude so it doesn't intersect the turtle's path.
  const mantaPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(12, 6, 8),
    new THREE.Vector3(0, 7, 13),
    new THREE.Vector3(-12, 6.5, 7),
    new THREE.Vector3(-13, 6, -3),
    new THREE.Vector3(-7, 6.5, -12),
    new THREE.Vector3(4, 6, -13),
    new THREE.Vector3(12, 6.5, -6),
  ], true, 'centripetal');
  const manta = sim.add(new MantaRay({ path: mantaPath, speed: 0.012, t: 0.1, scale: 1.2 }));

  // A few jellyfish drifting vertically — placed in the open water away
  // from the reef so their tendrils don't intersect coral.
  sim.add(new Jellyfish({ position: [6, 5, 5], driftRange: 2.5, scale: 1.0 }));
  sim.add(new Jellyfish({ position: [-5, 4, 6], driftRange: 2.0, scale: 1.1 }));
  sim.add(new Jellyfish({ position: [7, 6, -6], driftRange: 1.8, scale: 0.85 }));
  sim.add(new Jellyfish({ position: [-6, 5, -5], driftRange: 2.2, scale: 0.95 }));

  // Let the auto-camera occasionally zoom in on the larger creatures.
  // (Fish schools and tiny jellies are skipped — focusing on a 0.2-unit
  // boid is mostly chaos.)
  sim.orbit.focusCandidates = [turtle.object3d, manta.object3d];

  // Day/night cycle. Constructed AFTER lighting is in the scene (Sim sets it
  // up in its constructor) so the cycle entity can find the lights.
  sim.add(new DayNightCycle(sim));

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
