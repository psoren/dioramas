import { describe, it, expect } from 'vitest';
import {
  TrackLayout,
  generateRectangleLoop,
  placeWalkLoop,
  placeRampBridgeLoop,
  extrudeRandomSegment,
  generateExtrudedLoop,
  LOOP_TEMPLATES,
  WalkStep,
} from './trackLayout';
import { dirVector } from './trackTile';
import {
  TILE_SIZE,
  TEE_NES,
  STRAIGHT_NS,
  CURVE_NE,
  RAMP_NS,
} from './trackTile';

describe('buildLoop output curve', () => {
  it('every sampled point sits inside the rectangle bounding box', () => {
    // Catches regressions where a curve sample lands outside the layout
    // — e.g. a bad rotation matrix or an arc that bulges the wrong way
    // would push points beyond the expected tile bounds.
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, -2, -1, 1, 1);
    const { curve } = layout.buildLoop(start, startEntry);
    const HALF = TILE_SIZE / 2;
    const minX = -2 * TILE_SIZE - HALF;
    const maxX =  1 * TILE_SIZE + HALF;
    const minZ = -1 * TILE_SIZE - HALF;
    const maxZ =  1 * TILE_SIZE + HALF;
    for (let i = 0; i <= 200; i++) {
      const p = curve.getPointAt(i / 200);
      expect(p.x).toBeGreaterThanOrEqual(minX - 0.01);
      expect(p.x).toBeLessThanOrEqual(maxX + 0.01);
      expect(p.z).toBeGreaterThanOrEqual(minZ - 0.01);
      expect(p.z).toBeLessThanOrEqual(maxZ + 0.01);
    }
  });

  it('throws on dead-end layouts (entry into a tile without that port)', () => {
    // The dead-end check protects future generators from silently
    // producing broken layouts. Without it, buildLoop would loop until
    // the safety counter trips.
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, 0, 0, 1, 1);
    layout['cells'].delete('1,1');
    expect(() => layout.buildLoop(start, startEntry)).toThrow();
  });
});

describe('walk-loop templates', () => {
  it('every built-in template closes (net displacement = 0)', () => {
    // If a template's steps don't sum to zero displacement, placeWalkLoop
    // throws before placing tiles. This is the headline correctness
    // contract for the template library — silent breakage here would
    // crash the manifest builder for every scene using that template.
    for (const tpl of LOOP_TEMPLATES) {
      const layout = new TrackLayout();
      expect(() => placeWalkLoop(layout, tpl.steps), `template "${tpl.name}" should close`).not.toThrow();
    }
  });

  it('non-closing walk steps throw', () => {
    // Without this check a generator bug could place tiles forever or
    // leave a dead-end loop that crashes buildLoop downstream — the
    // close-check is the first line of defence.
    const layout = new TrackLayout();
    expect(() => placeWalkLoop(layout, [['E', 3], ['S', 2]])).toThrow();
  });

  it('placed L-shape produces a walkable loop with right tile count', () => {
    // Sanity: a 6-cell + 4-cell perimeter L should have exactly the right
    // number of tiles, and buildLoop should successfully walk it.
    const layout = new TrackLayout();
    const tpl = LOOP_TEMPLATES.find((t) => t.name === 'L-large')!;
    const expectedCells = tpl.steps.reduce((n, [, count]) => n + count, 0);
    const { start, startEntry } = placeWalkLoop(layout, tpl.steps);
    expect(layout.tiles().length).toBe(expectedCells);
    expect(() => layout.buildLoop(start, startEntry)).not.toThrow();
  });
});

describe('buildLoop Y verification', () => {
  it('throws if a tile seam has mismatched Y (ramp followed by flat straight)', () => {
    // Place a 2x2 of: RAMP_NS going up + STRAIGHT_NS at y=0. The ramp's
    // S port is at y=RAMP_HEIGHT but the straight's N port is at y=0 —
    // any train would pop down at the seam. The Y-mismatch check is the
    // only thing protecting ramp users from this silent visual glitch.
    const layout = new TrackLayout();
    layout.place(0, 0, RAMP_NS, 0);     // exit S at y=RAMP_HEIGHT
    layout.place(0, 1, STRAIGHT_NS, 0); // entry N at y=0
    layout.place(0, 2, CURVE_NE, 1);    // ports W, N — won't matter, never reached
    layout.place(-1, 2, STRAIGHT_NS, 1); // E, W — won't be reached either
    // We only need the first seam to fail; truncate the loop expectation.
    expect(() => layout.buildLoop(layout.get(0, 0)!, 'N')).toThrow(/Y mismatch/);
  });
});

describe('buildLoop routing through 3+-port tiles', () => {
  it('uses an entry→exit routing map on a TEE to walk a closed loop', () => {
    // Without routing, the walker can't pick an exit from a 3-port tile
    // and throws. With routing, a TEE can substitute for a corner in a
    // standard 2x2 loop (its third port hanging unused, e.g. as a future
    // spur). This verifies the routing pipeline end-to-end.
    const layout = new TrackLayout();
    // 2x2 loop: TEE at NW corner with effective ports {E, S, W} (rot 3).
    // Only S→E routing is needed; the loop closes when the walker returns
    // entering from S, so the same routing entry serves both visits.
    layout.place(0, 0, TEE_NES, 3, new Map([['S', 'E']]));
    layout.place(1, 0, CURVE_NE, 2); // ports W, S
    layout.place(1, 1, CURVE_NE, 1); // ports W, N
    layout.place(0, 1, CURVE_NE, 0); // ports N, E
    expect(() => layout.buildLoop(layout.get(0, 0)!, 'S')).not.toThrow();
  });
});

