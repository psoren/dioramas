# Coral Reef Diorama — project prompt

Drop this into a fresh Claude session to start building the project.

---

Build a real-time 3D **coral reef diorama** in TypeScript + Three.js + Vite, in
the same style as the sibling `lego-retro-space-train` project. Hand-rolled
meshes (no GLTF imports), thin engine layer, entity-per-thing.

## Architecture (mirror the train project)

- `src/sim/Sim.ts` owns renderer/scene/camera and runs an entity update loop.
- `src/sim/Entity.ts` interface: `object3d: THREE.Object3D` + optional
  `update(dt)` + optional `dispose()`. `dt` is already scaled by sim speed and
  zeroed when paused.
- `src/sim/OrbitCamera.ts` for user-controlled view (orbit + zoom).
  Underwater-tuned defaults — closer in, slightly downward elevation.
- `src/world/materials.ts` — single shared palette. **Don't allocate per-mesh.**
- `src/entities/` — one file per kind of thing.
- `src/main.ts` — instantiate Sim, add entities, start.

## Scene

A chunk of coral reef on a sandy ocean floor, with the camera underwater.
Atmosphere is blue-green fog, filtered sunlight from above, gentle ambient
drift.

## Entities to build, in this order

1. **`OceanFloor`** — large sandy disc (radius ~60), pale yellow-brown, gentle
   dune undulation via vertex displacement. Receives shadows. Scatter ~30 small
   rocks and ~20 shell debris pieces deterministically (seeded RNG).

2. **`Caustics`** — flat plane just above the floor with an animated noise
   pattern or shader that scrolls a procedural ripple to simulate sun caustics
   on the sand. Subtle.

3. **`ReefStructure`** — the central reef. Procedural pile of branching coral,
   brain coral domes, fan corals. Built from a small set of primitive helpers
   (`branchCoral`, `brainCoral`, `fanCoral`). 4-6 of these clustered together,
   varied colors (purples, oranges, mustard, deep red).

4. **`Anemone`** — base disc + many tendrils (cylinders or stretched cones)
   each swaying via `sin(time + phaseOffset)`. Place 4-6 of them around the
   reef. Tendrils animated, base static.

5. **`FishSchool`** — *the heart of it.* Implement 3D **boids** with
   separation, alignment, cohesion + soft bounds. Each fish is a small
   flat-ish mesh (two triangles, oriented to velocity). 2-3 schools of ~25-40
   fish, each species a different color/size. Schools shouldn't intermix —
   separate parameters per school. Should look natural — bursts of motion,
   slow drifts, occasional direction flips.

6. **`PatrolShark`** — extends a `PathVehicle` base; follows a closed
   `CatmullRomCurve3` that loops around the reef in a slow lazy arc. Mesh:
   streamlined gray body with dorsal fin + tail fin. Tail wags as a sine of
   speed. Slow, ominous.

7. **`Diver`** — spawned periodically (every 30-60s). Enters from one edge of
   the scene, swims across with leg-kick animation, exits the other side.
   Trails a thin stream of bubble particles. Wears recognizable scuba gear
   (tank on back, mask, fins).

8. **`Sunbeams`** — 3-5 stretched semi-transparent cones reaching down from
   the surface (y ≈ 30) to the floor. Subtle pale-yellow tint. Static or very
   slow drift.

9. **`SurfaceCanopy`** — overhead plane at y≈30 with a wavy semi-transparent
   blue material, hinting at the water surface above. Should be visible when
   the camera looks up.

10. **Stationary creatures** — `MorayEel` (head poking out of a coral hole,
    occasional jaw open), `Starfish` (on a rock, slowly arms-curling),
    `SeaTurtle` (drifting in slow circles near the surface canopy).

## Engine details

- Fog: `THREE.Fog(0x0a5070, 8, 60)` — blue-green underwater haze.
- Background: same color as fog.
- Lighting: one bright directional "sun" from above-and-slightly-side, low
  ambient blue fill, faint cyan rim.
- Scale: ~1 unit per 50 cm. Reef should fit in roughly a 20-unit cube.
- Optional time-of-day: slow sun-angle sweep over ~3 minutes.

## Conventions

- TypeScript strict mode + `noUncheckedIndexedAccess`.
- No React, no physics engine. Boids math is hand-rolled.
- Shared materials in `MAT`. Clone for animated emissives.
- Verify with `npm run typecheck && npm run build`. Manual visual check via
  `npm run dev`.
- For UI/visual changes, ask the human to confirm.

## Build order

Start with the floor + one anemone visible, then add entities incrementally.
**The boids fish school is the centerpiece** — get it looking natural before
adding the diver/shark/eel.

## Scaffold already in place

- `package.json` with Three.js + TypeScript + Vite already added.
- Empty `src/{sim,world,entities,ui}/` directory tree.

To install + start:

```sh
npm install
npm run dev
```
