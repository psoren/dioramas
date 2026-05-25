# Handoff

## Project

`lego-retro-space-visualizer` is a Vite + TypeScript + Three.js simulator for
LEGO retro space scenes. It started as a LEGO 40786 Micro Command Centre
visualizer and has been extended into a small expandable scene system with
tracks, trains, loaders, stations, vehicles, astronauts, and other retro-space
set-inspired models.

Public repo:

https://github.com/psoren/lego-retro-space-visualizer

## Run

```sh
npm install
npm run dev -- --host 127.0.0.1
npm run typecheck
npm run build
```

Current local dev server has been using:

```txt
http://127.0.0.1:5174/
```

Port `5173` may already be used by another local project.

## Current Status

Implemented:

- Manifest-driven scene construction in `src/world/sceneManifest.ts`.
- Larger figure-eight monorail route with named stations and a central crossing
  in `src/world/TrackPath.ts`.
- Path-following vehicle base in `src/entities/PathVehicle.ts`.
- Multi-car monorail train in `src/entities/MonorailTrain.ts`.
- Station cargo loading/unloading behavior in `src/entities/StationLoader.ts`.
- Track crossing reservation/hold logic in `src/entities/TrackController.ts`.
- Road loop and moving space trucks.
- Command centre with extra details: solar panel, interior hints, roof studs.
- Elevator, station platforms, and animated micro astronauts.
- Retro-space set-inspired models in `src/entities/retroSets.ts`:
  - Micro Rocket Launchpad
  - Galaxy Explorer-style flyover ship
  - Galaxy Explorer-style rover
  - Robot helper
  - Blacktron-style cruiser
  - Blacktron-style outpost

Last verified:

- `npm run typecheck` passes.
- `npm run build` passes.
- Browser runtime had no app errors.
- Latest screenshot path from verification: `/tmp/lego-visualizer-retrosets.png`.

## Architecture

Core contract:

```ts
interface Entity {
  readonly object3d: THREE.Object3D;
  update?(dt: number): void;
  dispose?(): void;
}
```

`Sim` owns the renderer, scene, camera, and entity list. It calls `update(dt)`
on every entity each frame.

Scene construction now flows through:

```txt
main.ts
  -> defaultSceneManifest
  -> buildSceneEntity(spec, registry)
  -> sim.add(entity)
```

Use `targetId` / `targetIds` in manifest entries for behavior entities that
need references to other entities, such as station loaders or track controllers.

## Important Files

- `src/main.ts` - bootstraps the scene from the manifest.
- `src/sim/Sim.ts` - renderer, entity loop, camera, scene.
- `src/world/sceneManifest.ts` - declarative scene contents.
- `src/world/TrackPath.ts` - monorail route, stations, intersections.
- `src/world/RoadPath.ts` - road loop for trucks.
- `src/entities/PathVehicle.ts` - reusable closed-path vehicle base.
- `src/entities/MonorailTrain.ts` - train mesh, cargo slots, cargo API.
- `src/entities/StationLoader.ts` - crane/load/unload behavior.
- `src/entities/TrackController.ts` - crossing reservation logic.
- `src/entities/retroSets.ts` - additional retro-space set-inspired models.
- `src/ui/hud.ts` / `src/ui/styles.css` - HUD and controls.

## Known Rough Edges

- The current track network is functional but still stylized. It is not a
  physically accurate LEGO rail geometry.
- Station/platform placement is manifest-driven, but station visuals may need
  manual tuning as track routes change.
- Track crossing logic is route-specific and currently models one central
  shared crossing block.
- The HUD still only tracks the telemetry vehicle, not all stations/trains.
- Bundle-size warning is expected from Three.js:
  chunks exceed 500 kB after minification.
- `dist/` exists locally from builds and is ignored by `.gitignore`.

## Adding A New Static Set Model

1. Add a class implementing `Entity`, usually in `src/entities/retroSets.ts` or
   a new entity file.
2. Add a new `EntityKind` in `src/world/sceneManifest.ts`.
3. Add a case in `buildSceneEntity`.
4. Add a manifest entry with `position` and `heading`.

## Adding A New Train Or Vehicle

For route-following vehicles:

- Extend `PathVehicle` or `TrackVehicle`.
- Build mesh forward-facing along local `+X`.
- Add a manifest kind and entry.

For trains on the monorail:

- Use `MonorailTrain`.
- Point it at a `routeId`.
- Stagger `t` values so trains do not start overlapped.
- Add it to `TrackController.targetIds` if it should respect crossings.

## Adding A Station

1. Add a station object to `trackRoutes.main.stations` in `TrackPath.ts`.
2. Add a `stationPlatform` manifest entry with the same `stationId`.
3. Add a `stationLoader` manifest entry pointing at a train via `targetId`.

Example:

```ts
{
  id: 'new-loader',
  kind: 'stationLoader',
  routeId: 'main',
  stationId: 'new-station',
  targetId: 'main-train',
}
```

## Verification Workflow

Use:

```sh
npm run typecheck
npm run build
```

For browser verification, open:

```txt
http://127.0.0.1:5174/
```

During previous work, browser screenshots were captured through Chrome DevTools
Protocol using an isolated Chrome profile on port `9224`.

## Suggested Next Work

- Add a UI panel for toggling categories: command centre, monorail network,
  Classic Space sets, Blacktron sets, vehicles, people.
- Add labels or hover/click inspection for set-inspired models.
- Improve station logic so loaders can choose trains dynamically instead of
  being assigned to a fixed train.
- Add proper block sections to the whole route, not only one crossing.
- Make track routes data-only and move route generation helpers to a reusable
  route builder.
- Add tests for path reservation / station cargo behavior.
