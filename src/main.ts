import { Sim } from './sim/Sim';
import { BasePlate } from './entities/BasePlate';
import { TrackRing } from './entities/TrackRing';
import { CommandCentre } from './entities/CommandCentre';
import { Monorail } from './entities/Monorail';
import { trackPath } from './world/TrackPath';
import { mountHUD } from './ui/hud';

const canvas = document.getElementById('scene') as HTMLCanvasElement;
const sim = new Sim(canvas);

// ----- Static structures -----
sim.add(new BasePlate());
sim.add(new TrackRing());
sim.add(new CommandCentre());

// ----- Vehicles -----
const monorail = sim.add(
  new Monorail({
    path: trackPath,
    speed: 0.07,
    t: 0,
  }),
);

// ----- UI -----
mountHUD(sim, {
  setNumber: '40786',
  setName: 'Micro Command Centre',
  subtitle: 'Classic Space · Telemetry',
  trackedVehicle: monorail,
});

sim.start();

// Expose for debugging from the browser console
if (import.meta.env.DEV) {
  (window as unknown as { sim: Sim }).sim = sim;
}
