import type { RGB, Tile } from '@maldoror/protocol';
import { describe, expect, it } from 'vitest';
import type { BiomeFamily, BiomeWeights, BiomeWorldSample } from '../biomes/biome-world-field.js';
import { BIOME_FAMILIES } from '../biomes/biome-world-field.js';
import type {
  RegionalCrossingKind,
  RegionalRouteKind,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import {
  RegionalMaterialCompositor,
  type BiomeSampler,
  type RegionalRouteSampler,
  type RegionalTextureReconstruction,
} from '../tiles/regional-material-compositor.js';
import {
  buildRegionalParcelPath,
  rasterizeRegionalParcelPath,
} from '../tiles/regional-parcel-path.js';
import {
  buildRegionalEnvironmentProgramLayout,
  rasterizeRegionalEnvironmentProgramLayout,
  sampleRegionalEnvironmentProgramLayout,
} from '../tiles/regional-environment-program-layout.js';
import {
  buildRegionalWaterfrontLayout,
  sampleRegionalWaterfrontLayout,
} from '../tiles/regional-waterfront-layout.js';
import { buildRegionalLandmarkFabricLayout } from '../tiles/regional-landmark-fabric-layout.js';

const COLOURS: Record<BiomeFamily, RGB> = {
  'canal-town': { r: 220, g: 150, b: 90 },
  forest: { r: 25, g: 100, b: 45 },
  coast: { r: 20, g: 130, b: 190 },
  rural: { r: 170, g: 160, b: 55 },
  mountain: { r: 135, g: 135, b: 150 },
  ruins: { r: 120, g: 65, b: 145 },
};

function solidTile(family: BiomeFamily, size = 8): Tile {
  const colour = COLOURS[family];
  const pixels = Array.from({ length: size }, () => Array.from({ length: size }, () => ({ ...colour })));
  return { id: family, name: family, walkable: family !== 'coast', pixels, resolutions: { [String(size)]: pixels } };
}

function solidColourTile(id: string, colour: RGB): Tile {
  const pixels = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ ...colour })));
  return { id, name: id, walkable: true, pixels, resolutions: { '8': pixels } };
}

function sample(weights: BiomeWeights, isWater = false): BiomeWorldSample {
  let primaryIndex = 0;
  for (let index = 1; index < weights.length; index++) if (weights[index]! > weights[primaryIndex]!) primaryIndex = index;
  const ecology = [1, 2, 3, 4].sort((a, b) => weights[b]! - weights[a]!)[0]!;
  return {
    weights,
    primary: BIOME_FAMILIES[primaryIndex]!,
    ecologicalPrimary: BIOME_FAMILIES[ecology] as BiomeWorldSample['ecologicalPrimary'],
    elevation: 0.5,
    slope: 0.01,
    waterDistance: isWater ? 0 : 10,
    isWater,
    isRiver: false,
  };
}

function compositor(field: BiomeSampler, maxCachedTiles = 8): RegionalMaterialCompositor {
  return new RegionalMaterialCompositor({
    worldSeed: 42n,
    field,
    maxCachedTiles,
    materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [family, [solidTile(family)]])) as Record<BiomeFamily, Tile[]>,
  });
}

function routeSample(
  routeKind: RegionalRouteKind,
  crossingKind: RegionalCrossingKind | null,
): RegionalRouteSample {
  return {
    distance: 0,
    isRoute: true,
    isCrossing: crossingKind !== null,
    isWalkableRoute: crossingKind !== 'ferry',
    crossingKind,
    routeKind,
    routeId: 'test-route',
    directionX: 1,
    directionY: 0,
    landmarkKind: null,
    landmarkDistance: Number.POSITIVE_INFINITY,
  };
}

function routedCompositor(routes: RegionalRouteSampler): RegionalMaterialCompositor {
  const routeColours: Record<RegionalRouteKind, RGB> = {
    trail: { r: 80, g: 55, b: 35 },
    'local-road': { r: 150, g: 105, b: 60 },
    arterial: { r: 190, g: 180, b: 165 },
  };
  return new RegionalMaterialCompositor({
    worldSeed: 42n,
    field: { sample: () => sample([0, 0, 1, 0, 0, 0], true) },
    routes,
    materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [family, [solidTile(family)]])) as Record<BiomeFamily, Tile[]>,
    routeMaterials: Object.fromEntries(Object.entries(routeColours).map(([kind, colour]) => [
      kind,
      [solidColourTile(`route:${kind}`, colour)],
    ])) as Record<RegionalRouteKind, Tile[]>,
    crossingMaterials: {
      bridge: [solidColourTile('crossing:bridge', { r: 210, g: 195, b: 170 })],
    },
  });
}

