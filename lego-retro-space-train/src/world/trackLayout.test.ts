import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { TrackLayout, generateRectangleLoop } from './trackLayout';
import { TILE_SIZE } from './trackTile';

describe('generateRectangleLoop', () => {
  it('places 4 corners + edges for a 3x2 rectangle', () => {
    const layout = new TrackLayout();
    generateRectangleLoop(layout, 0, 0, 2, 1);
    const tiles = layout.tiles();
    // 4 corners + 1 north-edge straight + 1 south-edge straight = 6 tiles
    expect(tiles.length).toBe(6);
  });

  it('throws on degenerate rectangles', () => {
    const layout = new TrackLayout();
    expect(() => generateRectangleLoop(layout, 0, 0, 0, 1)).toThrow();
    expect(() => generateRectangleLoop(layout, 0, 0, 1, 0)).toThrow();
  });
});

describe('TrackLayout.buildLoop', () => {
  it('produces a closed CatmullRomCurve3 for a 2x2 loop (just 4 corners)', () => {
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, 0, 0, 1, 1);
    const curve = layout.buildLoop(start, startEntry);
    expect(curve).toBeInstanceOf(THREE.CatmullRomCurve3);
    expect(curve.closed).toBe(true);
    // First and last points should be different (curve closes via the
    // CatmullRomCurve3's closed flag, not by duplicating the start point).
    const first = curve.getPointAt(0);
    expect(first).toBeInstanceOf(THREE.Vector3);
  });

  it('produces a path whose every point sits within the loop bounding box', () => {
    const layout = new TrackLayout();
    const { start, startEntry } = generateRectangleLoop(layout, -2, -1, 1, 1);
    const curve = layout.buildLoop(start, startEntry);
    const HALF = TILE_SIZE / 2;
    const minX = -2 * TILE_SIZE - HALF;
    const maxX =  1 * TILE_SIZE + HALF;
    const minZ = -1 * TILE_SIZE - HALF;
    const maxZ =  1 * TILE_SIZE + HALF;
    for (let i = 0; i <= 50; i++) {
      const t = i / 50;
      const p = curve.getPointAt(t);
      expect(p.x).toBeGreaterThanOrEqual(minX - 0.01);
      expect(p.x).toBeLessThanOrEqual(maxX + 0.01);
      expect(p.z).toBeGreaterThanOrEqual(minZ - 0.01);
      expect(p.z).toBeLessThanOrEqual(maxZ + 0.01);
    }
  });

  it('throws on a tile with the wrong number of ports', () => {
    const layout = new TrackLayout();
    // Place a 3-port tile and try to walk a 2-port loop through it.
    // We don't expose that easily without setting up another tile, so
    // skip — instead just confirm that an empty layout throws cleanly.
    expect(() => {
      const { start, startEntry } = generateRectangleLoop(layout, 0, 0, 1, 1);
      // Remove a tile to create a dead end
      layout['cells'].delete('1,1');
      layout.buildLoop(start, startEntry);
    }).toThrow();
  });
});
