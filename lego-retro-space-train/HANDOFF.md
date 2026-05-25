# Handoff — Procgen track-tile system stripped to moon + 🎲 button

**Generated:** 2026-05-25T06:56Z · **CWD:** `~/github/dioramas/lego-retro-space-train` · **Branch:** `main`

## What this session was for

Built out the procedural tile-track system from primitive tiles → loop walker → templates → random shapes (extruded), ramp bridges, self-crossings via `CROSS_NESW`, and a runtime "🎲 Random track" HUD button. Then stripped the scene back to just the moon surface + a 28-unit baseplate so the random tracks are the focus. Last item before wrap: hand-designing multi-crossing closed walks (pretzel/trefoil) was non-trivial — deferred to a vault todo.

## State right now

- Last action taken: pushed to `psoren/dioramas` main and added the multi-crossing todo to `~/obsidian/parker/inbox/TODO.md`.
- Recently accomplished (most recent first):
  - Killed twin-track overlap mode (stacked decks = visual mess, not real crossings); added 200-seed cell-uniqueness regression tests.
  - Parametric asymmetric figure-8 generator (`generateRandomFigure8`) with random 2–4 cell lobes per side.
  - Self-crossing layouts via `CROSS_NESW` auto-placement in `placePolygonLoop` when a cell is visited twice with perpendicular routings.
  - Ramp bridge insertion in extruded generator + corner-cell ramp-placement bug fix.
  - Runtime 🎲 button (no page reload) — adds/replaces a single random TileTrack.
  - Scene stripped to moon + bigger baseplate (`BASE_SIZE 12 → 28`), event-feed panel removed.
  - Moon rocks/craters scatter radius keyed to `sqrt(2) * BASE_SIZE + 2` so they don't poke through the plate.
- Uncommitted changes: none. Working tree clean. Local + remote in sync at `3a63c14`.
- Background tasks still running: none recently; user may have a dev server up on port 5176 — check with `lsof -i :5176` before starting another.

## Open TODOs

1. **Multi-crossing track layouts** — full context in `~/obsidian/parker/inbox/TODO.md` (last entry). Three approaches sketched: (a) algorithmic "twist" operator that adds one CROSS per call on extruded loops; (b) hand-designed pretzel/trefoil templates in `LOOP_TEMPLATES`; (c) relax `isSelfAvoiding` in `extrudeRandomSegment` to allow perpendicular crossings only. Acceptance: occasional 2+ crossings per random track, all `CROSS_NESW` with valid routing, existing 26 tests stay green.

## Files of interest

- `src/world/trackLayout.ts` — generators (`generateExtrudedLoop`, `generateRandomFigure8`, `placeRampBridgeLoop`), the polygon walker (`placePolygonLoop` — handles multi-visit cells), `LOOP_TEMPLATES`, the t→tile lookup.
- `src/world/trackTile.ts` — tile primitives (`STRAIGHT_NS`, `CURVE_NE`, `TEE_NES`, `CROSS_NESW`, `RAMP_NS`, `ELEVATED_STRAIGHT_NS`) and direction/rotation utilities.
- `src/entities/TileTrack.ts` — renders a layout as deck + rails + conductor + cross-ties.
- `src/main.ts` — random button wiring (`randomizeTrack`); two modes currently (figure-8 50% / extruded+bridge 50%).
- `src/world/trackLayout.test.ts` — 26 tests, includes 200-seed regressions for self-intersection rejection and bridge-on-corner protection.
- `DESIGN.md` — visual conventions (palette, scale, material rules, track-tile language).
- `TASKS.md` — older project todo list (not where new todos go; see global CLAUDE.md).
- `NOTES_BEFORE_MIGRATION.md` — snapshot of what was in the scene before the migration to tile system, in case anything needs to come back.
- `HANDOFF-2026-05-24.md` — previous handoff, archived. Earlier state had the full LEGO scene with trains, stations, retro sets, etc.

## Gotchas

- "Add a todo" means `~/obsidian/parker/inbox/TODO.md`, never repo-local `TASKS.md`. Captured in global CLAUDE.md + memory.
- Tests should test meaningful invariants (rotation math, closure, cell-uniqueness across many seeds) — not trivial assertions. Also in memory.
- `MonorailTrain.update` overrides `PathVehicle.update` without calling super; it must explicitly call `advanceSpeed(dt)` so the eased-speed mechanism runs. Previous bug where trains sat still.
- `placePolygonLoop` collects visits per cell, so a cell visited 2x → `CROSS_NESW` auto-placed; 3+ visits throws. Generators currently never produce 3+, but anything new must respect that.
- The `routing?: Map<Direction, Direction>` on `PlacedTile` uses *effective* port directions (post-rotation), not base ports.
- Centripetal CatmullRom parameterisation is required on the loop curve (`buildLoop`) — `catmullrom` mode produces overshoot that breaks the t→tile bbox lookup.
- Dev server: `npm run dev -- --host 127.0.0.1 --port 5176` from this directory. Vite picks next free port if taken.

## Suggested first action

1. Read this handoff (you are).
2. Read the last entry in `~/obsidian/parker/inbox/TODO.md` for the multi-crossing context.
3. `npm install && npm test` to confirm 26/26 tests pass on the current head.
4. Then pick one of the three multi-crossing approaches from the todo and prototype it. Approach (b) — hand-designed pretzel template — is the lowest-risk starting point because the infrastructure already handles multi-visit cells; you just need a walk that produces the right cell list.

## Picking up if you're NOT Claude Code

- The codebase is plain TypeScript + Vite + Three.js. No Claude-specific deps.
- Tests are vitest: `npm test` runs the suite, `npm run test:watch` for dev.
- `~/.claude/CLAUDE.md` and `~/.claude/projects/-Users-parker-github-lego-retro-space-visualizer/memory/MEMORY.md` capture cross-session conventions worth reading if you're an LLM.
- Monorepo root is `~/github/dioramas/`; sister project `coral-reef-diorama/` exists but is unrelated to this work.