describe('extruded random shape generator', () => {
  function netDisplacement(steps: ReadonlyArray<WalkStep>): [number, number] {
    let dx = 0, dz = 0;
    for (const [dir, count] of steps) {
      const [vx, vz] = dirVector(dir);
      dx += vx * count;
      dz += vz * count;
    }
    return [dx, dz];
  }

  it('extrusion preserves closure across many random iterations', () => {
    // Closure is THE correctness invariant for the extrude algorithm.
    // If any extrusion changes net displacement, the resulting layout is
    // a broken open path that throws at placeWalkLoop. Run 200 random
    // extrusions to catch any drift.
    const base: WalkStep[] = [['E', 6], ['S', 4], ['W', 6], ['N', 4]];
    let steps: ReadonlyArray<WalkStep> = base;
    let rngState = 1;
    const rng = () => {
      rngState = (rngState * 16807) % 2147483647;
      return rngState / 2147483647;
    };
    for (let i = 0; i < 200; i++) {
      const next = extrudeRandomSegment(steps, rng);
      if (next) steps = next;
    }
    expect(netDisplacement(steps)).toEqual([0, 0]);
  });

  it('generateExtrudedLoop produces a layout buildLoop can walk', () => {
    // End-to-end: random shape generates, places, and the loop walker
    // closes. Catches off-by-one bugs in the extrude algorithm that
    // would technically preserve net displacement but produce a cell
    // path with overlapping or missing tiles.
    const layout = new TrackLayout();
    let rngState = 42;
    const rng = () => {
      rngState = (rngState * 16807) % 2147483647;
      return rngState / 2147483647;
    };
    const { start, startEntry } = generateExtrudedLoop(layout, rng, 5);
    expect(() => layout.buildLoop(start, startEntry)).not.toThrow();
  });

  it('never produces a self-intersecting layout (across 200 seeds)', () => {
    // Regression: previously the generator could roll a bump that grew
    // into an existing path, causing two cells to coincide and the
    // polygon walker to install incompatible tiles. The fix is reject-
    // and-retry on self-intersection; this stress-tests it.
    for (let seed = 1; seed <= 200; seed++) {
      const layout = new TrackLayout();
      let s = seed;
      const rng = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      const { start, startEntry } = generateExtrudedLoop(layout, rng, 6);
      expect(() => layout.buildLoop(start, startEntry), `seed ${seed}`).not.toThrow();
    }
  });

  it('bridge insertion never places a ramp on a corner (200 seeds)', () => {
    // Regression: findStraightRuns was including the turn cell at the
    // end of each run, so a ramp could land on a corner cell and the
    // walker would crash with a port-mismatch error. The Y-continuity
    // and port-check pieces of buildLoop together fail loudly if any
    // bridge tile is mis-rotated.
    for (let seed = 1; seed <= 200; seed++) {
      const layout = new TrackLayout();
      let s = seed;
      const rng = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      const { start, startEntry } = generateExtrudedLoop(layout, rng, 4, 2);
      expect(() => layout.buildLoop(start, startEntry), `seed ${seed}`).not.toThrow();
    }
  });
});

describe('ramp bridge loop', () => {
  it('places a closed loop that buildLoop walks (Y check verifies seams)', () => {
    // The ramp template is the first user of placePolygonLoop overrides.
    // buildLoop's Y-continuity check will throw if any ramp seam is
    // misaligned — passing means the override rotations + positions
    // line the elevations up correctly.
    const layout = new TrackLayout();
    const { start, startEntry } = placeRampBridgeLoop(layout, 6, 3);
    expect(() => layout.buildLoop(start, startEntry)).not.toThrow();
  });
});

describe('tileAtT lookup', () => {
  it('every placed tile has a non-empty span', () => {
    // If a tile is in the layout but missing from tileSpans, the train
    // would skip past it — stations on that cell would never fire. This
    // catches layout traversal bugs that miss cells, or sample-resolution
    // too coarse to find a cell.
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, 0, 0, 3, 2);
    const loop = layout.buildLoop(start, startEntry);
    expect(loop.tileSpans.length).toBe(layout.tiles().length);
    for (const span of loop.tileSpans) expect(span.tEnd).toBeGreaterThan(span.tStart);
  });

  it('tileAtT returns a span whose cell is plausibly under the curve point', () => {
    // Loose correctness: the picked cell must be within ~half a tile of
    // the curve point. Allows finite-bucket-resolution slack at cell
    // boundaries while still catching gross mismatches (a tile span
    // attached to the wrong cell would be tile-distance away, easily
    // failing this).
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, -2, -1, 2, 1);
    const loop = layout.buildLoop(start, startEntry);
    const SLACK = TILE_SIZE * 0.55;
    for (let i = 0; i < 360; i++) {
      const t = (i + 0.5) / 360;
      const span = loop.tileAtT(t)!;
      const p = loop.curve.getPointAt(t);
      const d = Math.hypot(p.x - span.gridX * TILE_SIZE, p.z - span.gridZ * TILE_SIZE);
      expect(d).toBeLessThanOrEqual(SLACK);
    }
  });
});
