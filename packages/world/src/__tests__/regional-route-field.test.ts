import { describe, expect, it } from 'vitest';
import { BiomeWorldField } from '../biomes/biome-world-field.js';
import { RegionalRouteField } from '../routes/regional-route-field.js';

const SEED = 8_801_799_478_018_485n;

describe('RegionalRouteField', () => {
  it('anchors the singular arrival to the route hierarchy', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16 });
    const routes = new RegionalRouteField(SEED, biomes, { blockSize: 16, pathStep: 4 });
    const origin = routes.sample(0, 0);

    expect(origin.isRoute).toBe(true);
    expect(origin.routeKind).toBe('arterial');
    expect(origin.landmarkKind).toBe('arrival');
    expect(origin.landmarkDistance).toBe(0);
  });

  it('is exact across cache block sizes and traversal order', () => {
    const firstBiomes = new BiomeWorldField(SEED, { blockSize: 16 });
    const secondBiomes = new BiomeWorldField(SEED, { blockSize: 32 });
    const fine = new RegionalRouteField(SEED, firstBiomes, { blockSize: 16, pathStep: 4 });
    const coarse = new RegionalRouteField(SEED, secondBiomes, { blockSize: 32, pathStep: 4 });
    const coordinates = [
      [0, 0], [15, 15], [16, 16], [-1, -1], [-17, 31], [72, -48], [145, 93], [-133, -81],
    ];

    for (const [x, y] of [...coordinates].reverse()) coarse.sample(x!, y!);
    for (const [x, y] of coordinates) expect(coarse.sample(x!, y!)).toEqual(fine.sample(x!, y!));
  });

  it('produces sparse routes, multiple hierarchy levels and explicit crossings', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16, maxCachedBlocks: 96 });
    const routes = new RegionalRouteField(SEED, biomes, {
      blockSize: 16,
      pathStep: 4,
      maxCachedBlocks: 96,
      maxCachedPaths: 512,
    });
    const kinds = new Set<string>();
    let routeTiles = 0;
    let crossingTiles = 0;
    const total = 320 * 240;
    for (let y = -120; y < 120; y += 2) {
      for (let x = -160; x < 160; x += 2) {
        const sample = routes.sample(x, y);
        if (sample.routeKind) {
          kinds.add(sample.routeKind);
          routeTiles += 4;
        }
        if (sample.isCrossing) {
          expect(sample.crossingKind).not.toBeNull();
          crossingTiles += 4;
        }
        if (sample.crossingKind === 'ferry') {
          expect(sample.isWalkableRoute).toBe(false);
        }
      }
    }

    expect(kinds).toEqual(new Set(['arterial', 'local-road', 'trail']));
    expect(routeTiles / total).toBeGreaterThan(0.01);
    expect(routeTiles / total).toBeLessThan(0.18);
    expect(crossingTiles).toBeGreaterThan(0);
  }, 30_000);

  it('keeps both caches bounded', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16, maxCachedBlocks: 16 });
    const routes = new RegionalRouteField(SEED, biomes, {
      blockSize: 16,
      maxCachedBlocks: 4,
      maxCachedPaths: 16,
      maxCachedSites: 256,
      pathStep: 4,
    });
    for (const coordinate of [-256, -128, 0, 128, 256]) routes.sample(coordinate, -coordinate);

    expect(routes.getStats().cachedBlocks).toBeLessThanOrEqual(4);
    expect(routes.getStats().cachedPaths).toBeLessThanOrEqual(16);
    expect(routes.getStats().cachedSites).toBeLessThanOrEqual(256);
  }, 30_000);
});
