# Scene snapshot — before tile-system migration

This captures the full scene composition (branch `bigger-track-network`,
after the apartment/solar/cargo session) at the moment we started replacing
the hand-built `TrackPath` / `TrackRing` system with the procedural
`trackTile` system.

When adding pieces back via the new system, refer here to remember what
was in place. The actual code that produced each item is still in the
repo history.

## Architecture before migration

- **Static infrastructure**: `BasePlate`, `MoonSurface`, `Earth`,
  `MeteorShower`, `RoadRing`
- **Tracks (old methodology)**: 7 routes wired through `TrackPath.ts` and
  rendered by `TrackRing`. Routes: `ring` (outer rectangle), `nw`, `ne`,
  `sw`, `se` (four corner sub-loops), `h` (east-west expressway), `v`
  (north-south expressway)
- **Trains**: one `MonorailTrain` per route (7 total). `ring-train` had
  `telemetry: true` — drove the HUD tracked-vehicle panel
- **Stations**: 14 `stationPlatform` entries (one Futuron hero piece at
  `nw-north`, the rest basic platforms) wired to specific routes
- **Loaders**: 14 `stationLoader` entries pairing each station with its
  route's train
- **Cross-route intersections**: 2 `crossRouteIntersection` entries at
  `h-ring-west` and `h-ring-east` — collision/yield logic when the H
  expressway crosses the outer ring
- **Road vehicles**: 2 `spaceTruck` entries on `roadPath`. `truck-a` is
  the cargo runner (loads at north depot t=0.25, unloads at south depot
  t=0.75); `truck-b` is a slower cruiser
- **Depots**: 2 `containerDepot` entries at `(0, 0.05, ±13)` flanking the
  road
- **Pedestrians**: 6 `astronautPedestrian` entries wandering moon annulus
  r=14–22; all share `apartment-1` as home target
- **Stationary astronauts**: 2 `microAstronaut` (station-astronaut at
  `(-6, 0, 6)`, elevator-astronaut at `(-7, 0, -3.5)`)
- **Apartment**: `apartment-1` at `(-16, 0.02, 10)` heading `0.75π` —
  windows glow at night, pedestrians sleep inside
- **Solar farm**: `solar-farm-1` at `(16, 0.02, -10)` — 3×5 grid, panels
  slerp toward `worldState.sunDir`
- **Command centre** (original LEGO 40786 hero piece) + rear elevator
- **Retro space sets** (decoration): MicroRocketLaunchpad at
  `(8, 0.06, -8)`, MTronMagnetizer at `(-8, 3.5, -8)`, IcePlanetDefender
  at `(-8, 0.06, 8)`, SpacePoliceCruiser at `(10.5, 3, 0)`,
  GalaxyExplorerShip at `(8, 4, 8)`, GalaxyExplorerRover at `(-2.5, 0.08,
  8.5)`, RobotHelper at `(2.5, 0.08, 8.5)`, BlacktronCruiser at `(0, 4.5,
  -10.5)`, BlacktronOutpost at `(-2.5, 0.08, -8.5)`
- **Tile-track demo** (the new methodology, tiny): `tile-track-1` at
  `(18, 0.02, 14)` on the moon NE — a 3×2 rectangle loop

## Active behavior systems

- **DayNightCycle** — 180s full cycle; writes `worldState.dayNess` +
  `worldState.sunDir`
- **OrbitCamera** auto-drift after 3s idle + cinematic focus picks
  every 16s + click-to-follow
- **Starfield** (auto-added by `Sim`) — three parallax layers
- **HUD** — set name + tracked vehicle telemetry + event feed

## What's being removed for the migration

These entries get stripped from the manifest because they're built on the
old `TrackPath` / `TrackRing` system. Replacements (using the new tile
system) get added back one at a time, with the user verifying along the
way:

- All `trackRing` entries (7)
- All `monorailTrain` entries (7)
- All `stationPlatform` entries (14)
- The `futuronStation` entry (1)
- All `stationLoader` entries (14)
- All `crossRouteIntersection` entries (2)
- The temporary `tile-track-1` demo loop on the moon — replaced by a
  central tile track on the baseplate as the first new-system render

## What's being kept (everything else)

- Baseplate, moon surface, earth, meteor shower, road ring
- Command centre + rear elevator + 2 stationary microAstronauts
- 2 space trucks (use `roadPath`, independent of track system)
- 2 container depots
- 9 retro space set pieces
- 6 astronaut pedestrians + apartment + solar farm
- Day/night cycle, orbit camera behaviors, HUD

## Migration plan

1. **First**: render ONE central track using the new tile system in
   place of the seven old routes. No trains, no stations yet — just the
   track shape. Verify it looks right.
2. **Then add back, one at a time** (each verified before continuing):
   - A train on the new track (`MonorailTrain` connected to `TileTrack.path`)
   - Stations (express station position as `{ route, tile-cell }` and
     re-build `StationPlatform` to take a world position from the layout)
   - Cargo loading (`StationLoader` ported to consume the new path/station)
   - Multi-track network (multiple `TileTrack`s with shared intersections)
   - Cross-route collision avoidance (`TrackController` adapted to
     reference grid cells instead of named crossings)
3. **Later**: layer ramps, branches, and procedural generation on top.
