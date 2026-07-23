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
      ['rural', [360, 30]],
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
});
