# TASKS

Scoped, acceptance-criteria-bearing chunks of work. Pick one, do it, mark done. If you want to convert these to GitHub Issues, the format maps 1:1 (title = first line, body = the rest).

---

## Open

### 1. SpaceTruck entity with wander behavior

Create `src/entities/SpaceTruck.ts`. The README has a scaffold — use it as a starting point but make the truck actually look like something (not just a box).

**Acceptance:**
- Truck has a recognizable shape: cab + cargo bed + visible wheels.
- White or gray primary color with a blue or yellow accent (LEGO palette only — use `MAT`).
- Wanders the baseplate, stays inside `±BASE_SIZE` bounds.
- Wheels rotate based on speed.
- `main.ts` instantiates two of them at different starting positions.
- Doesn't intersect the track ring (avoid the inner area).

---

### 2. Elevator on the command tower

Create `src/entities/Elevator.ts`. The cab should travel between the baseplate and the cabin roof of the `CommandCentre`.

**Acceptance:**
- Shaft is anchored to one of the command tower legs (no floating shaft).
- Cab is yellow trans (`MAT.yellowTrans`) so it glows slightly.
- Motion is smooth, with a pause at top and bottom (use a state machine, not raw `sin`).
- Doesn't visually clip through the command center cabin.
- Wired up in `main.ts`.

Position the shaft on the rear corner of the command tower to avoid blocking the camera's view of the train.

---

### 3. Road network for SpaceTrucks

Currently SpaceTrucks random-walk. Give them an actual path system: a closed `CatmullRomCurve3` around the outer perimeter of the baseplate, parallel to but outside the track ring.

**Acceptance:**
- New file `src/world/RoadPath.ts` exports a `roadPath` curve.
- Update `SpaceTruck` (or introduce a `RoadVehicle` base class) to follow `roadPath` instead of wandering.
- Two trucks on the road, one going each direction.
- Road is visually represented on the baseplate (lighter gray strip, similar to how `TrackRing` renders).

If you go the `RoadVehicle` base class route, consider whether to merge it with `TrackVehicle` into a shared `PathVehicle` — propose the refactor first, don't just do it.

---

### 4. Multiple monorail cars

A passenger train: locomotive + 2 trailing cars, all blue trans, connected and following the same curve with a fixed offset between them.

**Acceptance:**
- New file `src/entities/MonorailTrain.ts` (or extend `Monorail.ts`).
- 3-car train, locomotive at front, identical passenger cars behind.
- Cars are spaced so the train looks continuous, not gappy.
- Cars rotate correctly through the corners (each car follows the path independently at offset `t` values).
- Replaces the current single-car `Monorail` in `main.ts`.

The naive approach (rigid offsets in local space) breaks on corners. The correct approach is to sample the path at `t`, `t - delta`, `t - 2*delta` for the three cars.

---

### 5. Persistent camera state

The orbit camera resets on every page load. Save its state to `localStorage` and restore on boot.

**Acceptance:**
- Camera position survives a reload.
- "Reset View" button still works (goes to default, not last saved).
- Throttled to no more than 1 write per second (don't write on every pointermove).
- Gracefully handles corrupt or missing localStorage.

---

### 7. Render everything out of actual LEGO bricks

Replace ad-hoc `BoxGeometry`/`CylinderGeometry` calls with a small library of brick primitives so every entity reads as actual stud-bearing LEGO instead of generic boxes.

**Acceptance:**
- New file `src/world/bricks.ts` exports `brick(w, h, d, opts)` and `plate(w, d, opts)` (plus `slope`, `cylinder`, `dish`, `antenna` if cheap) — each returns a `THREE.Group` with the correct chamfer + stud bumps on top and the right color from `MAT`.
- Stud size and brick height match LEGO ratios (1 stud = 0.8 LEGO units = some scene scale; 1 brick = 3 plates tall).
- Every existing entity rebuilt in terms of brick primitives. No `BoxGeometry` direct calls outside `bricks.ts` and `BasePlate.ts`.
- Materials still go through `MAT` so palette is consistent.
- Frame rate doesn't regress (instanced studs if needed — a 6x4 brick has 24 studs and many entities will share geometry).

This is a big visual upgrade — the current models read as "blocks", and switching to brick primitives makes them read as LEGO. Suggested order: write the primitives, port one entity (e.g. `CommandCentre`) as a proof of concept and confirm scale + perf, then port the rest.

---

## Done

### 6. Stars react to camera

Implemented as a new `Starfield` entity (`src/entities/Starfield.ts`) with three layered point clouds at different `followFactor` values (0.92 / 0.55 / 0.0). Each frame, every layer's group anchor is translated to `camera.position * followFactor`, so far layers track the camera (apparently distant, low parallax) while near layers stay fixed in world space (full parallax sweep during orbit). `setupStarfield` removed from `sceneSetup.ts`; `Sim` now constructs the entity directly so its `update()` runs every frame (works while paused too — `dt` is unused). Star count unchanged (1200), `fog: false` on the materials so layered placement looks consistent.
