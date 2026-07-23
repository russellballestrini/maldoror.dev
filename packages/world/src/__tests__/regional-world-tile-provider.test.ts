import type { BuildingSprite, RGB, Tile } from '@maldoror/protocol';
import { describe, expect, it } from 'vitest';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldSample,
} from '../biomes/biome-world-field.js';
import type {
  RegionalLandmarkKind,
  RegionalLandmarkSite,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from '../tiles/regional-material-compositor.js';
import {
  RegionalWorldTileProvider,
  type RegionalAmbientAsset,
  type RegionalLandmarkAsset,
  type RegionalRouteContactAsset,
} from '../tiles/regional-world-tile-provider.js';

const COLOURS: Record<BiomeFamily, RGB> = {
  'canal-town': { r: 210, g: 120, b: 60 },
  forest: { r: 30, g: 110, b: 45 },
  coast: { r: 30, g: 125, b: 190 },
  rural: { r: 175, g: 155, b: 60 },
  mountain: { r: 125, g: 130, b: 145 },
  ruins: { r: 125, g: 65, b: 145 },
};

const SITES: ReadonlyArray<readonly [number, BiomeFamily, RegionalLandmarkKind]> = [
  [0, 'canal-town', 'arrival'],
  [40, 'forest', 'waystation'],
  [80, 'coast', 'waystation'],
  [120, 'rural', 'settlement'],
  [160, 'mountain', 'waystation'],
  [200, 'ruins', 'ruin'],
];

function solidTile(family: BiomeFamily, size = 16): Tile {
  const pixels = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => ({ ...COLOURS[family] })));
  return { id: family, name: family, pixels, walkable: true, resolutions: { [String(size)]: pixels } };
}

function sprite(colour: RGB): BuildingSprite {
  const pixels = Array.from({ length: 4 }, () =>
    Array.from({ length: 4 }, () => ({ ...colour })));
  const tile = { pixels, resolutions: { '4': pixels } };
  return {
    width: 3,
    height: 2,
    tiles: [
      [tile, tile, tile],
      [tile, tile, tile],
    ],
  };
}

function biomeSample(family: BiomeFamily): BiomeWorldSample {
  const index = BIOME_FAMILIES.indexOf(family);
  const weights = BIOME_FAMILIES.map((_, candidate) => Number(candidate === index)) as unknown as BiomeWeights;
  return {
    weights,
    primary: family,
    ecologicalPrimary: family === 'canal-town' || family === 'ruins' ? 'rural' : family,
    elevation: 0.5,
    slope: 0.01,
    waterDistance: 10,
    isWater: false,
    isRiver: false,
  };
}

function nearestFamily(x: number): BiomeFamily {
  return [...SITES].sort((a, b) => Math.abs(x - a[0]) - Math.abs(x - b[0]))[0]![1];
}

function routeSample(x: number, y: number): RegionalRouteSample {
  const site = SITES.find(([siteX]) => siteX === x && y === 0);
  return {
    distance: Math.abs(y),
    isRoute: y === 0,
    isCrossing: false,
    isWalkableRoute: y === 0,
    crossingKind: null,
    routeKind: y === 0 ? 'local-road' : null,
    routeId: y === 0 ? 'test-route' : null,
    directionX: y === 0 ? 1 : 0,
    directionY: 0,
    landmarkKind: site?.[2] ?? null,
    landmarkDistance: site ? 0 : Number.POSITIVE_INFINITY,
  };
}

