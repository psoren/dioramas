# LEGO 40786 Micro Command — Simulator

A 3D simulation of the LEGO Classic Space Micro Command Centre, structured
so you can keep adding new vehicles, buildings, and behaviors without
turning it into a 2000-line file.

## Run it

```sh
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
npm run typecheck
```

## Architecture

```
src/
├── main.ts                    # Bootstrap. Wire up entities, mount UI, start sim.
├── sim/
│   ├── Sim.ts                 # Renderer + scene + camera + entity registry + loop
│   ├── Entity.ts              # { object3d, update?(dt), dispose?() }
│   ├── OrbitCamera.ts         # Mouse-drag orbit, scroll-zoom
│   └── sceneSetup.ts          # Lighting + starfield
├── world/
│   ├── constants.ts           # Dimensions of everything (track, plate, etc.)
│   ├── materials.ts           # Shared LEGO-color materials (reuse!)
│   ├── shapes.ts              # Geometry helpers (rounded rects)
│   └── TrackPath.ts           # The Catmull-Rom curve the monorail follows
├── entities/
│   ├── BasePlate.ts           # The blue LEGO plate
│   ├── TrackRing.ts           # The gray track surface
│   ├── CommandCentre.ts       # The tower (animated dish + beacon)
│   ├── TrackVehicle.ts        # Base class for anything following a curve
│   └── Monorail.ts            # The pod that loops the track
└── ui/
    ├── hud.ts                 # The HUD overlay + control wiring
    └── styles.css
```

The contract is simple: anything in the world is an **`Entity`**:

```ts
interface Entity {
  readonly object3d: THREE.Object3D;
  update?(dt: number): void;
  dispose?(): void;
}
```

`Sim` owns an `entities: Entity[]`. Every frame it calls `update(dt)` on each.
Pause and speed are baked into `dt` before it reaches you — so the same code
handles play/pause/scrub for free.

## Adding things

### A second monorail going the other way

```ts
// main.ts
const counter = sim.add(
  new Monorail({ path: trackPath, speed: -0.07, t: 0.5 })
);
```

Negative speed runs the path in reverse. `t: 0.5` starts on the opposite side.

### A whole new vehicle (e.g. a maintenance cart)

Subclass `TrackVehicle`, implement `build()` to return a mesh group with the
forward direction along **+X**:

```ts
// src/entities/MaintenanceCart.ts
import * as THREE from 'three';
import { TrackVehicle, TrackVehicleOptions } from './TrackVehicle';
import { MAT } from '../world/materials';

export class MaintenanceCart extends TrackVehicle {
  constructor(opts: TrackVehicleOptions) { super(opts); }

  protected build(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.4, 0.5), MAT.yellow);
    body.position.y = 0.25;
    body.castShadow = true;
    g.add(body);
    return g;
  }
}
```

Then in `main.ts`:
```ts
sim.add(new MaintenanceCart({ path: trackPath, speed: 0.04, t: 0.25 }));
```

### A space truck driving freely on the baseplate

`TrackVehicle` assumes you follow a curve. For free-roaming you'll want a
sibling pattern — same `Entity` interface, different motion logic:

```ts
// src/entities/SpaceTruck.ts
import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export class SpaceTruck implements Entity {
  readonly object3d: THREE.Group;
  private heading = 0;          // radians
  private speed = 1.2;          // units/sec
  private turnRate = 0.6;       // rad/sec
  private bounds = 7.5;         // stay inside baseplate

  constructor() {
    this.object3d = this.build();
  }

  update(dt: number): void {
    // Random wander + bounce off the edge of the plate
    this.heading += (Math.random() - 0.5) * this.turnRate * dt;
    const dx = Math.cos(this.heading) * this.speed * dt;
    const dz = Math.sin(this.heading) * this.speed * dt;
    this.object3d.position.x += dx;
    this.object3d.position.z += dz;
    if (Math.abs(this.object3d.position.x) > this.bounds) this.heading = Math.PI - this.heading;
    if (Math.abs(this.object3d.position.z) > this.bounds) this.heading = -this.heading;
    this.object3d.rotation.y = -this.heading + Math.PI / 2;
  }

  private build(): THREE.Group {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.4, 0.5), MAT.white);
    body.position.y = 0.4;
    body.castShadow = true;
    g.add(body);
    // ... add wheels, cab, headlights, etc.
    return g;
  }
}
```

Register: `sim.add(new SpaceTruck());`

### A static building (e.g. a fuel depot)

Implement `Entity` without `update`:

```ts
// src/entities/FuelDepot.ts
import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export class FuelDepot implements Entity {
  readonly object3d = this.build();
  private build(): THREE.Group {
    const g = new THREE.Group();
    g.position.set(5, 0, -5);
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 1.2, 24), MAT.white);
    tank.position.y = 0.6;
    tank.castShadow = true;
    g.add(tank);
    return g;
  }
}
```

### An elevator on the tower (animated, no motion path)

```ts
// src/entities/Elevator.ts
import * as THREE from 'three';
import { Entity } from '../sim/Entity';
import { MAT } from '../world/materials';

export class Elevator implements Entity {
  readonly object3d: THREE.Group;
  private cab: THREE.Mesh;
  private phase = 0;

  constructor() {
    this.object3d = new THREE.Group();
    // Shaft
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.5, 4, 0.5), MAT.grayDark);
    shaft.position.set(-5.5, 2, 3.5);
    this.object3d.add(shaft);
    // Cab
    this.cab = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.6, 0.7), MAT.yellow);
    this.cab.position.set(-5.5, 0.5, 3.5);
    this.cab.castShadow = true;
    this.object3d.add(this.cab);
  }

  update(dt: number): void {
    this.phase += dt * 0.5;
    this.cab.position.y = 2 + Math.sin(this.phase) * 1.5;
  }
}
```

## Tips

- **Reuse materials.** `MAT.blue` etc. is shared — don't allocate new
  `MeshStandardMaterial` per mesh. Cuts GPU state changes.
- **Forward = +X** for `TrackVehicle` subclasses. The base class handles
  rotation; don't pre-rotate your mesh.
- **Dispose properly.** If you remove entities at runtime, override
  `dispose()` to free geometries and textures.
- **`window.sim`** is exposed in dev mode for poking around in the console.
- **Adding paths.** A second monorail loop, a road for the trucks, or a
  vertical elevator shaft is just another curve. See `world/TrackPath.ts`
  for the rounded-square template.

## Stack

- TypeScript (strict)
- Three.js
- Vite (dev server + bundler)
- No framework. If you want React Three Fiber later, the Entity pattern
  ports cleanly to R3F components.
