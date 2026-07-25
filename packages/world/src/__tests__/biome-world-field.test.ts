import { describe, expect, it } from 'vitest';
import { BIOME_FAMILIES, BiomeWorldField } from '../biomes/biome-world-field.js';

const WORLD_SEED = 8801799478018485n;

describe('BiomeWorldField', () => {
  it('returns normalized continuous weights and protects the exact arrival', () => {
    const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 4 });
    const origin = field.sample(0, 0);
    expect(origin.primary).toBe('canal-town');
    expect(origin.weights[0]).toBeGreaterThan(0.99);
    expect(origin.isWater).toBe(false);

    const regional = field.sample(320, 100);
    expect(regional.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
    for (const weight of regional.weights) {
      expect(Number.isFinite(weight)).toBe(true);
      expect(weight).toBeGreaterThanOrEqual(0);
      expect(weight).toBeLessThanOrEqual(1);
    }
  });

  it('continues the western hydrology into a bounded arrival canal while keeping spawn dry', () => {
    const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 8 });
    expect(field.getConstructedWaterways()).toEqual([{
      id: 'arrival-canal',
      materialFamily: 'canal-town',
      bounds: { minX: -28, minY: -16, maxX: 42, maxY: 2 },
    }]);
    expect(field.sample(0, 0).isWater).toBe(false);
    expect(field.samplePhysical(0, 0).isWater).toBe(false);
    expect(field.sampleConstructedWaterway(0, 0)).toMatchObject({
      id: 'arrival-canal',
      bankSide: 1,
    });
    expect(field.sampleConstructedWaterway(0, 0)!.signedDistance).toBeGreaterThan(2.7);
    expect(field.sampleConstructedWaterway(0, -5)!.signedDistance).toBeLessThan(-2);
    expect(Math.hypot(
      field.sampleConstructedWaterway(0, -2)!.tangentX,
      field.sampleConstructedWaterway(0, -2)!.tangentY,
    )).toBeCloseTo(1, 8);
    expect(field.sampleConstructedWaterway(80, 80)).toBeNull();
    expect(field.sampleConstructedWaterway(0, -5, 'missing-waterway')).toBeNull();

    for (const [x, y] of [[-20, -6], [-10, -5], [0, -5], [10, -6], [36, -9]]) {
      const full = field.sample(x!, y!);
      const physical = field.samplePhysical(x!, y!);
      expect(full.isWater).toBe(true);
      expect(physical.isWater).toBe(true);
      expect(physical.waterDistance).toBe(0);
      if (x! >= -10) {
        expect(full.isRiver).toBe(true);
        expect(physical.isRiver).toBe(true);
      }
    }

    for (const [x, y] of [[-4, 0], [0, 1], [17, -2], [42, -9]]) {
      expect(field.sample(x!, y!).isWater).toBe(false);
    }
  });

  it('is exactly independent of internal cache-block boundaries', () => {
    const fine = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 8 });
    const coarse = new BiomeWorldField(WORLD_SEED, { blockSize: 32, maxCachedBlocks: 8 });
    for (const [x, y] of [[31, 5], [32, 5], [-1, 5], [40, 10], [320, 100]]) {
      const a = fine.sample(x!, y!);
      const b = coarse.sample(x!, y!);
      expect(a).toEqual(b);
    }
  });

  it('keeps the six required family fixtures materially distinct', () => {
    const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 12 });
    const fixtures = new Map([
      ['canal-town', [0, 0]],
      ['forest', [320, 100]],
      ['coast', [0, 80]],
      ['rural', [336, 128]],
      ['mountain', [60, 20]],
      ['ruins', [100, -120]],
    ] as const);
    expect([...fixtures.keys()]).toEqual([...BIOME_FAMILIES]);
    for (const [expectedFamily, [x, y]] of fixtures) {
      expect(field.sample(x, y).primary).toBe(expectedFamily);
    }
  });

  it('is deterministic by seed and differs for another seed', () => {
    const a = new BiomeWorldField(WORLD_SEED, { blockSize: 16 });
    const b = new BiomeWorldField(WORLD_SEED, { blockSize: 16 });
    const different = new BiomeWorldField(WORLD_SEED + 1n, { blockSize: 16 });
    const sampleA = a.sample(320, 100);
    expect(b.sample(320, 100)).toEqual(sampleA);
    expect(different.sample(320, 100).weights).not.toEqual(sampleA.weights);
  });

  it('bounds cache growth while retaining signed-coordinate sampling', () => {
    const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 4 });
    for (const coordinate of [-128, -64, 0, 64, 128, 192]) field.sample(coordinate, -coordinate);
    expect(field.getStats()).toEqual({ cachedBlocks: 4, maxCachedBlocks: 4, blockSize: 16 });
    expect(field.sample(-65, -97).weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1, 12);
  });

  it('exposes identical physical descriptors without composing family weights', () => {
    const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16 });
    for (const [x, y] of [[0, 0], [91, -126], [-18, 77], [320, 100]]) {
      const physical = field.samplePhysical(x!, y!);
      const full = field.sample(x!, y!);
      expect(physical.elevation).toBeCloseTo(full.elevation, 6);
      expect(physical.slope).toBeCloseTo(full.slope, 6);
      expect(physical.waterDistance).toBeCloseTo(full.waterDistance, 5);
      expect(physical.isWater).toBe(full.isWater);
      expect(physical.isRiver).toBe(full.isRiver);
    }
  });
});