function makeWorld(
  blockSize = 32,
  maxCachedBlocks = 32,
  sampleRoute: (x: number, y: number) => RegionalRouteSample = routeSample,
): RegionalWorldTileProvider {
  const field = {
    sample: (x: number) => biomeSample(nearestFamily(x)),
    prewarm: () => undefined,
  };
  const routes = {
    sample: sampleRoute,
    prewarm: () => undefined,
    getLandmarkSites: (minX: number, minY: number, maxX: number, maxY: number): RegionalLandmarkSite[] =>
      SITES.filter(([x]) => x >= minX && x <= maxX && 0 >= minY && 0 <= maxY)
        .map(([x, _family, landmarkKind]) => ({
          id: `site:${x}`,
          x,
          y: 0,
          priority: 0.5,
          landmarkKind,
        })),
  };
  const compositor = new RegionalMaterialCompositor({
    worldSeed: 42n,
    field,
    routes,
    materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [family, [solidTile(family)]])) as Record<BiomeFamily, Tile[]>,
    routeMaterials: {
      trail: [solidTile('rural')],
      'local-road': [solidTile('rural')],
      arterial: [solidTile('rural')],
    },
  });
  const landmarkKinds: Record<BiomeFamily, RegionalLandmarkKind[]> = {
    'canal-town': ['arrival', 'settlement'],
    forest: ['waystation'],
    coast: ['waystation'],
    rural: ['settlement', 'waystation'],
    mountain: ['waystation'],
    ruins: ['ruin'],
  };
  const landmarks: RegionalLandmarkAsset[] = BIOME_FAMILIES.map((family) => ({
    id: `landmark:${family}`,
    families: [family],
    landmarkKinds: landmarkKinds[family],
    sprite: sprite(COLOURS[family]),
    collision: [[-1, 0], [1, 0]],
  }));
  const ambient: RegionalAmbientAsset[] = BIOME_FAMILIES.flatMap((family) => [0, 1].map((variant) => ({
    id: `ambient:${family}:${variant}`,
    families: [family],
    routeDistance: [2, 999] as const,
    sprite: sprite(COLOURS[family]),
    collision: [[0, 0]] as const,
  })));
  const routeContacts: RegionalRouteContactAsset[] = BIOME_FAMILIES.flatMap((family) => (
    ['north-south', 'east-west'] as const
  ).map((accessAxis) => ({
    id: `route-contact:${family}:${accessAxis}`,
    families: [family],
    accessAxis,
    routeDistance: [2, 6] as const,
    sprite: sprite(COLOURS[family]),
    spriteAnchor: [1, 1] as const,
    collision: accessAxis === 'north-south'
      ? [[-1, 0], [1, 0]] as const
      : [[0, -1], [0, 1]] as const,
  })));
  return new RegionalWorldTileProvider({
    worldSeed: 42n,
    field,
    routes,
    compositor,
    landmarks,
    ambient,
    routeContacts,
    blockSize,
    maxCachedBlocks,
    ambientCellSize: 4,
    ambientDensity: 1,
    ambientLandmarkClearance: 4,
    routeContactCellSize: 10,
    routeContactDensity: 1,
    routeContactLandmarkClearance: 4,
  });
}

function overlayColoursNear(world: RegionalWorldTileProvider, centreX: number): Set<string> {
  const colours = new Set<string>();
  for (let y = -8; y <= 8; y++) {
    for (let x = centreX - 6; x <= centreX + 6; x++) {
      const pixel = world.getBuildingTileAt(x, y)?.pixels[0]?.[0];
      if (pixel) colours.add(`${pixel.r},${pixel.g},${pixel.b}`);
    }
  }
  return colours;
}

