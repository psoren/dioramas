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
import { Caustics } from './entities/Caustics';
import { PatrolShark } from './entities/PatrolShark';
import { MorayEel } from './entities/MorayEel';
import { Starfish } from './entities/Starfish';
import { SurfaceCanopy } from './entities/SurfaceCanopy';
import { SeaUrchin } from './entities/SeaUrchin';
import { SeaSponge } from './entities/SeaSponge';
import { Kelp } from './entities/Kelp';
import { Octopus } from './entities/Octopus';
import { Crab } from './entities/Crab';
import { Stingray } from './entities/Stingray';
import { Seahorse } from './entities/Seahorse';
import { BubbleVent } from './entities/BubbleVent';
import { Bioluminescence } from './entities/Bioluminescence';
import { EventScheduler } from './entities/EventScheduler';
import { WorldState } from './world/WorldState';
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

  // Shared world state — read by many entities, written by DayNightCycle
  // and EventScheduler. Created early so it can be passed into entities at
  // construction time.
  const worldState = new WorldState();

  // Object3Ds the auto-camera may rotate through. Populated as entities are
  // created; assigned to sim.orbit.focusCandidates at the end. Each entry's
  // userData.focusLabel is shown in the HUD while it's the camera subject.
  const focusCandidates: THREE.Object3D[] = [];
  const tagAndFocus = (obj: THREE.Object3D, label: string): void => {
    obj.userData['focusLabel'] = label;
    focusCandidates.push(obj);
  };

  const oceanFloor = sim.add(new OceanFloor());
  const cameraColliders: THREE.Object3D[] = [oceanFloor.object3d];

  // Animated caustics on the sand — bright ripple from the imagined surface.
  sim.add(new Caustics());

  // Wavy semi-transparent water surface high above. Visible when the camera
  // tilts up. Static y; vertex-displaced rolling waves.
  sim.add(new SurfaceCanopy({ worldState }));

  // Bioluminescent specks scattered through the water — invisible by day,
  // fade in at night so the dark periods don't feel empty.
  sim.add(new Bioluminescence({ worldState, count: 260 }));

  // God rays from the surface — drifts slowly. Adds the "light from above" feel.
  sim.add(new Sunbeams());

  // Coral reef centerpiece — replaces the central anemone slot. Anemones
  // ring it instead.
  const mainReef = sim.add(new ReefStructure());
  cameraColliders.push(mainReef.object3d);

  // Satellite reef outcrops scattered around the central reef. Each uses a
  // different seed so the coral mix differs; smaller mound radii so they
  // read as supporting features, not competing centerpieces.
  const satellites: Array<{ pos: [number, number, number]; scale: number; seed: number; mound: number; yaw: number }> = [
    { pos: [10, 0, 6],   scale: 0.9, seed: 1010101, mound: 1.4, yaw: 0.4 },
    { pos: [-9, 0, -7],  scale: 0.85, seed: 2020202, mound: 1.6, yaw: -1.1 },
    { pos: [-12, 0, 4],  scale: 0.7, seed: 3030303, mound: 1.1, yaw: 2.3 },
    { pos: [8, 0, -10],  scale: 0.95, seed: 4040404, mound: 1.5, yaw: -0.6 },
    { pos: [0, 0, 14],   scale: 0.65, seed: 5050505, mound: 1.0, yaw: 1.7 },
  ];
  for (const s of satellites) {
    const sat = sim.add(new ReefStructure({
      position: [s.pos[0], surfaceY(s.pos[0], s.pos[2]), s.pos[2]],
      scale: s.scale,
      seed: s.seed,
      moundRadius: s.mound,
      yaw: s.yaw,
    }));
    cameraColliders.push(sat.object3d);
  }

  // Obstacle list passed to fish schools so the boids don't clip through reefs.
  // Each obstacle is the rough sphere occupied by a reef's dome.
  const reefObstacles: Array<{ position: THREE.Vector3Tuple; radius: number }> = [
    { position: [0, 1.0, 0], radius: 3.0 },
    ...satellites.map(s => ({
      position: [s.pos[0], surfaceY(s.pos[0], s.pos[2]) + s.mound * s.scale * 0.5, s.pos[2]] as THREE.Vector3Tuple,
      radius: s.mound * s.scale * 1.35,
    })),
  ];

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
      worldState,
    }));
  }

  // Patrol shark — built first so we can pass its Object3D into the schools
  // as a predator and into the eel as a scare trigger.
  const sharkPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(7, 3.0, 5),
    new THREE.Vector3(0, 3.2, 8),
    new THREE.Vector3(-7, 3.0, 5),
    new THREE.Vector3(-9, 3.5, -2),
    new THREE.Vector3(-5, 3.2, -8),
    new THREE.Vector3(3, 3.5, -9),
    new THREE.Vector3(9, 3.2, -3),
  ], true, 'centripetal');
  const shark = sim.add(new PatrolShark({ path: sharkPath, speed: 0.018, t: 0.55, worldState }));
  const sharkPredator = [shark.object3d];
  tagAndFocus(shark.object3d, 'Patrol Shark');

  // Three "big-water" fish schools — different species, different temperaments.
  // Each operates independently so they can interweave visually without merging.
  const schoolYellow = sim.add(new FishSchool({
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
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
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
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  sim.add(new FishSchool({
    count: 26,
    centre: [4, 5.5, -3],
    boundRadius: 5,
    material: MAT.fishSilver,
    fishLength: 0.22,
    speed: 1.9,
    separationWeight: 2.0,
    alignmentWeight: 0.9,
    cohesionWeight: 0.7,
    neighbourRadius: 1.2,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Tall blue tangs — upright body, slow languid drift over the reef.
  sim.add(new FishSchool({
    count: 14,
    centre: [0, 2.5, 0],
    boundRadius: 3.8,
    material: MAT.fishTang,
    fishLength: 0.42,
    bodyShape: 'upright',
    bodyAspect: 0.42,
    speed: 0.8,
    separationWeight: 1.5,
    alignmentWeight: 1.0,
    cohesionWeight: 0.9,
    neighbourRadius: 1.6,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Clownfish — small, close to the anemones on the +X side.
  sim.add(new FishSchool({
    count: 10,
    centre: [3.4, 1.5, 1.6],
    boundRadius: 1.6,
    material: MAT.fishClown,
    fishLength: 0.2,
    bodyShape: 'upright',
    bodyAspect: 0.32,
    speed: 0.9,
    separationWeight: 1.6,
    alignmentWeight: 0.8,
    cohesionWeight: 1.2,
    neighbourRadius: 1.0,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Lime parrotfish — chunky, mid-depth.
  const schoolLime = sim.add(new FishSchool({
    count: 12,
    centre: [-3, 3, -3],
    boundRadius: 3.5,
    material: MAT.fishLime,
    fishLength: 0.48,
    bodyShape: 'upright',
    bodyAspect: 0.36,
    speed: 0.7,
    separationWeight: 1.8,
    alignmentWeight: 0.9,
    cohesionWeight: 0.8,
    neighbourRadius: 1.7,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Royal-purple wrasses — fast, deep, tight.
  sim.add(new FishSchool({
    count: 30,
    centre: [-4, 6, -5],
    boundRadius: 4.5,
    material: MAT.fishPurple,
    fishLength: 0.26,
    speed: 1.6,
    separationWeight: 1.7,
    alignmentWeight: 1.3,
    cohesionWeight: 1.1,
    neighbourRadius: 1.4,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Cyan neons — tiny, dense, glassy.
  sim.add(new FishSchool({
    count: 50,
    centre: [2, 7, 4],
    boundRadius: 4,
    material: MAT.fishCyan,
    fishLength: 0.16,
    speed: 1.8,
    separationWeight: 2.0,
    alignmentWeight: 1.1,
    cohesionWeight: 0.9,
    neighbourRadius: 1.1,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Pink anthias.
  sim.add(new FishSchool({
    count: 18,
    centre: [3, 2, 4],
    boundRadius: 3,
    material: MAT.fishPink,
    fishLength: 0.24,
    bodyShape: 'upright',
    bodyAspect: 0.3,
    speed: 1.1,
    separationWeight: 1.6,
    alignmentWeight: 1.0,
    cohesionWeight: 1.0,
    neighbourRadius: 1.3,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
  }));

  // Red snappers — slower, deeper, larger.
  sim.add(new FishSchool({
    count: 9,
    centre: [-5, 4, 4],
    boundRadius: 4,
    material: MAT.fishRed,
    fishLength: 0.55,
    bodyShape: 'upright',
    bodyAspect: 0.28,
    speed: 0.95,
    separationWeight: 1.7,
    alignmentWeight: 1.0,
    cohesionWeight: 0.8,
    neighbourRadius: 2.0,
    predators: sharkPredator,
    obstacles: reefObstacles,
    worldState,
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
  tagAndFocus(turtle.object3d, 'Sea Turtle');

  // Manta ray.
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
  tagAndFocus(manta.object3d, 'Manta Ray');

  // Stingray — flat glider hugging the floor.
  const rayPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(10, 1.0, -4),
    new THREE.Vector3(4, 1.2, -10),
    new THREE.Vector3(-6, 1.0, -8),
    new THREE.Vector3(-11, 1.2, 0),
    new THREE.Vector3(-7, 1.0, 8),
    new THREE.Vector3(2, 1.2, 11),
    new THREE.Vector3(11, 1.0, 5),
  ], true, 'centripetal');
  const stingray = sim.add(new Stingray({ path: rayPath, speed: 0.022, t: 0.4 }));
  tagAndFocus(stingray.object3d, 'Stingray');

  // Crab — small loop on the sand off to the front-right of the reef.
  const crabPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(5, surfaceY(5, 5) + 0.15, 5),
    new THREE.Vector3(7, surfaceY(7, 6) + 0.15, 6),
    new THREE.Vector3(7, surfaceY(7, 9) + 0.15, 9),
    new THREE.Vector3(4, surfaceY(4, 9) + 0.15, 9),
    new THREE.Vector3(3, surfaceY(3, 7) + 0.15, 7),
    new THREE.Vector3(4, surfaceY(4, 5) + 0.15, 5),
  ], true, 'centripetal');
  const crab = sim.add(new Crab({ path: crabPath, speed: 0.05, t: 0 }));
  tagAndFocus(crab.object3d, 'Crab');

  // Jellyfish drifting vertically.
  const jellySpots: Array<{ position: [number, number, number]; driftRange: number; scale: number }> = [
    { position: [6, 5, 5],  driftRange: 2.5, scale: 1.0 },
    { position: [-5, 4, 6], driftRange: 2.0, scale: 1.1 },
    { position: [7, 6, -6], driftRange: 1.8, scale: 0.85 },
    { position: [-6, 5, -5], driftRange: 2.2, scale: 0.95 },
  ];
  for (const j of jellySpots) {
    const jelly = sim.add(new Jellyfish({ ...j, worldState }));
    tagAndFocus(jelly.object3d, 'Jellyfish');
  }

  // Moray eel — head peeks out of the side of the reef. Tracks the shark
  // (retracts when it passes) and the closest fish (snaps more when prey is
  // near). EventScheduler also pokes its `ambush()` periodically.
  const eel = sim.add(new MorayEel({
    position: [-2.0, 0.8, -1.2],
    yaw: Math.PI * 0.85,
    scale: 1.0,
    predator: shark.object3d,
    scareRadius: 4,
    prey: schoolLime.object3d.children,
    huntRadius: 2.5,
  }));
  tagAndFocus(eel.object3d, 'Moray Eel');

  // Starfish scattered on rocks/sand.
  const starfish: Array<{ position: [number, number, number]; yaw?: number; scale?: number; phase?: number }> = [
    { position: [2.6, 0, 2.4], yaw: 0.4, scale: 1.0, phase: 0 },
    { position: [-2.4, 0, 2.8], yaw: -0.9, scale: 0.85, phase: 1.1 },
    { position: [3.6, 0, -1.6], yaw: 1.7, scale: 0.95, phase: 2.3 },
    { position: [-1.4, 0, -3.0], yaw: 2.4, scale: 0.8, phase: 3.5 },
  ];
  for (const s of starfish) {
    // Sit just above the sand so the flat arms don't poke through the ripples.
    const y = surfaceY(s.position[0], s.position[2]) + 0.06;
    const sf = sim.add(new Starfish({
      position: [s.position[0], y, s.position[2]],
      yaw: s.yaw,
      scale: s.scale,
      phase: s.phase,
    }));
    tagAndFocus(sf.object3d, 'Starfish');
  }

  // Sea urchins — scattered on the floor between reefs.
  const urchins: Array<[number, number, number]> = [
    [4.2, 0, 3.6], [-3.8, 0, 4.2], [5.5, 0, -2.4], [-4.8, 0, -3.5],
    [9, 0, 8], [-10, 0, -5], [-6, 0, 9], [7, 0, -7],
  ];
  for (const [x, _y, z] of urchins) {
    // Lift the body so most of the sphere is above sand — bottom hemisphere
    // hides in the sand, top hemisphere is fully visible regardless of dunes.
    sim.add(new SeaUrchin({ position: [x, surfaceY(x, z) + 0.12, z], scale: 0.9 + Math.random() * 0.4 }));
  }

  // Sea sponges — clusters in various colours near reefs.
  const sponges: Array<{ pos: [number, number, number]; variant: 'red' | 'orange' | 'purple'; scale: number }> = [
    { pos: [-7, 0, 5],  variant: 'red',    scale: 1.0 },
    { pos: [6, 0, -6],  variant: 'orange', scale: 1.1 },
    { pos: [-5, 0, -9], variant: 'purple', scale: 0.9 },
    { pos: [11, 0, -1], variant: 'orange', scale: 0.95 },
    { pos: [-13, 0, 2], variant: 'red',    scale: 0.85 },
  ];
  for (const s of sponges) {
    sim.add(new SeaSponge({
      position: [s.pos[0], surfaceY(s.pos[0], s.pos[2]) + 0.02, s.pos[2]],
      variant: s.variant,
      scale: s.scale,
    }));
  }

  // Kelp clumps — tall, swaying, around the outer perimeter.
  const kelpSpots: Array<{ pos: [number, number, number]; scale: number; variant: 'dark' | 'light' }> = [
    { pos: [13, 0, 3],   scale: 1.0, variant: 'dark' },
    { pos: [-13, 0, -3], scale: 1.1, variant: 'light' },
    { pos: [5, 0, 13],   scale: 1.0, variant: 'dark' },
    { pos: [-5, 0, -13], scale: 0.95, variant: 'light' },
    { pos: [12, 0, -11], scale: 1.05, variant: 'dark' },
    { pos: [-11, 0, 11], scale: 1.0, variant: 'light' },
  ];
  for (const k of kelpSpots) {
    sim.add(new Kelp({
      position: [k.pos[0], surfaceY(k.pos[0], k.pos[2]), k.pos[2]],
      scale: k.scale,
      variant: k.variant,
      worldState,
    }));
  }

  // Octopus on a rock near the back of the central reef. EventScheduler
  // periodically jets it to one of the candidate perches below.
  const octopus = sim.add(new Octopus({
    position: [-4.5, surfaceY(-4.5, -1.5) + 0.05, -1.5],
    yaw: 0.6,
    scale: 1.0,
  }));
  tagAndFocus(octopus.object3d, 'Octopus');
  const octopusRocks: Array<[number, number, number]> = [
    [-4.5, surfaceY(-4.5, -1.5) + 0.05, -1.5],
    [4.5, surfaceY(4.5, 2.0) + 0.05, 2.0],
    [-3.0, surfaceY(-3.0, 3.5) + 0.05, 3.5],
    [3.0, surfaceY(3.0, -3.5) + 0.05, -3.5],
    [-9.5, surfaceY(-9.5, -7.0) + 0.1, -7.0],
    [9.5, surfaceY(9.5, 5.5) + 0.1, 5.5],
  ];

  // Seahorses near the coral pillars.
  const seahorses: Array<[number, number, number]> = [
    [2.4, 1.8, -2.6],
    [-2.0, 1.6, 2.4],
    [3.2, 1.5, 2.8],
  ];
  for (const [x, y, z] of seahorses) {
    const sh = sim.add(new Seahorse({ position: [x, y, z], scale: 0.9 }));
    tagAndFocus(sh.object3d, 'Seahorse');
  }

  // Auto-camera rotates through every creature in `focusCandidates` —
  // populated as entities were created above. Cycle is focusDuration +
  // focusInterval = ~15s per pick.
  sim.orbit.focusCandidates = focusCandidates;
  // Static rocks/reefs the camera should not pass through. Raycasted from
  // target outward every frame to clamp orbit distance.
  sim.orbit.colliders = cameraColliders;

  // Bubble vents — small dark spots on the seafloor with continuous trickle
  // emission. EventScheduler fires periodic bursts.
  const ventSpots: Array<[number, number]> = [
    [6, 10], [-10, 3], [12, -4], [-6, -11], [2, -8],
  ];
  const vents = ventSpots.map(([x, z]) =>
    sim.add(new BubbleVent({ position: [x, surfaceY(x, z), z], capacity: 30 })),
  );

  // Day/night cycle. Constructed AFTER lighting is in the scene (Sim sets it
  // up in its constructor) so the cycle entity can find the lights. Writes
  // dayNess into worldState each frame.
  sim.add(new DayNightCycle(sim, worldState));

  // Event scheduler — drives shark hunts, migrating schools, plankton blooms,
  // bubble bursts, octopus relocations, and eel ambushes. Added last so any
  // entities it references already exist.
  sim.add(new EventScheduler({
    sim,
    worldState,
    huntableSchools: [schoolYellow, schoolLime],
    vents,
    eel,
    octopus,
    octopusRocks,
  }));

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
