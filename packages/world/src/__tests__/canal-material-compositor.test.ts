import { describe, expect, it } from 'vitest';
import type { PixelGrid, RGB, Tile } from '@maldoror/protocol';
import { CanalMaterialCompositor } from '../tiles/canal-material-compositor.js';

function texture(id: string, base: RGB, accent: RGB): Tile {
  const size = 24;
  const pixels: PixelGrid = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ((x + y) % 7 === 0 ? accent : base)),
  );
  return { id, name: id, pixels, walkable: id !== 'water' };
}

function colorDelta(a: RGB, b: RGB): number {
  return Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
}

describe('CanalMaterialCompositor', () => {
  const water = texture('water', { r: 15, g: 105, b: 145 }, { r: 80, g: 175, b: 195 });
  const paving = texture('paving', { r: 205, g: 185, b: 145 }, { r: 235, g: 220, b: 180 });
  const garden = texture('garden', { r: 74, g: 118, b: 62 }, { r: 132, g: 158, b: 78 });
  const edge = texture('edge', { r: 135, g: 125, b: 105 }, { r: 175, g: 165, b: 140 });
  const classify = (x: number): boolean => x < 0;

  it('builds a deterministic continuous transition with exact material ownership', () => {
    const compositor = new CanalMaterialCompositor({
      worldSeed: 42n,
      water: [water],
      paving: [paving],
      edge: [edge],
      maxCachedTiles: 8,
    });
    const west = compositor.getTransitionTile(-1, 0, classify)!;
    const east = compositor.getTransitionTile(0, 0, classify)!;
    expect(compositor.getTransitionTile(-1, 0, classify)).toBe(west);
    expect(west.walkable).toBe(false);
    expect(east.walkable).toBe(true);
    expect(west.materialMask).toBeDefined();
    expect(east.materialMask).toBeDefined();

    const seamDeltas: number[] = [];
    for (let y = 0; y < west.pixels.length; y++) {
      seamDeltas.push(colorDelta(west.pixels[y]!.at(-1) as RGB, east.pixels[y]![0] as RGB));
    }
    const seamMean = seamDeltas.reduce((sum, value) => sum + value, 0) / seamDeltas.length;
    expect(seamMean).toBeLessThan(90);
    expect(west.materialMask!.some((row) => row.some((value) => value === 1))).toBe(true);
    expect(east.materialMask!.some((row) => row.some((value) => value === 0))).toBe(true);
  });

  it('does not allocate transitions for uniform interiors and keeps its cache bounded', () => {
    const compositor = new CanalMaterialCompositor({
      worldSeed: 7n,
      water: [water],
      paving: [paving],
      maxCachedTiles: 8,
    });
    expect(compositor.getTransitionTile(-10, 0, classify)).toBeNull();
    for (let y = -10; y <= 10; y++) {
      compositor.getTransitionTile(-1, y, classify);
      compositor.getTransitionTile(0, y, classify);
    }
    expect(compositor.getStats().cachedTiles).toBeLessThanOrEqual(8);
  });

  it('blends garden masses through the same bounded world-space cache', () => {
    const compositor = new CanalMaterialCompositor({
      worldSeed: 11n,
      water: [water],
      paving: [paving],
      garden: [garden],
      maxCachedTiles: 8,
    });
    const west = compositor.getGardenTransitionTile(-1, 0, classify)!;
    const east = compositor.getGardenTransitionTile(0, 0, classify)!;
    expect(west.id).toContain('garden-blend');
    expect(west.walkable).toBe(true);
    expect(east.walkable).toBe(true);
    const seamMean = west.pixels.reduce((total, row, y) =>
      total + colorDelta(row.at(-1) as RGB, east.pixels[y]![0] as RGB), 0) / west.pixels.length;
    expect(seamMean).toBeLessThan(90);
    expect(west.materialMask).toBeUndefined();
    expect(compositor.getStats().cachedTiles).toBe(2);
  });
});
