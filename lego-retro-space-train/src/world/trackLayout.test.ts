import { describe, it, expect } from 'vitest';
import { TrackLayout, generateRectangleLoop } from './trackLayout';
import { TILE_SIZE } from './trackTile';

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
