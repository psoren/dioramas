# CLAUDE.md

Instructions for Claude Code working in this repo.

## What this is

A 3D simulation of LEGO 40786 Micro Command Centre built with TypeScript + Three.js + Vite. The goal is to keep adding pieces (vehicles, buildings, behaviors) without it turning into a 2000-line file. The README has the broader overview; this file is what you need to work productively.

## Verify before declaring done

Always run both of these after any non-trivial change. They are the source of truth for "did I break it":

```sh
npm run typecheck    # tsc --noEmit, must pass with zero errors
npm run build        # full vite production build, must succeed
```

`npm run dev` starts the dev server at http://localhost:5173. You can't see the rendered canvas — only the human can verify visuals. If you change something visual, say so explicitly and ask the human to confirm before claiming it works.

There are no tests yet. If you add complex logic (path math, collision, state machines), add a Vitest test alongside it.

## Architecture in one paragraph

`Sim` (in `src/sim/Sim.ts`) owns the renderer, scene, camera, and an `entities: Entity[]` array. Every frame it calls `update(dt)` on each entity. `dt` is already scaled by `sim.speedMultiplier` and zeroed when paused — entities never need to check either. Everything in the world implements the `Entity` interface (`src/sim/Entity.ts`): a single `object3d` plus optional `update(dt)` and `dispose()`. To add a thing: write a class implementing `Entity` in `src/entities/`, then `sim.add(new Thing(...))` in `main.ts`.

## File layout — where things go

| Goes here | What |
|---|---|
| `src/sim/` | Engine stuff (Sim, Entity, camera, scene setup). Touch rarely. |
| `src/world/` | Shared constants, materials, geometry helpers, paths. |
| `src/entities/` | One file per thing in the world. **Most new code lives here.** |
| `src/ui/` | HUD overlay and CSS. |
| `src/main.ts` | Bootstrap: instantiate entities, mount UI, start sim. |

**Never** put entity-specific dimensions in `src/world/constants.ts` — that file is for things shared across multiple entities (the track, the plate). Entity-internal dimensions live as local constants in the entity file.

## Conventions — non-negotiable

1. **Reuse materials from `MAT`.** Don't allocate a new `MeshStandardMaterial` per mesh. If you need a variant (e.g. animated emissive), `MAT.greenLED.clone()` it once in the constructor and keep a reference. See `CommandCentre.ts` for the pattern.
2. **`TrackVehicle` subclasses face +X.** The base class rotates the group based on the curve tangent. Build your mesh with the nose pointing along +X — don't pre-rotate.
3. **Forward direction for free-roaming entities is your choice**, but document it in a comment at the top of the file.
4. **TS strict mode is on**, including `noUncheckedIndexedAccess`. Array access returns `T | undefined`. Use `!` only when the invariant is enforced by surrounding code (e.g. loops where the index is bounded). Prefer guards.
5. **Shadows.** Anything visible should have `castShadow = true` and (for ground-like things) `receiveShadow = true`. Forgetting this is the #1 reason new entities look "floaty."
6. **No `console.log` left in committed code.** If you need diagnostics, gate them behind `import.meta.env.DEV`.

## How to add things

See `README.md` — it has copy-pasteable scaffolds for the four common cases: second monorail, new track vehicle, free-roaming truck, static building, vertical-motion elevator. Don't reinvent these.

## Gotchas

- **`OrbitCamera` is custom**, not three's `OrbitControls`. If you need pan or damping, extend `src/sim/OrbitCamera.ts` rather than adding the `OrbitControls` addon — keeps the dependency surface small.
- **`THREE.Fog` clips far-away objects.** If you add something at the edges and it disappears, check `Sim.ts` fog `far` value (currently 75).
- **Speed multiplier of 0 ≠ pause.** When `sim.playing = false`, dt is forced to 0 regardless of speed. Don't write entity code that conflates the two.
- **Auto-rotation when paused.** Anything you want to animate while paused (e.g. UI hint indicators) can't use `update(dt)`. Use a separate `setInterval` from the UI layer instead. The `CommandCentre` deliberately stops its dish/beacon when paused — that's intended.

## Workflow

For each task in `TASKS.md`:

1. Read the task and its acceptance criteria.
2. Look at the closest existing entity for the pattern (e.g. building a new `TrackVehicle`? read `Monorail.ts`).
3. Implement.
4. `npm run typecheck && npm run build` — both must be green.
5. Update `TASKS.md` to mark the task done.
6. Report back what you changed and which acceptance criteria you confirmed.

If a task is ambiguous, ask before implementing. Don't guess on the visual look — pull up the README for the LEGO set reference and ask the human.

## What not to do

- Don't add React or React Three Fiber without asking. The plain Three.js + Entity pattern is intentional.
- Don't add a physics engine for cosmetic motion. Hand-roll the math first; reach for rapier only if collisions become unavoidable.
- Don't refactor `Sim`, `Entity`, or `OrbitCamera` to add features you might not need. The engine layer is intentionally thin.
- Don't delete `MAT` entries even if "unused" — they're part of the palette and other entities will need them.
