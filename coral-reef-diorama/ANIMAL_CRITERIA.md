# "Does this animal look good?" — checklist

Run this against any new swimming/crawling creature before declaring it done.

## 1. Silhouette test
Look at the animal in **monochrome backlight**. Can you tell what species it is
just from its outline?
- ✅ Turtle: oval shell + 4 flippers + head sticking out — instantly readable.
- ❌ Generic sphere with two fins glued on — could be anything.

## 2. Proportions
Body parts in roughly real-world ratio. No bobblehead heads, no T-pose limbs.
- Turtle shell ≈ 2-3× length of head; flippers about half the shell length.
- Manta wingspan ≈ 1.5-2× body length, not equal.
- Jellyfish bell wider than it is tall, tendrils 2-3× bell length.

## 3. Palette
- Distinctive from the existing fish schools (no more yellow, blue, or silver
  bodies — those slots are taken).
- Two-tone where appropriate (darker top + lighter belly is the ocean
  countershading rule — manta, shark, turtle all follow this).
- Don't compete with the reef coral colours (avoid bright pink/orange unless
  it's the species' actual colour, like clownfish).

## 4. Organic motion (the big one)
The animal should never **rigidly translate**. At minimum, *something* on the
body should animate independently of forward motion:
- **Flippers / wings / fins flap** — sine-driven, slight phase per limb.
- **Body undulation** — fish wag tail, eels sinuate, octopus arms drag.
- **Bell pulse** — jellyfish contract/expand.
- **Tendril drag** — soft parts trail behind, lagged from main body.

If the animal is just a static mesh on a moving group, it fails this test.

## 5. Speed matches species
- Manta, turtle, whale shark: slow, almost meditative (0.3-0.8 u/s).
- Reef fish: medium (1.0-1.5 u/s).
- Barracuda, predators: bursts, then drift.
- Jellyfish: vertical-dominant; horizontal drift is minimal.

A fast turtle looks wrong. A slow minnow looks dead.

## 6. Pathing fits behavior
- Patrollers (shark, barracuda) — closed loop, long, lazy curves.
- Hoverers (seahorse, pufferfish) — small radius, near a single feature.
- Drifters (jellyfish, octopus) — slow random walk or very long-period curve.
- Crawlers (crab, starfish) — on the floor, stop-and-start motion.

## 7. Scale relative to existing scene
Reef centerpiece is ~3 units wide. Fish are 0.2-0.4 units.
- Manta: ~3-4 unit wingspan (bigger than the reef itself; reads as "majestic").
- Turtle: ~1.2-1.5 units (clearly bigger than a fish, smaller than the reef).
- Jellyfish: ~0.6 unit bell + 2 unit tendril drape (medium-small).
- Crab/shrimp: ≤ 0.3 units (smaller than a fish, sits on the floor).

## 8. Shadow + receive
`castShadow = true` on visible meshes. Translucent things (jellyfish bell)
typically *don't* cast a shadow — keep them shadowless to avoid weird artifacts.

## 9. Doesn't intersect static geometry
Path/centre should be chosen so the animal doesn't fly through the coral
mound. Path radius should clear the reef footprint (≥ 4 units from origin
unless the animal is small/decorative).
