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
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from '../tiles/regional-material-compositor.js';
import {
  RegionalWorldTileProvider,
  type RegionalLandmarkAsset,
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
    directionX: 1,
    directionY: 0,
    landmarkKind: site?.[2] ?? null,
    landmarkDistance: site ? 0 : Number.POSITIVE_INFINITY,
  };
}

function makeWorld(blockSize = 32, maxCachedBlocks = 32): RegionalWorldTileProvider {
  const field = { sample: (x: number) => biomeSample(nearestFamily(x)) };
  const routes = { sample: routeSample };
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
  return new RegionalWorldTileProvider({
    worldSeed: 42n,
    field,
    routes,
    compositor,
    landmarks,
    blockSize,
    maxCachedBlocks,
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
});
