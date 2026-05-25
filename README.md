# Dioramas

A collection of 3D dioramas (Vite + TypeScript + Three.js). Each
project is self-contained — own `package.json`, own dev server, own
docs — but they share an aesthetic and many entity-pattern conventions
so techniques port between them.

## Projects

### `lego-retro-space-train/`
LEGO Classic Space lunar settlement: monorail network, retro-space
sets (Futuron, M-Tron, Ice Planet, Space Police, Blacktron), procedural
track generation, day/night cycle, wandering astronauts. See
`lego-retro-space-train/DESIGN.md` for the visual conventions, and
`lego-retro-space-train/HANDOFF.md` for current state.

### `coral-reef-diorama/`
Underwater reef scene: fish-school boids, anemones, coral structures,
sea turtle + manta ray + jellyfish on path follows, day/night cycle,
auto-orbit cinematic camera. See `coral-reef-diorama/PROMPT.md` for
the original spec and `coral-reef-diorama/ANIMAL_CRITERIA.md` for the
"does this animal look good" rubric.

## Running

Each project has its own dev server:

```sh
cd lego-retro-space-train && npm install && npm run dev
cd coral-reef-diorama && npm install && npm run dev
```

Vite picks the next free port if 5173 is in use.

## History

This monorepo was created by `git subtree`-merging two previously
separate repositories — see commits "Import …-as-subtree" for the
boundary. Each project's prior commits are preserved in this repo's
history (visible via `git log -- <project-dir>`).
