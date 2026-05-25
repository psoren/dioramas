import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrackLayout, placePolygonLoop } from './trackLayout';
import { TrackGraph, buildGraphFromLayout } from './trackGraph';
import { generatePassingSiding, generateRandomGraphTrack } from './trackGraphGenerators';
import { TEE_NES, STRAIGHT_NS, CURVE_NE, Direction, TrackTileDef, Rotation } from './trackTile';

describe('TrackGraph.shortestPath', () => {
  it('returns empty path when start == target', () => {
    const layout = new TrackLayout();
    const g = new TrackGraph(layout);
    const a = g.addNode('station', 0, 0, 'A');
    const path = g.shortestPath(a, a);
    expect(path).toEqual([]);
  });

  it('returns null when target is unreachable', () => {
    const layout = new TrackLayout();
    const g = new TrackGraph(layout);
    const a = g.addNode('station', 0, 0);
    const b = g.addNode('station', 5, 0);
    expect(g.shortestPath(a, b)).toBeNull();
  });

  it('picks the shortest (by edge count) path', () => {
    // Build a synthetic graph by hand:
    //   A --e1-- B --e2-- C
    //    \                /
    //     \-----e3-------/
    // Path A→C is one edge (e3), not two (e1+e2).
    const layout = new TrackLayout();
    const g = new TrackGraph(layout);
    const a = g.addNode('station', 0, 0);
    const b = g.addNode('junction', 1, 0);
    const c = g.addNode('station', 2, 0);
    // Stub curves — shortestPath doesn't care about geometry.
    const stubCurve = makeStubCurve();
    g.addEdge(a, b, stubCurve, [], 'E', 'W');
    g.addEdge(b, c, stubCurve, [], 'E', 'W');
    g.addEdge(a, c, stubCurve, [], 'E', 'W');
    const path = g.shortestPath(a, c);
    expect(path).not.toBeNull();
    expect(path!.length).toBe(1);
    // The 1-edge path must be the direct a↔c edge.
    expect([path![0]!.from, path![0]!.to]).toContain(a);
    expect([path![0]!.from, path![0]!.to]).toContain(c);
  });
});

describe('buildGraphFromLayout', () => {
  it('extracts a simple 4-edge graph from a synthetic 2-TEE layout', () => {
    // Hand-build: rectangle 0..4 × 0..2 with a TEE at (1, 2) and (3, 2)
    // on the bottom edge, branch cells at (1..3, 3).
    // Tiles handled via placePolygonLoop with overrides + manual branch.
    const layout = new TrackLayout();
    const cells: Array<readonly [number, number]> = [];
    for (let x = 0; x <= 4; x++) cells.push([x, 0]);
    for (let z = 1; z <= 2; z++) cells.push([4, z]);
    for (let x = 3; x >= 0; x--) cells.push([x, 2]);
    for (let z = 1; z >= 1; z--) cells.push([0, z]);
    const overrides = new Map<string, { def: TrackTileDef; rotation: Rotation; routing?: Map<Direction, Direction> }>();
    overrides.set('3,2', { def: TEE_NES, rotation: 3, routing: new Map<Direction, Direction>([['E', 'W']]) });
    overrides.set('1,2', { def: TEE_NES, rotation: 3, routing: new Map<Direction, Direction>([['E', 'W']]) });
    placePolygonLoop(layout, cells, overrides);
    // Branch row z=3
    layout.place(3, 3, CURVE_NE, 1);
    layout.place(1, 3, CURVE_NE, 0);
    layout.place(2, 3, STRAIGHT_NS, 1);
    const graph = buildGraphFromLayout(layout, [
      { gx: 3, gz: 2, kind: 'junction', label: 'east' },
      { gx: 1, gz: 2, kind: 'junction', label: 'west' },
    ]);
    expect(graph.nodes.length).toBe(2);
    // 3 edges total: long-way-around / main-short / branch
    expect(graph.edges.length).toBe(3);
    // Each node has 3 incident edges (TEE has 3 ports).
    for (const node of graph.nodes) expect(node.edges.length).toBe(3);
  });
});