describe('RegionalMaterialCompositor', () => {
  it('uses cultural families as overlays instead of muddy six-way averaging', () => {
    const town = compositor({ sample: () => sample([1, 0, 0, 0, 0, 0]) });
    expect(town.getTile(0, 0).pixels[4]![4]).toEqual(COLOURS['canal-town']);

    const ruins = compositor({ sample: () => sample([0, 0, 0, 0, 0, 1]) });
    const centre = ruins.getTile(0, 0).pixels[4]![4]!;
    expect(centre.r).toBeGreaterThan(COLOURS.forest.r);
    expect(centre.b).toBeGreaterThan(120);
  });

  it('reconstructs a smooth ecological handoff across neighbouring tiles', () => {
    const field: BiomeSampler = {
      sample: (x) => {
        const coast = Math.max(0, Math.min(1, x / 2));
        return sample([0, 1 - coast, coast, 0, 0, 0], coast >= 0.5);
      },
    };
    const composed = compositor(field);
    const left = composed.getTile(0, 0);
    const right = composed.getTile(1, 0);
    const y = 4;
    const beforeEdge = left.pixels[y]![6]!;
    const leftEdge = left.pixels[y]![7]!;
    const rightEdge = right.pixels[y]![0]!;
    const afterEdge = right.pixels[y]![1]!;
    const jump = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(jump(leftEdge, rightEdge)).toBeLessThanOrEqual(
      Math.max(jump(beforeEdge, leftEdge), jump(rightEdge, afterEdge)) + 2,
    );
    expect(left.materialMask?.[y]?.[0]).toBe(0);
    expect(left.materialMask?.[y]?.[7]).toBe(1);
    expect(right.materialMask?.[y]?.[7]).toBe(1);
    expect(left.walkable).toBe(true);
    expect(right.walkable).toBe(false);
  });

  it('bounds composed tile cache and reuses live entries', () => {
    const composed = compositor({ sample: () => sample([0, 1, 0, 0, 0, 0]) }, 8);
    const first = composed.getTile(0, 0);
    expect(composed.getTile(0, 0)).toBe(first);
    for (let x = 1; x <= 12; x++) composed.getTile(x, 0);
    expect(composed.getStats()).toEqual({ cachedTiles: 8, maxCachedTiles: 8, sourceSize: 8 });
  });

  it('lays walkable bridge material over water but leaves ferries as water', () => {
    const bridge = routedCompositor({ sample: () => routeSample('local-road', 'bridge') }).getTile(0, 0);
    expect(bridge.pixels[4]![4]).toEqual({ r: 210, g: 195, b: 170 });
    expect(bridge.materialMask?.[4]?.[4]).toBe(0);
    expect(bridge.walkable).toBe(true);

    const ferry = routedCompositor({ sample: () => routeSample('local-road', 'ferry') }).getTile(0, 0);
    expect(ferry.pixels[4]![4]).toEqual(COLOURS.coast);
    expect(ferry.materialMask?.[4]?.[4]).toBe(1);
    expect(ferry.walkable).toBe(false);
  });

  it('blends parcel access material across the corridor axis without a ground stamp', () => {
    const noRoute: RegionalRouteSampler = {
      sample: () => ({
        ...routeSample('local-road', null),
        distance: 8,
        isRoute: false,
        isWalkableRoute: false,
        routeKind: null,
        routeId: null,
      }),
    };
    const composed = routedCompositor(noRoute);
    const base = composed.getTile(2, 3);
    const northSouth = composed.getAccessTile(2, 3, 'north-south', 'local-road');
    const eastWest = composed.getAccessTile(2, 3, 'east-west', 'local-road');
    const distance = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(northSouth.walkable).toBe(true);
    expect(distance(northSouth.pixels[4]![4]!, base.pixels[4]![4]!))
      .toBeGreaterThan(distance(northSouth.pixels[4]![0]!, base.pixels[4]![0]!));
    expect(distance(eastWest.pixels[4]![4]!, base.pixels[4]![4]!))
      .toBeGreaterThan(distance(eastWest.pixels[0]![4]!, base.pixels[0]![4]!));
    expect(northSouth.id).toContain('north-south:local-road');
    expect(eastWest.id).toContain('east-west:local-road');
  });

  it('reconstructs one curved parcel path continuously across tile boundaries', () => {
    const noRoute: RegionalRouteSampler = {
      sample: () => ({
        ...routeSample('local-road', null),
        distance: 8,
        isRoute: false,
        isWalkableRoute: false,
        routeKind: null,
        routeId: null,
      }),
    };
    const composed = routedCompositor(noRoute);
    const path = buildRegionalParcelPath({
      id: 'parcel:test-path',
      startX: 0.5,
      startY: 0.5,
      tangentX: 0,
      tangentY: 1,
      outwardSign: -1,
      length: 7,
      lateralOffset: 0,
    });
    const cells = rasterizeRegionalParcelPath(path);
    const core = cells.find((cell) => cell.x === 2 && cell.y === 0)!;
    const fringe = cells.find((cell) => !cell.core)!;
    const left = composed.getPathAccessTileAtResolution(2, 0, 8, path, 'local-road', core.core);
    const rightCore = cells.find((cell) => cell.x === 3 && cell.y === 0)!;
    const right = composed.getPathAccessTileAtResolution(
      3,
      0,
      8,
      path,
      'local-road',
      rightCore.core,
    );
    const fringeTile = composed.getPathAccessTileAtResolution(
      fringe.x,
      fringe.y,
      8,
      path,
      'local-road',
      fringe.core,
    );
    expect(left.id).toContain('regional-path-access:parcel:test-path');
    expect(left.walkable).toBe(true);
    expect(fringeTile.walkable).toBe(false);
    expect(left.pixels[4]![7]).toEqual(right.pixels[4]![0]);
    expect(composed.getPathAccessTileAtResolution(2, 0, 8, path, 'local-road', true)).toBe(left);
  });

  it('dissolves dry waterfront yards into terrain while retaining walkable piers', () => {
    const noRoute: RegionalRouteSampler = {
      sample: () => ({
        ...routeSample('local-road', null),
        distance: 8,
        isRoute: false,
        isWalkableRoute: false,
        routeKind: null,
        routeId: null,
      }),
    };
    const composed = routedCompositor(noRoute);
    const layout = buildRegionalWaterfrontLayout({
      id: 'waterfront:test-blend',
      accessStart: { x: 0, y: -10 },
      shorePoint: { x: 0, y: 0 },
      waterNormalX: 0,
      waterNormalY: 1,
      seed: 42,
      isWater: (_x, y) => y >= 0,
    })!;
    const distance = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    const interiorBase = composed.getTileAtResolution(0, -3, 8);
    const interior = composed.getWaterfrontGroundTileAtResolution(
      0,
      -3,
      8,
      layout,
      'local-road',
    );
    const fringeBase = composed.getTileAtResolution(7, -3, 8);
    const fringe = composed.getWaterfrontGroundTileAtResolution(
      7,
      -3,
      8,
      layout,
      'local-road',
    );
    const interiorDelta = distance(interior.pixels[4]![4]!, interiorBase.pixels[4]![4]!);
    const fringeDelta = distance(fringe.pixels[4]![3]!, fringeBase.pixels[4]![3]!);
    expect(interiorDelta).toBeGreaterThan(20);
    expect(fringeDelta).toBeLessThan(interiorDelta * 0.35);
    const pier = layout.piers[0]!.polygon.reduce((centre, point) => ({
      x: centre.x + point.x / 4,
      y: centre.y + point.y / 4,
    }), { x: 0, y: 0 });
    const pierTile = composed.getWaterfrontGroundTileAtResolution(
      Math.floor(pier.x),
      Math.floor(pier.y),
      8,
      layout,
      'local-road',
    );
    expect(pierTile.id).toContain('regional-waterfront-ground:waterfront:test-blend');
    expect(pierTile.walkable).toBe(true);

    let partialPierCell: { x: number; y: number } | null = null;
    for (let y = Math.floor(layout.bounds.minY); y <= Math.ceil(layout.bounds.maxY); y++) {
      for (let x = Math.floor(layout.bounds.minX); x <= Math.ceil(layout.bounds.maxX); x++) {
        const centre = sampleRegionalWaterfrontLayout(x + 0.5, y + 0.5, layout);
        const centreWeight = Math.max(centre.apronWeight, centre.workYardWeight, centre.pierWeight);
        let sampledWeight = 0;
        for (let sampleY = 0; sampleY < 8; sampleY++) {
          for (let sampleX = 0; sampleX < 8; sampleX++) {
            sampledWeight = Math.max(sampledWeight, sampleRegionalWaterfrontLayout(
              x + (sampleX + 0.5) / 8,
              y + (sampleY + 0.5) / 8,
              layout,
            ).pierWeight);
          }
        }
        if (centreWeight <= 0.08 && sampledWeight > 0.2) partialPierCell ??= { x, y };
      }
    }
    expect(partialPierCell).not.toBeNull();
    expect(composed.getWaterfrontGroundTileAtResolution(
      partialPierCell!.x,
      partialPierCell!.y,
      8,
      layout,
      'local-road',
    ).walkable).toBe(true);
  });

  it('preserves authored landmark-paver contrast instead of averaging unrelated phases', () => {
    const noRoute: RegionalRouteSampler = {
      sample: () => ({
        ...routeSample('local-road', null),
        distance: 8,
        isRoute: false,
        isWalkableRoute: false,
        routeKind: null,
        routeId: null,
      }),
    };
    const checkerPixels = Array.from({ length: 8 }, (_, y) => Array.from({ length: 8 }, (_, x) => (
      (x + y) % 2 === 0 ? { r: 230, g: 215, b: 175 } : { r: 75, g: 66, b: 52 }
    )));
    const checker: Tile = {
      id: 'landmark:checker-pavers',
      name: 'landmark:checker-pavers',
      walkable: true,
      pixels: checkerPixels,
      resolutions: { '8': checkerPixels },
    };
    const composed = new RegionalMaterialCompositor({
      worldSeed: 42n,
      field: { sample: () => sample([0, 0, 0, 1, 0, 0]) },
      routes: noRoute,
      materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [
        family,
        [solidTile(family)],
      ])) as Record<BiomeFamily, Tile[]>,
      routeMaterials: {
        trail: [solidColourTile('route:trail', { r: 80, g: 70, b: 55 })],
        'local-road': [solidColourTile('route:local-road', { r: 110, g: 100, b: 85 })],
        arterial: [solidColourTile('route:arterial', { r: 130, g: 120, b: 105 })],
      },
      landmarkFabricMaterials: { 'canal-town': [checker] },
    });
    const layout = buildRegionalLandmarkFabricLayout({
      id: 'landmark:test-authored-pavers',
      materialFamily: 'canal-town',
      siteX: 0,
      siteY: 0,
      seed: 42,
      focals: [{
        id: 'east-frontage',
        frontageAxis: 'north-south',
        compositionSide: 1,
        frontageStations: [0],
        minX: 2,
        minY: -4,
        maxX: 6,
        maxY: 4,
      }],
    })!;
    const tile = composed.getLandmarkFabricGroundTileAtResolution(1, 0, 8, layout, 'local-road');
    const reds = tile.pixels.flat().map((pixel) => pixel!.r);
    expect(Math.max(...reds) - Math.min(...reds)).toBeGreaterThan(35);
    expect(tile.id).toContain('regional-landmark-fabric:landmark:test-authored-pavers');
    expect(tile.walkable).toBe(true);

    const waterComposed = new RegionalMaterialCompositor({
      worldSeed: 42n,
      field: { sample: () => sample([0, 0, 1, 0, 0, 0], true) },
      routes: noRoute,
      materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [
        family,
        [solidTile(family)],
      ])) as Record<BiomeFamily, Tile[]>,
      routeMaterials: {
        trail: [solidColourTile('route:trail', { r: 80, g: 70, b: 55 })],
        'local-road': [solidColourTile('route:local-road', { r: 110, g: 100, b: 85 })],
        arterial: [solidColourTile('route:arterial', { r: 130, g: 120, b: 105 })],
      },
      landmarkFabricMaterials: { 'canal-town': [checker] },
    });
    const waterBase = waterComposed.getTileAtResolution(1, 0, 8);
    const waterThreshold = waterComposed.getLandmarkFabricGroundTileAtResolution(
      1,
      0,
      8,
      layout,
      'local-road',
    );
    expect(waterThreshold.pixels).toEqual(waterBase.pixels);
    expect(waterThreshold.walkable).toBe(false);
  });

  it('carves cave darkness and contour trails from blended terrain instead of square stamps', () => {
    const noRoute: RegionalRouteSampler = {
      sample: () => ({
        ...routeSample('trail', null),
        distance: 8,
        isRoute: false,
        isWalkableRoute: false,
        routeKind: null,
        routeId: null,
      }),
    };
    const composed = routedCompositor(noRoute);
    const cave = buildRegionalEnvironmentProgramLayout({
      id: 'environment:test-cave-material',
      kind: 'cave-interior',
      routePoint: { x: 0, y: 0 },
      anchorPoint: { x: 4, y: 0 },
      seed: 42,
      sampleTerrain: () => ({ elevation: 0.5, slope: 0.02, isWater: false }),
    })!;
    const cells = rasterizeRegionalEnvironmentProgramLayout(cave);
    const floor = {
      x: Math.floor(cave.chambers[0]!.centre.x),
      y: Math.floor(cave.chambers[0]!.centre.y),
    };
    const wall = cells.filter((cell) => cell.solid && cell.roles.includes('cave-wall'))
      .sort((a, b) => (
        sampleRegionalEnvironmentProgramLayout(b.x + 0.5, b.y + 0.5, cave).caveWallWeight -
        sampleRegionalEnvironmentProgramLayout(a.x + 0.5, a.y + 0.5, cave).caveWallWeight
      ))[0]!;
    const floorBase = composed.getTileAtResolution(floor.x, floor.y, 8);
    const floorTile = composed.getEnvironmentProgramGroundTileAtResolution(
      floor.x,
      floor.y,
      8,
      cave,
      'trail',
    );
    const wallBase = composed.getTileAtResolution(wall.x, wall.y, 8);
    const wallTile = composed.getEnvironmentProgramGroundTileAtResolution(
      wall.x,
      wall.y,
      8,
      cave,
      'trail',
    );
    const luminance = (colour: RGB) => colour.r * 0.2126 + colour.g * 0.7152 + colour.b * 0.0722;
    expect(floorTile.id).toContain('regional-environment-program:environment:test-cave-material');
    expect(floorTile.walkable).toBe(true);
    expect(luminance(floorTile.pixels[4]![4]!)).toBeLessThan(
      luminance(floorBase.pixels[4]![4]!) * 0.75,
    );
    expect(luminance(wallTile.pixels[4]![4]!)).toBeLessThan(
      luminance(wallBase.pixels[4]![4]!),
    );

    const fringe = cells.find((cell) => cell.roles.includes('cave-wall') && !cell.solid)!;
    const fringeBase = composed.getTileAtResolution(fringe.x, fringe.y, 8);
    const fringeTile = composed.getEnvironmentProgramGroundTileAtResolution(
      fringe.x,
      fringe.y,
      8,
      cave,
      'trail',
    );
    const delta = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(delta(fringeTile.pixels[0]![0]!, fringeBase.pixels[0]![0]!)).toBeLessThan(20);
  });

  it('authors only the requested semantic LOD and reuses quantized zoom bands', () => {
    const composed = new RegionalMaterialCompositor({
      worldSeed: 42n,
      field: { sample: () => sample([0, 1, 0, 0, 0, 0]) },
      materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [
        family,
        [solidTile(family, 32)],
      ])) as Record<BiomeFamily, Tile[]>,
    });
    const detail = composed.getTile(0, 0);
    const overview = composed.getTileAtResolution(0, 0, 4);
    const animatedZoomA = composed.getTileAtResolution(0, 0, 6);
    const animatedZoomB = composed.getTileAtResolution(0, 0, 7);
    expect(detail.pixels).toHaveLength(32);
    expect(detail.resolutions?.['26']).toBeUndefined();
    expect(overview.pixels).toHaveLength(4);
    expect(overview.pixels[0]).toHaveLength(4);
    expect(animatedZoomA.pixels).toHaveLength(8);
    expect(animatedZoomB).toBe(animatedZoomA);
  });

  it('keeps all reconstruction candidates deterministic and caps output below sampling resolution', () => {
    const patterned = (family: BiomeFamily): Tile => {
      const pixels = Array.from({ length: 32 }, (_, y) => Array.from({ length: 32 }, (_, x) => ({
        r: (x * 7 + y * 3 + COLOURS[family].r) % 256,
        g: (x * 2 + y * 11 + COLOURS[family].g) % 256,
        b: (x * 13 + y * 5 + COLOURS[family].b) % 256,
      })));
      return { id: family, name: family, walkable: true, pixels, resolutions: { '32': pixels } };
    };
    const signatures = new Set<string>();
    for (const textureReconstruction of [
      'square-bilinear',
      'hex-contrast',
      'hex-laplacian',
      'cellular-semantic',
    ] satisfies RegionalTextureReconstruction[]) {
      const create = () => new RegionalMaterialCompositor({
        worldSeed: 42n,
        field: { sample: () => sample([0, 1, 0, 0, 0, 0]) },
        materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [
          family,
          [patterned(family)],
        ])) as Record<BiomeFamily, Tile[]>,
        maxOutputResolution: 8,
        textureReconstruction,
      });
      const first = create();
      const second = create();
      const tile = first.getTile(17, -9);
      expect(tile.pixels).toHaveLength(8);
      expect(tile).toEqual(second.getTile(17, -9));
      expect(tile.pixels.flat().every((pixel) =>
        pixel !== null && Number.isInteger(pixel.r) &&
        Number.isInteger(pixel.g) && Number.isInteger(pixel.b)))
        .toBe(true);
      signatures.add(JSON.stringify(tile.pixels));
    }
    expect(signatures.size).toBe(4);
  });
});
