# Design language — LEGO Retro Space Diorama

Conventions any entity (procedurally generated or hand-built) should
follow so the world reads as one coherent set rather than a pile of
unrelated meshes.

## Aesthetic

Classic LEGO Space (Futuron / Classic Space / Blacktron / M-Tron / Ice
Planet / Space Police), as if it were photographed on a baseplate. Bold
primary colours, clean rectangular forms, transparent yellow or blue
panels for "tech", visible studs where appropriate. Lunar terrain
beneath, Earth in the sky, the day/night cycle running.

**Read test**: any new piece should be recognisable as a LEGO model
from a 1990s pamphlet, not as generic CGI.

## Palette

All material allocations go through `MAT` in `src/world/materials.ts`.
Don't `new MeshStandardMaterial(...)` inline in entities — add the
colour to MAT first. The shared materials cut GPU state changes AND
keep the palette tight.

Current palette buckets:
- **Structural**: `white`, `gray`, `grayDark`, `black`, `blue`,
  `blueDark`, `yellow`
- **Transparent tech**: `blueTrans` (canopies, visors, doors),
  `yellowTrans` (energy panels, glow accents)
- **LEDs / lights**: `greenLED`, `redLED` (high emissive intensity for
  status lights / beacons)
- **Moon surface**: `moonSurface`, `moonCrater`, `moonRock`

Add new entries only when a colour can't be approximated by an
existing one.

## Scale

- `BASE_SIZE = 12.0` units = the 24-stud baseplate side
- `TILE_SIZE = 2.4` units per procgen track cell
- `GROUND_OBJECT_Y = 0.08` for set pieces sitting on the baseplate
- `LAUNCHPAD_GROUND_Y = 0.06` for things with their own thick base
- Astronauts are ~0.7 units tall (~one minifig)
- Trains sit `yOffset = 0.18` above the track deck

If you're picking a Y by feel, instead pick a constant. Constants live
in `src/world/constants.ts`.

## Geometry conventions

- **Vehicle forward** = local +X. `placeOnPath` orients +X along the
  path tangent.
- **Tile north** = local -Z. `Direction` enum is `N,E,S,W` in CW order
  but rotations are CCW (Three.js `rotation.y` convention).
- **Pivots** at meaningful points: astronaut shoulders/hips, vehicle
  centre of length, building base centre.

## Material rules

- **Only `MeshStandardMaterial`**. No Basic/Phong (they don't react to
  the day/night cycle correctly).
- **Emissive only when something is genuinely lit**: windows, beacons,
  LEDs, hot exhaust, engine glow, screens. Not on plain coloured
  surfaces — they should rely on direct + ambient light.
- **Transparent only for tech panels and glow halos** — never for
  general "I want this to look soft". Transparent objects do not cast
  decent shadows.
- **Cast shadows on solid meshes**, receive on ground. Use
  `applyShadows(group)` from `src/world/motion.ts` to apply in bulk.

## Detail density

- Every piece should have **at least 2-3 distinct sub-meshes**. A
  building isn't just a box — it's a box plus a roof slab plus a door
  plus an antenna. A vehicle isn't a chassis — it's chassis plus cab
  plus engine plus wheels.
- Avoid paper-thin geometry. Even decorative details should have
  thickness ≥ 0.02 so shadows behave.
- Stud bumps on roof surfaces are optional but help. Cross-ties or
  ribs on track decks help. Visible bevels at corners help.

## Animation idioms

- **Hover/bob**: `bobY(baseY, phase, freq, amp)` from `motion.ts`.
  Frequencies 0.5–1.5 rad/sec; amplitudes 0.05–0.2 units.
- **Slow rotations**: `dt * 0.08` to `dt * 0.3` rad/sec for things
  that "scan the horizon".
- **Walking gait**: sine on legs + opposite-phase sine on arms.
- **Avoid pure linear translations** without a sine modulation —
  things look mechanical/wrong.
- **Tie to global state when relevant**: read `worldState.dayNess` for
  window emissive intensity; read `worldState.sunDir` for solar
  panels. The night sky shouldn't have full daytime activity.

## Track tile language (procgen system)

Tracks built from `TileTrack` should read as LEGO monorail track:

- **Deck**: medium gray (`MAT.gray`), ~0.9 units wide, slight
  thickness.
- **Side rails**: dark gray (`MAT.grayDark`), thin, run along both
  edges of the deck.
- **Conductor strip**: yellow accent (`MAT.yellow`), narrow, runs down
  the centre — the LEGO monorail's third rail.
- **Cell pads**: subtle gray under each tile cell so the procgen grid
  is visible without dominating. Low opacity, low contrast.
- **Future**: cross-ties (periodic dark sleepers), banked corners,
  stud bumps along edges, ramp pieces with vertical accents.

## Sound for future me

When this doc and the code disagree, the code is the truth — update
the doc, don't pretend it agreed all along.