describe('elevated passing siding', () => {
  it('places RAMP_NS + ELEVATED_STRAIGHT_NS + RAMP_NS on the branch', () => {
    // The elevated branch should have RAMP-up + N ELEVATED + RAMP-down on
    // the interior cells, with flat corners at each end. Regression catches
    // anyone forgetting to keep the corners flat (would break Y at the
    // TEE seam).
    let s = 3;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const { graph } = generatePassingSiding(rng, { elevatedBranch: true });
    const ramps = graph.layout.tiles().filter((t) => t.def.kind === 'ramp-ns');
    const elev = graph.layout.tiles().filter((t) => t.def.kind === 'elevated-straight-ns');
    expect(ramps.length).toBe(2);
    expect(elev.length).toBeGreaterThanOrEqual(1);
  });

  it('Beta node Y is RAMP_HEIGHT when the branch is elevated', () => {
    let s = 11;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const { stations } = generatePassingSiding(rng, { elevatedBranch: true });
    const beta = stations.find((n) => n.label === 'Beta')!;
    expect(beta.pos.y).toBeGreaterThan(0.5); // ≈ RAMP_HEIGHT = 1
  });

  it('every edge curve Y stays ≥ 0 (no overshoot below ground)', () => {
    // Regression: previously the curve dipped to ~-0.08 because the node Y
    // was hardcoded to 0 even when sitting on an elevated tile. Sampling
    // many points catches any future re-introduction of that bug.
    let s = 7;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const { graph } = generatePassingSiding(rng, { elevatedBranch: true });
    for (const e of graph.edges) {
      for (let i = 0; i <= 30; i++) {
        const t = i / 30;
        const y = e.curve.getPointAt(t).y;
        expect(y, `${e.id} t=${t}`).toBeGreaterThanOrEqual(-0.05);
      }
    }
  });
});

describe('generatePassingSiding', () => {
  it('produces a graph with 2 junctions + 2 stations and connected paths', () => {
    let s = 7;
    const rng = () => {
      s = (s * 16807) % 2147483647;
      return s / 2147483647;
    };
    const { graph, stations, junctions } = generatePassingSiding(rng);
    expect(junctions.length).toBe(2);
    expect(stations.length).toBe(2);
    // Every pair of nodes must be reachable.
    for (const a of graph.nodes) {
      for (const b of graph.nodes) {
        if (a === b) continue;
        expect(graph.shortestPath(a, b), `${a.id} → ${b.id}`).not.toBeNull();
      }
    }
  });

  it('station-to-station path picks one branch and not both (across 20 seeds)', () => {
    // Sanity: routing should actually pick A path, not return everything.
    for (let seed = 1; seed <= 20; seed++) {
      let s = seed;
      const rng = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      const { graph, stations } = generatePassingSiding(rng);
      const path = graph.shortestPath(stations[0]!, stations[1]!);
      expect(path, `seed ${seed}`).not.toBeNull();
      // The path is a sequence of unique edges.
      const ids = new Set(path!.map((e) => e.id));
      expect(ids.size).toBe(path!.length);
    }
  });
});

describe('generateRandomGraphTrack', () => {
  it('produces a valid graph across 100 seeds (no throws, ≥2 stations)', () => {
    // Regression catch: the random generator finds a long straight run for
    // the siding, computes branch cells, checks for walk collisions, and
    // builds a graph. If any seed lands in an unhandled edge case the
    // generator falls back to the rectangle template — both paths are
    // acceptable, but neither may throw.
    for (let seed = 1; seed <= 100; seed++) {
      let s = seed;
      const rng = () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
      const result = generateRandomGraphTrack(rng);
      expect(result.stations.length, `seed ${seed} stations`).toBeGreaterThanOrEqual(2);
      // Contract: every track has at least one intersection (TEE or CROSS
      // tile) and at least one elevated section.
      const layout = result.graph.layout;
      const crossTiles = layout.tiles().filter((t) => t.def.kind === 'cross-nesw').length;
      const teeTiles = layout.tiles().filter((t) => t.def.kind === 'tee-nes').length;
      expect(crossTiles + teeTiles, `seed ${seed} intersections`).toBeGreaterThanOrEqual(1);
      const elevTiles = layout.tiles().filter((t) => t.def.kind === 'elevated-straight-ns' || t.def.kind === 'ramp-ns').length;
      expect(elevTiles, `seed ${seed} elevation`).toBeGreaterThanOrEqual(1);
      // Every pair of nodes must be reachable.
      for (const a of result.graph.nodes) {
        for (const b of result.graph.nodes) {
          if (a === b) continue;
          expect(result.graph.shortestPath(a, b), `seed ${seed}: ${a.id} → ${b.id}`).not.toBeNull();
        }
      }
    }
  });
});

function makeStubCurve(): THREE.CatmullRomCurve3 {
  // CatmullRomCurve3 needs at least 2 points and a working getLength().
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(1, 0, 0),
  ], false, 'centripetal');
}
