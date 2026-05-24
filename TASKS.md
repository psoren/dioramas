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

### 6. Stars react to camera

The starfield is fixed in world space. Make it feel deeper: when the camera orbits, the starfield should counter-rotate slightly (parallax effect, like the stars are much further away than they really are).

**Acceptance:**
- Visible parallax when orbiting — distant stars appear to move less than nearby ones.
- No performance regression (still 60fps on a 2019-era laptop).
- Implemented in `sceneSetup.ts` or a new `Starfield` entity. If you make it an entity, it'll need to subscribe to camera changes — that's fine.

---

## Done

(none yet)