describe('RegionalWorldTileProvider', () => {
  it('places manifest-compatible family landmarks while preserving route thresholds', () => {
    const world = makeWorld();
    for (const [siteX, family] of SITES) {
      const colour = COLOURS[family];
      expect(world.resolveLandmarkPlacement(siteX, 0)).toMatchObject({
        assetId: `landmark:${family}`,
        families: [family],
        siteX,
        siteY: 0,
      });
      expect(overlayColoursNear(world, siteX)).toContain(`${colour.r},${colour.g},${colour.b}`);
      expect(world.isBuildingAt(siteX, 0), `route threshold at ${siteX},0`).toBe(false);
      expect(world.getTile(siteX, 0).walkable).toBe(true);
    }
    expect(world.getTileAtResolution(0, 0, 4).pixels).toHaveLength(4);
    expect(world.getRegionalStats().ambientAssets).toBe(BIOME_FAMILIES.length * 2);
    expect(world.getRegionalStats().routeContactAssets).toBe(BIOME_FAMILIES.length * 2);
  });

  it('selects authored contact axes from route tangents and keeps the connector open', () => {
    const horizontal = makeWorld();
    const horizontalContacts = horizontal.getRouteContactPlacementsInBounds(-24, -16, 224, 16);
    expect(horizontalContacts.length).toBeGreaterThan(4);
    expect(new Set(horizontalContacts.map((placement) => placement.accessAxis)))
      .toEqual(new Set(['north-south']));
    expect(new Set(horizontalContacts.flatMap((placement) => placement.families)))
      .toEqual(new Set(BIOME_FAMILIES));
    for (const placement of horizontalContacts) {
      expect(placement.assetId).toContain(':north-south');
      expect(placement.parcelId).toMatch(/^parcel:-?\d+:-?\d+$/);
      expect(placement.anchorX).toBe(placement.siteX);
      expect(Math.abs(placement.anchorY - placement.siteY)).toBe(3);
      expect(horizontal.isBuildingAt(placement.anchorX, placement.anchorY)).toBe(false);
      expect(horizontal.getTile(placement.siteX, placement.siteY).walkable).toBe(true);
    }

    const vertical = makeWorld(32, 32, (x, y) => ({
      ...routeSample(x, y),
      distance: Math.abs(x),
      isRoute: x === 0,
      isWalkableRoute: x === 0,
      routeKind: x === 0 ? 'local-road' : null,
      routeId: x === 0 ? 'vertical-route' : null,
      directionX: 0,
      directionY: x === 0 ? 1 : 0,
      landmarkKind: null,
      landmarkDistance: Number.POSITIVE_INFINITY,
    }));
    const verticalContacts = vertical.getRouteContactPlacementsInBounds(-8, -160, 8, 160);
    expect(verticalContacts.length).toBeGreaterThan(1);
    expect(new Set(verticalContacts.map((placement) => placement.accessAxis)))
      .toEqual(new Set(['east-west']));
    expect(verticalContacts.every((placement) => placement.assetId.includes(':east-west'))).toBe(true);
    for (const placement of verticalContacts) {
      expect(placement.anchorY).toBe(placement.siteY);
      expect(Math.abs(placement.anchorX - placement.siteX)).toBe(3);
      expect(vertical.isBuildingAt(placement.anchorX, placement.anchorY)).toBe(false);
    }
  });

  it('places coordinate-stable ambient masses across all family regions', () => {
    const world = makeWorld();
    const placements = world.getAmbientPlacementsInBounds(-24, -40, 224, 40);
    expect(placements.length).toBeGreaterThan(4);
    expect(new Set(placements.flatMap((placement) => placement.families))).toEqual(new Set(BIOME_FAMILIES));
    for (const family of BIOME_FAMILIES) {
      expect(new Set(placements
        .filter((placement) => placement.families.includes(family))
        .map((placement) => placement.assetId)).size).toBe(2);
    }
    for (const placement of placements) {
      expect(Math.abs(placement.anchorY)).toBeGreaterThanOrEqual(2);
      expect(world.isBuildingAt(placement.anchorX, placement.anchorY)).toBe(true);
    }
  });

  it('keeps overlays and collision exact across cache block sizes and traversal order', () => {
    const small = makeWorld(16);
    const large = makeWorld(48);
    const coordinates = SITES.flatMap(([siteX]) =>
      Array.from({ length: 17 }, (_, offset) => [siteX + offset - 8, (offset % 9) - 4] as const));
    for (const [x, y] of [...coordinates].reverse()) {
      large.getBuildingTileAt(x, y);
      large.isBuildingAt(x, y);
    }
    for (const [x, y] of coordinates) {
      expect(Boolean(small.getBuildingTileAt(x, y))).toBe(Boolean(large.getBuildingTileAt(x, y)));
      expect(small.isBuildingAt(x, y)).toBe(large.isBuildingAt(x, y));
    }
  });

  it('bounds derived landmark blocks', () => {
    const world = makeWorld(16, 9);
    for (let x = -320; x <= 320; x += 32) world.getBuildingTileAt(x, 0);
    expect(world.getRegionalStats().cachedBlocks).toBeLessThanOrEqual(9);
  });

  it('builds only source blocks whose manifest extents can reach a query', () => {
    const world = makeWorld(32);
    world.getBuildingTileAt(12, 12);
    expect(world.getRegionalStats().cachedBlocks).toBe(1);
  });

  it('primes one bounded viewport without conflating preparation with rendering', () => {
    const world = makeWorld(32, 32);
    const result = world.prewarm(-4, -3, 4, 3, 4);
    expect(result).toMatchObject({
      biomeBoundsPrimed: true,
      routeBoundsPrimed: true,
      terrainTilesPrimed: 63,
      resolution: 4,
    });
    expect(result.providerBlocksPrimed).toBeGreaterThan(0);
    expect(world.getRegionalStats().cachedBlocks).toBeGreaterThan(0);
    expect(world.getTileAtResolution(0, 0, 4).pixels).toHaveLength(4);
  });

  it('exports and imports exact bounded viewport results without cold fallback', () => {
    const source = makeWorld(32, 32);
    const prepared = source.prepareViewport(-4, -3, 4, 3, 4);
    const target = makeWorld(32, 32);
    target.importPreparedViewport(structuredClone(prepared));

    expect(target.getRegionalStats()).toMatchObject({
      cachedBlocks: 0,
      preparedViewports: 1,
      preparedTerrainTiles: 63,
    });
    expect(target.hasPreparedViewportCoverage(-4, -3, 4, 3, 4)).toBe(true);
    expect(target.hasPreparedViewportCoverage(-5, -3, 4, 3, 4)).toBe(false);
    expect(target.hasPreparedViewportCoverage(-4, -3, 4, 3, 8)).toBe(false);
    for (let y = -3; y <= 3; y++) {
      for (let x = -4; x <= 4; x++) {
        expect(target.getTileAtResolution(x, y, 4)).toEqual(source.getTileAtResolution(x, y, 4));
        expect(target.getBuildingTileAt(x, y)).toEqual(source.getBuildingTileAt(x, y));
        expect(target.isBuildingAt(x, y)).toBe(source.isBuildingAt(x, y));
      }
    }
    expect(target.getRegionalStats().cachedBlocks).toBe(0);
  });

  it('rejects cross-seed or incomplete prepared viewports', () => {
    const source = makeWorld();
    const prepared = source.prepareViewport(0, 0, 1, 1, 4);
    expect(() => source.importPreparedViewport({ ...prepared, worldSeed: '43' }))
      .toThrow(/seed mismatch/);
    expect(() => source.importPreparedViewport({ ...prepared, terrain: prepared.terrain.slice(1) }))
      .toThrow(/coverage mismatch/);
  });
});
