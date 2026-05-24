# CLAUDE.md — coral-reef-diorama

Instructions for Claude Code working in this repo. Sibling project to
`~/github/lego-retro-space-train/`; conventions mirror it.

## What this is

A real-time 3D coral reef diorama in TypeScript + Three.js + Vite. Hand-rolled
meshes, thin engine layer, entity-per-thing. The full creative brief is in
`PROMPT.md`.

## Verify before declaring done

```sh
npm run typecheck    # tsc --noEmit, must pass with zero errors
npm run build        # full vite production build
```

`npm run dev` starts the dev server at http://localhost:5175.

If you change something visual, ask the human to confirm — you can't see the
rendered canvas.

## Architecture in one paragraph

`Sim` (`src/sim/Sim.ts`) owns the renderer, scene, camera, and an
`entities: Entity[]` array. Every frame it calls `update(dt)` on each entity.
`dt` is already scaled by `sim.speedMultiplier` and zeroed when paused.
Everything in the world implements the `Entity` interface (`src/sim/Entity.ts`):
a single `object3d` plus optional `update(dt)` and `dispose()`. Write a new
entity in `src/entities/`, then `sim.add(new Thing(...))` in `main.ts`.

## File layout

| Goes here | What |
|---|---|
| `src/sim/` | Engine stuff (Sim, Entity, OrbitCamera, sceneSetup). Touch rarely. |
| `src/world/` | Shared materials, helpers (RNG, etc.). |
| `src/entities/` | One file per thing in the world. Most new code lives here. |
| `src/ui/` | HUD overlay and CSS. |
| `src/main.ts` | Bootstrap: instantiate entities, mount UI, start sim. |

## Conventions

1. **Reuse materials from `MAT`.** Don't allocate a new `MeshStandardMaterial`
   per mesh. Clone if you need an animated variant.
2. **TypeScript strict mode is on**, including `noUncheckedIndexedAccess`.
   Array access returns `T | undefined`. Use `!` only when the invariant is
   enforced by surrounding code; prefer guards.
3. **Shadows**: anything visible should `castShadow = true` and (for ground
   things) `receiveShadow = true`.
4. **No `console.log` in committed code.** Gate diagnostics behind
   `import.meta.env.DEV` if needed.
5. **Deterministic placement** for scatter (rocks, fish initial positions,
   etc.) via `src/world/seededRng.ts` so the scene doesn't jitter between
   reloads.

## What's built so far

- `Sim` + `OrbitCamera` + `setupLighting`
- `OceanFloor` — sandy disc, dune undulation, deterministic rocks + shells
- `Anemone` — base disc + sin-swayed tendrils (pink & green variants)

## Next entities (from PROMPT.md)

- `Caustics` — animated ripple on the floor
- `ReefStructure` — procedural pile of branching / brain / fan corals
- `FishSchool` — **boids in 3D** (the centerpiece)
- `PatrolShark` — slow loop on a Catmull-Rom curve
- `Diver` — periodic crossings with bubble trail
- `Sunbeams` — stretched semi-transparent cones from above
- `SurfaceCanopy` — wavy plane near the water surface
- Stationary creatures (MorayEel, Starfish, SeaTurtle)

## What not to do

- Don't add React or React Three Fiber.
- Don't add a physics engine for cosmetic motion.
- Don't refactor `Sim`, `Entity`, or `OrbitCamera` to add features you might
  not need. The engine layer is intentionally thin.
