import { describe, expect, it } from 'vitest';
import {
  BiomeWorldField,
  type BiomeWeights,
  type BiomeWorldSample,
} from '../biomes/biome-world-field.js';
import {
  RegionalRouteField,
  type RegionalRouteBiomeSampler,
} from '../routes/regional-route-field.js';

const SEED = 8_801_799_478_018_485n;

describe('RegionalRouteField', () => {
  it('anchors the singular arrival to the route hierarchy', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16 });
    const routes = new RegionalRouteField(SEED, biomes, { blockSize: 16, pathStep: 4 });
    const origin = routes.sample(0, 0);

    expect(origin.isRoute).toBe(true);
    expect(origin.halfWidth).toBeCloseTo(1.45);
    expect(origin.routeKind).toBe('arterial');
    expect(origin.landmarkKind).toBe('arrival');
    expect(origin.landmarkDistance).toBe(0);
    expect(routes.getLandmarkSites(-1, -1, 1, 1)).toContainEqual({
      id: 'site:arrival',
      x: 0,
      y: 0,
      priority: 0,
      landmarkKind: 'arrival',
    });
  });

  it('forms one continuous arrival arterial instead of promoting every spoke', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16 });
    const routes = new RegionalRouteField(SEED, biomes, {
      blockSize: 16,
      pathStep: 4,
      maxCachedBlocks: 64,
      maxCachedPaths: 256,
    });
    const arrivalKinds = new Map<string, string>();
    for (let y = -24; y <= 24; y++) {
      for (let x = -24; x <= 24; x++) {
        const route = routes.sample(x, y);
        if (route.routeId?.includes('site:arrival') && route.routeKind) {
          arrivalKinds.set(route.routeId, route.routeKind);
        }
      }
    }
    expect([...arrivalKinds.values()].filter((kind) => kind === 'arterial')).toHaveLength(2);
    expect([...arrivalKinds.values()].filter((kind) => kind === 'local-road')).toHaveLength(1);
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

  it('keeps signed cross-sections endpoint-capped instead of extending route lines', () => {
    const biomes = new BiomeWorldField(SEED, { blockSize: 16 });
    const routes = new RegionalRouteField(SEED, biomes, { blockSize: 16, pathStep: 4 });

    // The arrival arterial leaves the origin toward the opposite quadrant.
    // An infinite-line normal would falsely claim this point behind its
    // endpoint; Euclidean segment distance correctly leaves it uninfluenced.
    const beyondArrivalEndpoint = routes.sample(-8, -8);
    expect(beyondArrivalEndpoint.distance).toBe(Number.POSITIVE_INFINITY);
    expect(beyondArrivalEndpoint.signedDistance).toBe(Number.POSITIVE_INFINITY);
    expect(beyondArrivalEndpoint.isRoute).toBe(false);

    for (const [x, y] of [[0, -8], [2, -6], [4, 4], [8, 8]]) {
      const sample = routes.sample(x!, y!);
      expect(Number.isFinite(sample.distance)).toBe(true);
      expect(Math.abs(sample.signedDistance)).toBeCloseTo(sample.distance, 5);
    }
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

  it('decorrelates accepted site coordinates across both spatial axes', () => {
    const physical = {
      elevation: 0.5,
      slope: 0.01,
      waterDistance: 10,
      isWater: false,
      isRiver: false,
    };
    const flatBiomes: RegionalRouteBiomeSampler = {
      samplePhysical: () => physical,
      sample: (): BiomeWorldSample => ({
        ...physical,
        weights: [0, 1, 0, 0, 0, 0] as unknown as BiomeWeights,
        primary: 'forest',
        ecologicalPrimary: 'forest',
      }),
    };
    const routes = new RegionalRouteField(42n, flatBiomes, {
      siteCellSize: 40,
      maxCachedSites: 10_000,
    });
    const sites = routes.getLandmarkSites(-800, -800, 800, 800)
      .filter((site) => site.id !== 'site:arrival');
    const rows = new Set(sites.map((site) => site.y));
    const columns = new Set(sites.map((site) => site.x));
    const phases = new Set(sites.map((site) => (
      `${((site.x % 40) + 40) % 40},${((site.y % 40) + 40) % 40}`
    )));
    expect(sites.length).toBeGreaterThan(180);
    expect(rows.size).toBeGreaterThan(sites.length * 0.55);
    expect(columns.size).toBeGreaterThan(sites.length * 0.55);
    expect(phases.size).toBeGreaterThan(sites.length * 0.4);
  });

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
