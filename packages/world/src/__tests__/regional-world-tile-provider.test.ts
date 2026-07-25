import type { BuildingSprite, RGB, Tile } from '@maldoror/protocol';
import { describe, expect, it } from 'vitest';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldSample,
  type ConstructedWaterwaySample,
} from '../biomes/biome-world-field.js';
import type {
  RegionalLandmarkKind,
  RegionalLandmarkSite,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from '../tiles/regional-material-compositor.js';
import { rasterizeRegionalEnvironmentProgramLayout } from '../tiles/regional-environment-program-layout.js';
import { rasterizeRegionalLandmarkFabricLayout } from '../tiles/regional-landmark-fabric-layout.js';
import {
  RegionalWorldDerivedCache,
  RegionalWorldTileProvider,
  type RegionalAmbientAsset,
  type RegionalEnvironmentContactAsset,
  type RegionalLandmarkAsset,
  type RegionalParcelComponentAsset,
  type RegionalPackedPreparedViewport,
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
    signedDistance: y,
    crossingInfluenceKind: null,
    crossingSpan: 0,
    crossingProgress: Number.POSITIVE_INFINITY,
    halfWidth: 1,
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
  sampleBiome: (x: number, y: number) => BiomeWorldSample = (x) => biomeSample(nearestFamily(x)),
  includeEnvironmentPrograms = false,
  derivedCache?: RegionalWorldDerivedCache,
  includeQuay = false,
): RegionalWorldTileProvider {
  const quayDescriptor = {
    id: 'test-canal',
    materialFamily: 'canal-town' as const,
    bounds: { minX: -20, minY: 0, maxX: 20, maxY: 15 },
  };
  const field = {
    sample: sampleBiome,
    prewarm: () => undefined,
    getConstructedWaterways: () => includeQuay ? [quayDescriptor] : [],
    sampleConstructedWaterway: (
      x: number,
      y: number,
      id = quayDescriptor.id,
    ): ConstructedWaterwaySample | null => {
      if (!includeQuay || id !== quayDescriptor.id || x < -20 || x > 20 || y < 0 || y > 15) {
        return null;
      }
      const bankSide: -1 | 1 = y < 10 ? -1 : 1;
      return {
        id,
        progress: (x + 20) / 40,
        centreX: x,
        centreY: 10,
        tangentX: 1,
        tangentY: 0,
        bankNormalX: 0,
        bankNormalY: bankSide,
        bankSide,
        halfWidth: 1.25,
        signedDistance: Math.abs(y - 10) - 1.25,
      };
    },
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
    crossingMaterials: { bridge: [solidTile('mountain')] },
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
    emitsLight: family === 'canal-town',
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
  const parcelComponents: RegionalParcelComponentAsset[] = BIOME_FAMILIES.flatMap((family) =>
    Array.from({ length: family === 'canal-town' ? 7 : 6 }, (_, variant) => ({
      id: `parcel:${family}:${variant}`,
      families: [family],
      role: 'mass' as const,
      compositionRole: family === 'canal-town' && variant >= 4 ? 'focal' as const : undefined,
      frontageAxis: family === 'canal-town' && variant < 2
        ? 'east-west' as const
        : family === 'canal-town' && variant >= 4
          ? variant === 4 ? 'east-west' as const : 'north-south' as const
          : undefined,
      compositionSide: family === 'canal-town' && variant >= 4
        ? variant === 4 || variant === 6 ? -1 as const : 1 as const
        : undefined,
      frontageStations: family === 'canal-town' && variant >= 4
        ? variant === 4 ? [-0.3, 0.35] as const : [variant === 5 ? -0.24 : 0.31] as const
        : undefined,
      programs: (family === 'canal-town' || family === 'coast') && variant < 2
        ? ['waterfront'] as const
        : undefined,
      waterfrontFunction: (family === 'canal-town' || family === 'coast') && variant < 2
        ? variant === 0 ? 'workshop' as const : 'boat-shed' as const
        : undefined,
      quayBankSide: family === 'canal-town' && variant < 2
        ? variant === 0 ? -1 as const : 1 as const
        : undefined,
      sprite: sprite(COLOURS[family]),
      collision: [[0, 0]] as const,
    })));
  const environmentContacts: RegionalEnvironmentContactAsset[] = (['coast', 'mountain'] as const)
    .map((family) => ({
      id: `environment:${family}`,
      families: [family],
      role: 'environment-contact' as const,
      program: includeEnvironmentPrograms && family === 'mountain'
        ? 'cave-interior' as const
        : undefined,
      sprite: sprite(COLOURS[family]),
      collision: [[0, 0]] as const,
      constraints: {
        landOnly: true,
        waterDistance: [0, 999] as const,
        elevation: [0, 1] as const,
        slope: [0, 1] as const,
        routeDistance: includeEnvironmentPrograms && family === 'mountain'
          ? [1.5, 12] as const
          : [1.5, 999] as const,
        nearbyWaterRadius: 0,
      },
    }));
  return new RegionalWorldTileProvider({
    worldSeed: 42n,
    field,
    routes,
    compositor,
    landmarks,
    ambient,
    routeContacts,
    parcelComponents,
    environmentContacts,
    blockSize,
    maxCachedBlocks,
    ambientCellSize: 4,
    ambientDensity: 1,
    ambientLandmarkClearance: 4,
    routeContactCellSize: 10,
    routeContactDensity: 1,
    routeContactLandmarkClearance: 4,
    parcelMinimumLayers: 2,
    parcelMaximumLayers: 3,
    parcelLayerSpacing: 5,
    environmentContactCellSize: 18,
    environmentContactDensity: 1,
    environmentContactLandmarkClearance: 4,
    derivedCache,
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
  it('shares deterministic regional caches without sharing mutable actor state', () => {
    const shared = new RegionalWorldDerivedCache();
    const first = makeWorld(32, 32, routeSample, undefined, false, shared);
    const second = makeWorld(32, 32, routeSample, undefined, false, shared);

    first.getAmbientPlacementsInBounds(-24, -24, 24, 24);
    const populated = first.getRegionalStats();
    expect(populated.cachedBlocks).toBeGreaterThan(0);
    expect(second.getRegionalStats().cachedBlocks).toBe(populated.cachedBlocks);

    first.setLocalPlayerId('first');
    second.setLocalPlayerId('second');
    first.updatePlayer({
      userId: 'first',
      username: 'first',
      x: 0,
      y: 0,
      direction: 'down',
      animationFrame: 0,
      isMoving: false,
    });
    expect(second.getPlayers()).toHaveLength(0);

    first.destroy();
    expect(second.getRegionalStats().cachedBlocks).toBe(populated.cachedBlocks);
    shared.clear();
    expect(second.getRegionalStats().cachedBlocks).toBe(0);
  });

  it('projects declarative emitting placements into deterministic bounded lights', () => {
    const world = makeWorld();
    const first = world.getLightSourcesInBounds(-10, -10, 10, 10);
    const replay = world.getLightSourcesInBounds(-10, -10, 10, 10);

    expect(first).toEqual(replay);
    expect(first).toContainEqual(expect.objectContaining({
      id: expect.stringContaining('landmark:canal-town'),
      radius: 5.5,
    }));
    expect(world.getLightSourcesInBounds(5000, 5000, 5001, 5001)).toHaveLength(0);
  });

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
    expect(world.getRegionalStats().parcelComponentAssets).toBe(BIOME_FAMILIES.length * 6 + 1);
    expect(world.getRegionalStats().environmentContactAssets).toBe(2);
  });

  it('grows curved parcel spines from authored route-relative thresholds', () => {
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
    const horizontalComponents = horizontal.getParcelComponentPlacementsInBounds(-24, -24, 224, 24);
    const horizontalConnectors = horizontal.getParcelConnectorCellsInBounds(-40, -40, 240, 40);
    const horizontalLayouts = horizontal.getParcelLayoutsInBounds(-40, -40, 240, 40);
    expect(horizontalComponents.length).toBeGreaterThan(horizontalContacts.length);
    expect(horizontalConnectors.length).toBeGreaterThan(horizontalContacts.length * 8);
    expect(horizontalLayouts.length).toBeGreaterThan(4);
    expect(horizontalLayouts.some((layout) => (
      layout.plots.some((plot) => plot.purpose === 'civic-opening')
    ))).toBe(true);
    for (const layout of horizontalLayouts) {
      expect(layout.plots.length).toBeGreaterThanOrEqual(2);
      for (const side of [-1, 1] as const) {
        const plots = layout.plots.filter((plot) => plot.side === side)
          .sort((a, b) => a.stationIndex - b.stationIndex);
        for (let index = 1; index < plots.length; index++) {
          expect(plots[index - 1]!.polygon[1]).toBe(plots[index]!.polygon[0]);
          expect(plots[index - 1]!.polygon[2]).toBe(plots[index]!.polygon[3]);
        }
      }
      const plot = layout.plots[0]!;
      const centreX = Math.floor(plot.polygon.reduce((sum, point) => sum + point.x / 4, 0));
      const centreY = Math.floor(plot.polygon.reduce((sum, point) => sum + point.y / 4, 0));
      expect(horizontal.getTile(centreX, centreY).id).toMatch(
        /^regional-(parcel-ground|path-access):/,
      );
    }
    expect(new Set(horizontalComponents.flatMap((placement) => placement.families)))
      .toEqual(new Set(BIOME_FAMILIES));
    for (const component of horizontalComponents) {
      expect(component.parcelId).toMatch(/^parcel:-?\d+:-?\d+$/);
      expect(component.routeKind).toBe('local-road');
      expect(component.parcelPathId).toBe(component.parcelId);
      expect(component.parcelStation).toBeGreaterThan(0);
      expect(Math.hypot(component.pathTangentX!, component.pathTangentY!)).toBeCloseTo(1, 6);
    }
    for (const parcelId of new Set(horizontalComponents.map((component) => component.parcelId))) {
      const ids = horizontalComponents
        .filter((component) => component.parcelId === parcelId)
        .map((component) => component.assetId);
      expect(new Set(ids).size).toBe(ids.length);
    }
    for (const contact of horizontalContacts) {
      const members = horizontalComponents.filter((component) => component.parcelId === contact.parcelId);
      if (members.length === 0) continue;
      const cells = horizontalConnectors.filter((cell) => cell.parcelId === contact.parcelId);
      const core = cells.filter((cell) => cell.core);
      expect(contact.parcelLayers).toBeGreaterThanOrEqual(2);
      expect(contact.connectorLength).toBeGreaterThan(0);
      expect(core.length).toBeGreaterThan(contact.connectorLength!);
      expect(cells.every((cell) => cell.pathId === contact.parcelId)).toBe(true);
      expect(cells[0]!.arcLength).toBeGreaterThanOrEqual(contact.connectorLength!);
      for (const cell of core) {
        expect(horizontal.isBuildingAt(cell.x, cell.y),
          `connector collision at ${cell.x},${cell.y}`).toBe(false);
        expect(horizontal.getBuildingTileAt(cell.x, cell.y),
          `connector art at ${cell.x},${cell.y}`).toBeNull();
        expect(horizontal.getTile(cell.x, cell.y).id).toContain('regional-path-access:');
      }
    }
    expect(Math.max(...horizontalConnectors.map((cell) => Math.abs(cell.lateralOffset))))
      .toBeGreaterThan(0.5);
    expect(horizontal.getRegionalStats().cachedParcelSurfaceCells).toBeGreaterThan(0);

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
    const verticalConnectors = vertical.getParcelConnectorCellsInBounds(-40, -184, 40, 184);
    expect(verticalConnectors.some((cell) => cell.core)).toBe(true);
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
      const assetIds = new Set(placements
        .filter((placement) => placement.families.includes(family))
        .map((placement) => placement.assetId));
      expect(assetIds).toContain(`ambient:${family}:0`);
      expect(assetIds).toContain(`ambient:${family}:1`);
      expect(assetIds.size).toBeGreaterThan(2);
    }
    const protectedCells = new Set(world.getParcelConnectorCellsInBounds(-32, -48, 232, 48)
      .filter((cell) => cell.protected)
      .map((cell) => `${cell.x},${cell.y}`));
    for (const placement of placements) {
      expect(Math.abs(placement.anchorY)).toBeGreaterThanOrEqual(2);
      const occupied = world.isBuildingAt(placement.anchorX, placement.anchorY);
      expect(occupied || protectedCells.has(`${placement.anchorX},${placement.anchorY}`)).toBe(true);
    }
  });

  it('builds a compact route-open entourage around the arrival landmark', () => {
    const world = makeWorld();
    const entourage = world.getAmbientPlacementsInBounds(-22, -22, 22, 22)
      .filter((placement) => placement.siteX === 0 && placement.siteY === 0);

    expect(entourage.length).toBeGreaterThanOrEqual(8);
    expect(new Set(entourage.map((placement) => `${placement.anchorX},${placement.anchorY}`)).size)
      .toBe(entourage.length);
    expect(entourage.every((placement) => placement.families.includes('canal-town'))).toBe(true);
    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:4')).toBe(true);
    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:5')).toBe(false);
    expect(entourage.every((placement) => Math.abs(placement.anchorY) >= 2)).toBe(true);
    const usage = new Map<string, number>();
    for (const placement of entourage) {
      usage.set(placement.assetId, (usage.get(placement.assetId) ?? 0) + 1);
    }
    expect(usage.size).toBeGreaterThanOrEqual(4);
    expect(Math.max(...usage.values())).toBeLessThanOrEqual(Math.ceil(entourage.length / 3));
    expect(world.isBuildingAt(0, 0)).toBe(false);
    expect(world.getTile(0, 0).walkable).toBe(true);
    const fabrics = world.getLandmarkFabricLayoutsInBounds(-22, -22, 22, 22)
      .filter((layout) => layout.id.includes(':0:0:arrival'));
    expect(fabrics).toHaveLength(1);
    expect(fabrics[0]?.aprons).toHaveLength(4);
    expect(fabrics[0]?.aprons.map((apron) => apron.role).sort())
      .toEqual(['approach', 'approach', 'threshold', 'threshold']);
    const fabricCell = rasterizeRegionalLandmarkFabricLayout(fabrics[0]!)
      .find((cell) => cell.x === Math.floor(fabrics[0]!.aprons[0]!.centreX) &&
        cell.y === Math.floor(fabrics[0]!.aprons[0]!.centreY));
    expect(fabricCell).toBeDefined();
    expect(world.getTileAtResolution(fabricCell!.x, fabricCell!.y, 4).id)
      .toContain('regional-landmark-fabric:landmark-fabric:0:0:arrival');
  });

  it('orients focal frontage from the landmark route when off-route samples lose direction', () => {
    const northSouthRoute = (x: number, y: number): RegionalRouteSample => ({
      distance: Math.abs(x),
      signedDistance: -x,
      crossingInfluenceKind: null,
      crossingSpan: 0,
      crossingProgress: Number.POSITIVE_INFINITY,
      halfWidth: 1,
      isRoute: x === 0,
      isCrossing: false,
      isWalkableRoute: x === 0,
      crossingKind: null,
      routeKind: x === 0 ? 'local-road' : null,
      routeId: x === 0 ? 'north-south-test-route' : null,
      directionX: 0,
      directionY: x === 0 ? 1 : 0,
      landmarkKind: x === 0 && y === 0 ? 'arrival' : null,
      landmarkDistance: x === 0 && y === 0 ? 0 : Number.POSITIVE_INFINITY,
    });
    const world = makeWorld(32, 32, northSouthRoute);
    const entourage = world.getAmbientPlacementsInBounds(-22, -22, 22, 22)
      .filter((placement) => placement.siteX === 0 && placement.siteY === 0);

    const focal = entourage.find((placement) => placement.assetId === 'parcel:canal-town:5');
    const opposite = entourage.find((placement) => placement.assetId === 'parcel:canal-town:6');
    expect(focal).toBeDefined();
    expect(opposite).toBeDefined();
    expect(focal?.anchorY).toBe(1);
    expect(Math.abs(focal?.anchorX ?? 0)).toBe(4);
    expect((focal?.anchorX ?? 0) * (opposite?.anchorX ?? 0)).toBeLessThan(0);
    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:4')).toBe(false);
  });

  it('uses the tall frontage for equal-axis diagonal routes', () => {
    const diagonalRoute = (x: number, y: number): RegionalRouteSample => ({
      distance: Math.abs(x - y) / Math.SQRT2,
      signedDistance: (x - y) / Math.SQRT2,
      crossingInfluenceKind: null,
      crossingSpan: 0,
      crossingProgress: Number.POSITIVE_INFINITY,
      halfWidth: 1,
      isRoute: x === y,
      isCrossing: false,
      isWalkableRoute: x === y,
      crossingKind: null,
      routeKind: x === y ? 'arterial' : null,
      routeId: x === y ? 'diagonal-test-route' : null,
      directionX: x === y ? -Math.SQRT1_2 : 0,
      directionY: x === y ? -Math.SQRT1_2 : 0,
      landmarkKind: x === 0 && y === 0 ? 'arrival' : null,
      landmarkDistance: x === 0 && y === 0 ? 0 : Number.POSITIVE_INFINITY,
    });
    const world = makeWorld(32, 32, diagonalRoute);
    const entourage = world.getAmbientPlacementsInBounds(-22, -22, 22, 22)
      .filter((placement) => placement.siteX === 0 && placement.siteY === 0);

    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:5')).toBe(true);
    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:6')).toBe(true);
    expect(entourage.some((placement) => placement.assetId === 'parcel:canal-town:4')).toBe(false);
  });

  it('turns physically water-terminated thresholds into connected working waterfronts', () => {
    const waterField = (x: number, y: number): BiomeWorldSample => ({
      ...biomeSample(nearestFamily(x)),
      waterDistance: Math.abs(y) >= 10 ? 0 : 10 - Math.abs(y),
      isWater: Math.abs(y) >= 10,
    });
    const world = makeWorld(32, 32, routeSample, waterField);
    const layouts = world.getWaterfrontLayoutsInBounds(-24, -20, 104, 24);
    const contacts = world.getRouteContactPlacementsInBounds(-24, -20, 104, 24);
    expect(layouts.length, JSON.stringify({
      contacts,
      parcels: world.getParcelLayoutsInBounds(-24, -20, 104, 24).map((layout) => ({
        id: layout.id,
        bounds: layout.bounds,
      })),
      stats: world.getRegionalStats(),
    })).toBeGreaterThan(0);
    const layout = layouts[0]!;
    expect(layout.piers).toHaveLength(2);
    expect(layout.slips).toHaveLength(1);
    const components = world.getParcelComponentPlacementsInBounds(-40, -24, 120, 28)
      .filter((placement) => placement.waterfrontId === layout.id);
    expect(components.length).toBeGreaterThan(0);
    expect(components.every((placement) => placement.waterfrontFunction)).toBe(true);
    const pierCentre = layout.piers[0]!.polygon.reduce((sum, point) => ({
      x: sum.x + point.x / 4,
      y: sum.y + point.y / 4,
    }), { x: 0, y: 0 });
    const pierTile = world.getTile(Math.floor(pierCentre.x), Math.floor(pierCentre.y));
    expect(pierTile.id).toContain('regional-waterfront-ground:');
    expect(pierTile.walkable).toBe(true);
    const access = world.getParcelConnectorCellsInBounds(-40, -24, 120, 28)
      .filter((cell) => cell.pathId === layout.accessPath.id);
    expect(access.some((cell) => cell.core)).toBe(true);
    expect(access.filter((cell) => cell.protected).every((cell) => (
      !world.isBuildingAt(cell.x, cell.y)
    ))).toBe(true);
    expect(world.getRegionalStats()).toMatchObject({
      cachedWaterfrontPrograms: expect.any(Number),
      cachedWaterfrontSurfaceCells: expect.any(Number),
    });
    expect(world.getRegionalStats().cachedWaterfrontPrograms).toBeGreaterThan(0);
    expect(world.getRegionalStats().cachedWaterfrontSurfaceCells).toBeGreaterThan(0);
  });

  it('projects constructed waterways into paired walkable quays with matching collision exports', () => {
    const quayBiome = (_x: number, y: number): BiomeWorldSample => {
      const wet = Math.abs(y - 10) <= 1.25;
      return {
        ...biomeSample('canal-town'),
        waterDistance: wet ? 0 : Math.max(0, Math.abs(y - 10) - 1.25),
        isWater: wet,
        isRiver: wet,
      };
    };
    const world = makeWorld(32, 32, routeSample, quayBiome, false, undefined, true);
    expect(world.getQuayLayoutsInBounds(-4, 6, 4, 14)).toHaveLength(1);

    const northQuay = world.getTileAtResolution(0, 7, 8);
    const southQuay = world.getTileAtResolution(0, 12, 8);
    expect(northQuay.id).toContain('regional-quay-ground:quay:test-canal');
    expect(southQuay.id).toContain('regional-quay-ground:quay:test-canal');
    expect(northQuay.walkable).toBe(true);
    expect(southQuay.walkable).toBe(true);
    expect(world.getTileAtResolution(0, 10, 8).walkable).toBe(false);
    const frontage = world.getAmbientPlacementsInBounds(-20, 5, 20, 15)
      .filter((placement) => placement.waterfrontId === 'quay:test-canal');
    expect(frontage.length).toBeGreaterThanOrEqual(3);
    expect(frontage.every((placement) => (
      placement.waterfrontFunction && placement.parcelPathId === 'quay:test-canal'
    ))).toBe(true);

    // The legacy authored-building protocol anchors a 3x3 sprite at its
    // bottom-centre. Use the upper tile row to model a facade overhang while
    // the quay cell itself remains traversable.
    world.setBuilding('quay-overhang', 0, 13, sprite({ r: 250, g: 20, b: 20 }));
    expect(world.getBuildingTileAt(0, 12)).not.toBeNull();
    expect(world.isBuildingAt(0, 12)).toBe(false);

    const prepared = world.prepareViewport(-2, 7, 2, 13, 8);
    expect(prepared.terrain.find((tile) => tile.x === 0 && tile.y === 12)?.tile.id)
      .toContain('regional-quay-ground:quay:test-canal');
    expect(prepared.overlays.some((tile) => tile.x === 0 && tile.y === 12)).toBe(true);
    expect(prepared.solid.some(([x, y]) => x === 0 && y === 12)).toBe(false);
  });

  it('places sparse environment contacts only where declarative envelopes match', () => {
    const world = makeWorld();
    const placements = world.getEnvironmentContactPlacementsInBounds(-400, -400, 400, 400);
    expect(placements.length).toBeGreaterThan(0);
    expect(new Set(placements.flatMap((placement) => placement.families)))
      .toEqual(new Set(['coast', 'mountain']));
    for (const placement of placements) {
      expect(placement.assetId).toBe(`environment:${placement.families[0]}`);
      expect(world.isBuildingAt(placement.anchorX, placement.anchorY)).toBe(true);
    }
    const reversed = makeWorld(48);
    for (const placement of [...placements].reverse()) {
      reversed.getBuildingTileAt(placement.anchorX, placement.anchorY);
    }
    expect(reversed.getEnvironmentContactPlacementsInBounds(-400, -400, 400, 400)).toEqual(placements);
  });

  it('decorrelates two-dimensional contact jitter instead of collapsing into placement rows', () => {
    const world = makeWorld(32, 32, routeSample, () => biomeSample('mountain'));
    const placements = world.getEnvironmentContactPlacementsInBounds(-2000, -48, 2000, 48);
    const occupiedRows = new Set(placements.map((placement) => placement.anchorY));
    const jitterPhases = new Set(placements.map((placement) => {
      const phaseX = ((placement.anchorX % 18) + 18) % 18;
      const phaseY = ((placement.anchorY % 18) + 18) % 18;
      return `${phaseX},${phaseY}`;
    }));
    expect(placements.length).toBeGreaterThan(80);
    expect(occupiedRows.size).toBeGreaterThan(placements.length * 0.25);
    expect(jitterPhases.size).toBeGreaterThan(placements.length * 0.4);
  });

  it('expands semantic cave contacts into connected walkable interiors and solid rock', () => {
    const offsetRoute = (x: number, y: number) => routeSample(x, y - 10);
    const world = makeWorld(32, 32, offsetRoute, () => biomeSample('mountain'), true);
    const layouts = world.getEnvironmentProgramLayoutsInBounds(-100, -48, 100, 64);
    const cave = layouts.find((layout) => layout.kind === 'cave-interior');
    expect(cave).toBeDefined();
    expect(cave!.interiorPaths).toHaveLength(2);
    expect(cave!.chambers).toHaveLength(2);
    const cells = rasterizeRegionalEnvironmentProgramLayout(cave!);
    const floor = cells.find((cell) => cell.walkable && cell.roles.includes('cave-floor'))!;
    const wall = cells.find((cell) => cell.solid && cell.roles.includes('cave-wall'))!;
    expect(world.getTile(floor.x, floor.y).id).toContain('regional-environment-program:');
    expect(world.isBuildingAt(floor.x, floor.y)).toBe(false);
    expect(world.isBuildingAt(wall.x, wall.y)).toBe(true);
    const prepared = world.prepareViewport(
      Math.floor(cave!.bounds.minX),
      Math.floor(cave!.bounds.minY),
      Math.ceil(cave!.bounds.maxX),
      Math.ceil(cave!.bounds.maxY),
      8,
    );
    expect(prepared.solid.some(([x, y]) => x === floor.x && y === floor.y)).toBe(false);
    expect(prepared.solid.some(([x, y]) => x === wall.x && y === wall.y)).toBe(true);
    expect(world.getRegionalStats().cachedEnvironmentPrograms).toBeGreaterThan(0);
    expect(world.getRegionalStats().cachedEnvironmentProgramSurfaceCells).toBeGreaterThan(0);
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

  it('keeps deep parcel pixels and connectors exact across source block boundaries', () => {
    const small = makeWorld(16);
    const large = makeWorld(48);
    const contacts = small.getRouteContactPlacementsInBounds(-24, -24, 224, 24);
    const components = small.getParcelComponentPlacementsInBounds(-40, -40, 240, 40);
    const connectors = small.getParcelConnectorCellsInBounds(-40, -40, 240, 40);
    const coordinateKeys = new Set<string>();
    for (const component of components) {
      for (let offsetY = -4; offsetY <= 2; offsetY++) {
        for (let offsetX = -3; offsetX <= 3; offsetX++) {
          coordinateKeys.add(`${component.anchorX + offsetX},${component.anchorY + offsetY}`);
        }
      }
    }
    expect(contacts.length).toBeGreaterThan(0);
    for (const connector of connectors) coordinateKeys.add(`${connector.x},${connector.y}`);
    const coordinates = [...coordinateKeys].map((key) => {
      const [x, y] = key.split(',').map(Number);
      return [x!, y!] as const;
    });
    for (const [x, y] of [...coordinates].reverse()) {
      large.getBuildingTileAt(x, y);
      large.isBuildingAt(x, y);
      large.getTile(x, y);
    }
    for (const [x, y] of coordinates) {
      expect(Boolean(small.getBuildingTileAt(x, y))).toBe(Boolean(large.getBuildingTileAt(x, y)));
      expect(small.isBuildingAt(x, y)).toBe(large.isBuildingAt(x, y));
      expect(small.getTile(x, y).id.startsWith('regional-path-access:'))
        .toBe(large.getTile(x, y).id.startsWith('regional-path-access:'));
    }
  }, 20_000);

  it('bounds derived landmark blocks', () => {
    const world = makeWorld(16, 9);
    for (let x = -320; x <= 320; x += 32) world.getBuildingTileAt(x, 0);
    expect(world.getRegionalStats().cachedBlocks).toBeLessThanOrEqual(9);
  });

  it('separates base source blocks from the bounded parcel spatial layer', () => {
    const world = makeWorld(32);
    world.getBuildingTileAt(12, 12);
    expect(world.getRegionalStats()).toMatchObject({
      cachedParcelLayerBlocks: 1,
    });
    expect(world.getRegionalStats().cachedBlocks).toBeLessThanOrEqual(4);
    expect(world.getRegionalStats().cachedParcelGroups).toBeGreaterThan(0);
    world.destroy();
    expect(world.getRegionalStats()).toMatchObject({
      cachedBlocks: 0,
      cachedParcelGroups: 0,
      cachedParcelLayerBlocks: 0,
    });
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

  it('shares one immutable packed viewport facade across session providers', () => {
    const packed: RegionalPackedPreparedViewport = {
      version: 2,
      worldSeed: '42',
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      resolution: 1,
      terrainRgba: new Uint8Array([10, 20, 30, 255]),
      terrainMaterial: new Uint8Array([2]),
      terrainWalkable: new Uint8Array([1]),
      overlayCoordinates: new Int32Array([0, 0]),
      overlayRgba: new Uint8Array([40, 50, 60, 128]),
      solid: new Uint8Array([0]),
    };
    const first = makeWorld(32, 32);
    const second = makeWorld(32, 32);
    first.importPreparedViewport(packed);
    second.importPreparedViewport(packed);

    expect(first.getTileAtResolution(0, 0, 1)).toBe(second.getTileAtResolution(0, 0, 1));
    expect(first.getBuildingTileAt(0, 0)).toBe(second.getBuildingTileAt(0, 0));
    expect(first.getRegionalStats().preparedTerrainTiles).toBe(1);
    expect(second.getRegionalStats().preparedTerrainTiles).toBe(1);
  });

  it('uses the nearest prepared semantic LOD during animated zoom', () => {
    const source = makeWorld(32, 32);
    const prepared = source.prepareViewport(-4, -3, 4, 3, 4);
    const target = makeWorld(32, 32);
    target.importPreparedViewport(structuredClone(prepared));

    const intermediate = target.getTileAtResolution(0, 0, 5);
    expect(intermediate).toEqual(source.getTileAtResolution(0, 0, 4));
    expect(intermediate.pixels).toHaveLength(4);
    expect(target.getRegionalStats()).toMatchObject({
      cachedBlocks: 0,
      preparedViewports: 1,
    });
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
