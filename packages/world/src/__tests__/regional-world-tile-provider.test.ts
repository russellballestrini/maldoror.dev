import type { BuildingSprite, RGB, Tile, WorldLifeState } from '@maldoror/protocol';
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
import {
  rasterizeRegionalLandmarkFabricLayout,
  sampleRegionalLandmarkFabricLayout,
} from '../tiles/regional-landmark-fabric-layout.js';
import {
  rasterizeRegionalParcelPath,
  type RegionalParcelPath,
} from '../tiles/regional-parcel-path.js';
import {
  RegionalWorldDerivedCache,
  RegionalWorldTileProvider,
  type RegionalAmbientCompositionProfile,
  type RegionalAmbientDistributionProfile,
  type RegionalAmbientPlaceAccessProfile,
  type RegionalAmbientPlaceFabricProfile,
  type RegionalAmbientAsset,
  type RegionalCivicDetailAsset,
  type RegionalEnvironmentContactAsset,
  type RegionalLandmarkAsset,
  type RegionalParcelComponentAsset,
  type RegionalPackedPreparedViewport,
  type RegionalQuayDetailAsset,
  type RegionalRouteContactAsset,
} from '../tiles/regional-world-tile-provider.js';
import {
  regionalStreetPairCandidateConflictsWithProtectedReservation,
  regionalStreetPairOwnershipCell,
} from '../tiles/regional-street-pair-admission.js';

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

const QUAY_DETAILS: readonly RegionalQuayDetailAsset[] = [
  {
    id: 'quay-detail:water:horizontal',
    families: ['canal-town'],
    role: 'quay-detail',
    surface: 'water',
    waterwayAxis: 'east-west',
    bankDistance: [-1.25, -0.1],
    progressRange: [0.05, 0.95],
    minimumFamilyWeight: 0.7,
    minimumSpacing: 5,
    maximumPerLandmark: 1,
    placementPriority: 1,
    activity: {
      tangentDriftTiles: 1,
      cycleMinutes: 120,
      phaseOffset: 0,
    },
    sprite: sprite({ r: 52, g: 90, b: 138 }),
    collision: [[-1, 0], [0, 0], [1, 0]],
  },
  {
    id: 'quay-detail:quay:horizontal',
    families: ['canal-town'],
    role: 'quay-detail',
    surface: 'quay',
    waterwayAxis: 'east-west',
    bankDistance: [0.2, 1.45],
    progressRange: [0.05, 0.95],
    minimumFamilyWeight: 0.7,
    minimumSpacing: 5,
    maximumPerLandmark: 1,
    placementPriority: 0.9,
    sprite: sprite({ r: 230, g: 180, b: 90 }),
    collision: [[0, 0]],
  },
];

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

function worldLifeAt(worldMinute: number): WorldLifeState {
  return {
    worldId: 'quay-activity-proof',
    worldSeed: '42',
    worldMinute,
    weather: 'clear',
    weatherIntensity: 0.1,
    weatherUntilWorldMinute: worldMinute + 120,
    season: 'spring',
    rngState: 7,
    surfaceWetness: 0.1,
    waterTurbulence: 0.1,
    vegetationVitality: 0.8,
    decayPressure: 0.1,
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
  includeCivicDetails = false,
  includeQuayDetails = false,
  quayAxis: 'east-west' | 'north-south' = 'east-west',
  additionalParcelComponents: readonly RegionalParcelComponentAsset[] = [],
  additionalLandmarkSites: readonly RegionalLandmarkSite[] = [],
  ambientDistributionProfile: RegionalAmbientDistributionProfile = 'uniform-blue-noise',
  ambientCompositionProfile: RegionalAmbientCompositionProfile = 'single',
  ambientPlaceFabricProfile: RegionalAmbientPlaceFabricProfile = 'terrain-only',
  ambientPlaceAccessProfile: RegionalAmbientPlaceAccessProfile = 'isolated',
  includeLandmarkSites = true,
): RegionalWorldTileProvider {
  const quayDescriptor = {
    id: 'test-canal',
    materialFamily: 'canal-town' as const,
    bounds: quayAxis === 'east-west'
      ? { minX: -20, minY: 0, maxX: 20, maxY: 15 }
      : { minX: 5, minY: -20, maxX: 15, maxY: 20 },
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
      if (!includeQuay || id !== quayDescriptor.id || x < quayDescriptor.bounds.minX ||
          x > quayDescriptor.bounds.maxX || y < quayDescriptor.bounds.minY ||
          y > quayDescriptor.bounds.maxY) {
        return null;
      }
      if (quayAxis === 'north-south') {
        const bankSide: -1 | 1 = x < 10 ? 1 : -1;
        return {
          id,
          progress: (y + 20) / 40,
          centreX: 10,
          centreY: y,
          tangentX: 0,
          tangentY: 1,
          bankNormalX: -bankSide,
          bankNormalY: 0,
          bankSide,
          halfWidth: 1.25,
          signedDistance: Math.abs(x - 10) - 1.25,
        };
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
    getWalkableRouteCandidates: (
      worldX: number,
      worldY: number,
      radius: number,
      limit = 128,
    ) => {
      if (Math.abs(worldY) > radius) return [];
      const minimumX = Math.ceil(worldX - Math.sqrt(radius * radius - worldY * worldY));
      const maximumX = Math.floor(worldX + Math.sqrt(radius * radius - worldY * worldY));
      return Array.from({ length: Math.max(0, maximumX - minimumX + 1) }, (_, index) => {
        const x = minimumX + index;
        return {
          x,
          y: 0,
          distance: Math.hypot(x - worldX, worldY),
          centrelineDistance: 0,
          routeKind: 'local-road' as const,
          routeId: 'test-route',
          directionX: 1,
          directionY: 0,
          isWater: false,
        };
      }).sort((a, b) => a.distance - b.distance || a.x - b.x).slice(0, limit);
    },
    getLandmarkSites: (minX: number, minY: number, maxX: number, maxY: number): RegionalLandmarkSite[] =>
      [...(includeLandmarkSites ? SITES : []).filter(
        ([x]) => x >= minX && x <= maxX && 0 >= minY && 0 <= maxY,
      )
        .map(([x, _family, landmarkKind]) => ({
          id: `site:${x}`,
          x,
          y: 0,
          priority: 0.5,
          landmarkKind,
        })), ...additionalLandmarkSites.filter((site) => (
        site.x >= minX && site.x <= maxX && site.y >= minY && site.y <= maxY
      ))],
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
  const civicDetails: RegionalCivicDetailAsset[] = Array.from({ length: 4 }, (_, variant) => ({
    id: `civic-detail:${variant}`,
    families: ['canal-town'] as const,
    role: 'civic-detail' as const,
    routeDistance: [2, 8] as const,
    landmarkDistance: [2.5, 14] as const,
    minimumFamilyWeight: 0.5,
    sprite: sprite({ r: 232, g: 184, b: 92 + variant * 8 }),
    collision: [[0, 0]] as const,
    emitsLight: variant === 3,
  }));
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
    Array.from({ length: family === 'canal-town' ? 9 : 6 }, (_, variant) => ({
      id: `parcel:${family}:${variant}`,
      families: [family],
      role: 'mass' as const,
      visualGroup: ambientPlaceAccessProfile === 'route-frontage' &&
          family === 'canal-town' && variant >= 4 && variant <= 6
        ? `focal:${family}:${variant === 4 ? 'horizontal' : 'vertical'}`
        : undefined,
      compositionRole: family === 'canal-town' && variant >= 4 && variant <= 6
        ? 'focal' as const
        : undefined,
      frontageAxis: family === 'canal-town' && variant < 2
        ? 'east-west' as const
        : family === 'canal-town' && variant >= 4 && variant <= 6
          ? variant === 4 ? 'east-west' as const : 'north-south' as const
          : undefined,
      compositionSide: family === 'canal-town' && variant >= 4 && variant <= 6
        ? variant === 4 || variant === 6 ? -1 as const : 1 as const
        : undefined,
      frontageStations: family === 'canal-town' && variant >= 4 && variant <= 6
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
    civicDetails: includeCivicDetails ? civicDetails : [],
    quayDetails: includeQuayDetails ? QUAY_DETAILS : [],
    routeContacts,
    parcelComponents: [...parcelComponents, ...additionalParcelComponents],
    environmentContacts,
    blockSize,
    maxCachedBlocks,
    ambientCellSize: 4,
    ambientDensity: 1,
    ambientDistributionProfile,
    ambientCompositionProfile,
    ambientPlaceFabricProfile,
    ambientPlaceAccessProfile,
    ambientLandmarkClearance: 4,
    civicDetailCellSize: 1,
    civicDetailDensity: 1,
    quayDetailDensity: 1,
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
    expect(world.getRegionalStats().parcelComponentAssets).toBe(BIOME_FAMILIES.length * 6 + 3);
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
    let visibleWalkableOverhangs = 0;
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
        const contributors = horizontal.getRegionalOverlayContributorsAt(cell.x, cell.y);
        expect(contributors.filter((contributor) => contributor.materialized).every((contributor) => (
          !contributor.collisionAtCell && contributor.suppression === null
        ))).toBe(true);
        if (contributors.some((contributor) => contributor.materialized)) {
          visibleWalkableOverhangs++;
          expect(horizontal.getBuildingTileAt(cell.x, cell.y)).not.toBeNull();
        }
        expect(horizontal.getTile(cell.x, cell.y).id).toContain('regional-path-access:');
      }
    }
    expect(visibleWalkableOverhangs).toBeGreaterThan(0);
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

  it('keeps non-colliding sprite overhangs available to protected connectors', () => {
    const world = makeWorld();
    const inspect = world as unknown as {
      rasterizePlacements(placements: readonly unknown[]): {
        overlays: Map<string, unknown>;
        connectorSafeOverlays: Map<string, unknown>;
        solid: Set<string>;
      };
    };
    const asset: RegionalParcelComponentAsset = {
      id: 'parcel:test:walkable-overhang',
      families: ['canal-town'],
      role: 'mass',
      sprite: sprite(COLOURS['canal-town']),
      collision: [[0, 0]],
    };
    const rasterized = inspect.rasterizePlacements([{
      asset,
      anchorX: 12,
      anchorY: -4,
      siteX: 12,
      siteY: -4,
      kind: 'parcel-component',
    }]);

    expect(rasterized.overlays.size).toBe(6);
    expect(rasterized.connectorSafeOverlays.size).toBe(5);
    expect(rasterized.solid).toEqual(new Set(['12,-4']));
    expect(rasterized.connectorSafeOverlays.has('12,-4')).toBe(false);
    expect(rasterized.connectorSafeOverlays.has('12,-5')).toBe(true);
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

  it('keeps every ambient distribution profile coordinate-stable across block sizes', () => {
    const profiles: readonly RegionalAmbientDistributionProfile[] = [
      'uniform-blue-noise',
      'density-field-blue-noise',
      'legacy-cluster-field-blue-noise',
      'cluster-field-blue-noise',
    ];
    const noRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      distance: 24,
      signedDistance: 24,
      isRoute: false,
      isWalkableRoute: false,
      routeKind: null,
      routeId: null,
      landmarkKind: null,
      landmarkDistance: Number.POSITIVE_INFINITY,
    });
    const mountain = () => biomeSample('mountain');
    const bounds = [-256, 128, 256, 640] as const;

    for (const profile of profiles) {
      const first = makeWorld(
        32, 32, noRoute, mountain, false, undefined, false, false, false,
        'east-west', [], [], profile,
      );
      const second = makeWorld(
        47, 32, noRoute, mountain, false, undefined, false, false, false,
        'east-west', [], [], profile,
      );
      const placements = first.getAmbientPlacementsInBounds(...bounds);
      const replay = second.getAmbientPlacementsInBounds(...bounds);
      expect(placements.length).toBeGreaterThan(20);
      expect(replay).toEqual(placements);
      expect(first.getRegionalStats().ambientDistributionProfile).toBe(profile);
      expect(new Set(placements.map((placement) => (
        `${placement.anchorX},${placement.anchorY}`
      ))).size).toBe(placements.length);
      if (profile === 'cluster-field-blue-noise') {
        const windowSize = 32;
        const windowsWide = Math.ceil((bounds[2] - bounds[0]) / windowSize);
        const windowsHigh = Math.ceil((bounds[3] - bounds[1]) / windowSize);
        const counts = new Array(windowsWide * windowsHigh).fill(0) as number[];
        for (const placement of placements) {
          const windowX = Math.min(
            windowsWide - 1,
            Math.floor((placement.anchorX - bounds[0]) / windowSize),
          );
          const windowY = Math.min(
            windowsHigh - 1,
            Math.floor((placement.anchorY - bounds[1]) / windowSize),
          );
          const windowIndex = windowY * windowsWide + windowX;
          counts[windowIndex] = (counts[windowIndex] ?? 0) + 1;
        }
        const average = counts.reduce((sum, count) => sum + count, 0) / counts.length;
        const deviation = Math.sqrt(counts.reduce(
          (sum, count) => sum + (count - average) ** 2,
          0,
        ) / counts.length);
        expect(counts.filter((count) => count === 0).length / counts.length)
          .toBeGreaterThan(0.25);
        expect(deviation / average).toBeGreaterThan(0.85);
      }
    }
  });

  it('keeps landmark-owned local compositions intact across the macro prominence profile', () => {
    const uniform = makeWorld(
      32, 32, routeSample, undefined, false, undefined, false, false, false,
      'east-west', [], [], 'uniform-blue-noise',
    );
    const hierarchical = makeWorld(
      32, 32, routeSample, undefined, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise',
    );
    const entourageAtOrigin = (world: RegionalWorldTileProvider) => world
      .getAmbientPlacementsInBounds(-24, -24, 24, 24)
      .filter((placement) => placement.siteX === 0 && placement.siteY === 0 &&
        (placement.anchorX !== 0 || placement.anchorY !== 0));

    expect(entourageAtOrigin(hierarchical)).toEqual(entourageAtOrigin(uniform));
    expect(entourageAtOrigin(hierarchical).length).toBeGreaterThan(1);
  });

  it('promotes sparse prominence parents into bounded deterministic place ensembles', () => {
    const noRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      distance: 24,
      signedDistance: 24,
      isRoute: false,
      isWalkableRoute: false,
      routeKind: null,
      routeId: null,
      landmarkKind: null,
      landmarkDistance: Number.POSITIVE_INFINITY,
    });
    const mountain = () => biomeSample('mountain');
    const single = makeWorld(
      32, 64, noRoute, mountain, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'single',
    );
    const ensemble = makeWorld(
      32, 64, noRoute, mountain, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'bounded-ensemble',
    );
    const replay = makeWorld(
      47, 64, noRoute, mountain, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'bounded-ensemble',
    );
    const bounds = [-256, 128, 256, 640] as const;
    const baseline = single.getAmbientPlacementsInBounds(...bounds);
    const selected = ensemble.getAmbientPlacementsInBounds(...bounds);
    const selectedReplay = replay.getAmbientPlacementsInBounds(...bounds);
    const groups = selected.reduce((result, placement) => {
      const key = `${placement.siteX},${placement.siteY}`;
      const group = result.get(key) ?? [];
      group.push(placement);
      result.set(key, group);
      return result;
    }, new Map<string, typeof selected>());
    const promoted = [...groups.values()].filter((placements) => placements.length > 1);

    expect(selected).toEqual(selectedReplay);
    expect(selected.length).toBeGreaterThan(baseline.length);
    expect(promoted.length).toBeGreaterThan(8);
    expect(Math.max(...promoted.map((placements) => placements.length))).toBeLessThanOrEqual(6);
    expect(promoted.every((placements) => placements.every((placement) => (
      placement.families.includes('mountain') &&
      Math.hypot(
        placement.anchorX - placement.siteX,
        placement.anchorY - placement.siteY,
      ) <= 10
    )))).toBe(true);
    expect(ensemble.getRegionalStats()).toMatchObject({
      ambientCompositionProfile: 'bounded-ensemble',
    });
    expect(ensemble.getRegionalStats().cachedAmbientEnsembleCells).toBeGreaterThan(0);
  });

  it('builds coordinate-stable hierarchical place programs without exact anchor collisions', () => {
    const noRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      distance: 24,
      signedDistance: 24,
      isRoute: false,
      isWalkableRoute: false,
      routeKind: null,
      routeId: null,
      landmarkKind: null,
      landmarkDistance: Number.POSITIVE_INFINITY,
    });
    const placeBiome = () => biomeSample('canal-town');
    const first = makeWorld(
      32, 64, noRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'hierarchical-place-field', 'internal-spine',
    );
    const replay = makeWorld(
      47, 64, noRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'hierarchical-place-field', 'internal-spine',
    );
    const terrainOnly = makeWorld(
      39, 64, noRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'hierarchical-place-field', 'terrain-only',
    );
    const bounds = [-96, 96, 128, 320] as const;
    const placements = first.getAmbientPlacementsInBounds(...bounds);
    const replayPlacements = replay.getAmbientPlacementsInBounds(...bounds);
    const anchorKeys = placements.map((placement) => `${placement.anchorX},${placement.anchorY}`);
    const groups = placements.reduce((result, placement) => {
      const key = `${placement.siteX},${placement.siteY}`;
      const group = result.get(key) ?? [];
      group.push(placement);
      result.set(key, group);
      return result;
    }, new Map<string, typeof placements>());
    const programs = [...groups.values()].filter((group) => group.length > 1);

    expect(placements).toEqual(replayPlacements);
    expect(terrainOnly.getAmbientPlacementsInBounds(...bounds)).toEqual(placements);
    expect(new Set(anchorKeys).size).toBe(anchorKeys.length);
    expect(programs.length).toBeGreaterThan(4);
    expect(programs.every((group) => group.every((placement) => (
      placement.families.includes('canal-town') &&
      Math.hypot(
        placement.anchorX - placement.siteX,
        placement.anchorY - placement.siteY,
      ) <= 22
    )))).toBe(true);
    expect(first.getRegionalStats()).toMatchObject({
      ambientCompositionProfile: 'hierarchical-place-field',
    });
    const fabrics = first.getLandmarkFabricLayoutsInBounds(...bounds)
      .filter((layout) => layout.id.startsWith('place-fabric:'));
    expect(fabrics.length).toBeGreaterThan(0);
    expect(fabrics.every((layout) => (
      layout.connectionMode === 'internal-spine' &&
      layout.aprons.filter((apron) => apron.role === 'spine').length === 1
    ))).toBe(true);
    expect(terrainOnly.getLandmarkFabricLayoutsInBounds(...bounds)
      .filter((layout) => layout.id.startsWith('place-fabric:'))).toEqual([]);
    expect(terrainOnly.getRegionalStats()).toMatchObject({
      ambientCompositionProfile: 'hierarchical-place-field',
      ambientPlaceFabricProfile: 'terrain-only',
      cachedAmbientPlaceFabrics: 0,
    });
  });

  it('connects hierarchical focal entrances to routes with reserved frontage', () => {
    const continuousRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      directionX: 1,
      directionY: 0,
    });
    const placeBiome = () => biomeSample('canal-town');
    const first = makeWorld(
      32, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'hierarchical-place-field',
      'terrain-only', 'route-frontage',
    );
    const replay = makeWorld(
      47, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [], [], 'cluster-field-blue-noise', 'hierarchical-place-field',
      'terrain-only', 'route-frontage',
    );
    const bounds = [-96, -96, 128, 128] as const;
    const connectors = first.getParcelConnectorCellsInBounds(...bounds)
      .filter((cell) => cell.parcelId.startsWith('place:'));
    const replayConnectors = replay.getParcelConnectorCellsInBounds(...bounds)
      .filter((cell) => cell.parcelId.startsWith('place:'));
    const frontage = first.getAmbientPlacementsInBounds(...bounds)
      .filter((placement) => placement.parcelPathId?.startsWith('place-access:'));

    expect(connectors.length).toBeGreaterThan(16);
    expect(connectors).toEqual(replayConnectors);
    expect(frontage.length).toBeGreaterThan(2);
    expect(new Set(frontage.map((placement) => (
      `${placement.anchorX},${placement.anchorY}`
    ))).size).toBe(frontage.length);
    expect(connectors.some((cell) => cell.y === 0)).toBe(true);
    const inspectProgram = first as unknown as {
      getAmbientPlaceProgram(cellX: number, cellY: number): {
        placements: readonly { asset: RegionalParcelComponentAsset }[];
      } | null;
    };
    for (let cellY = -2; cellY <= 2; cellY++) {
      for (let cellX = -2; cellX <= 2; cellX++) {
        const focalGroups = (inspectProgram.getAmbientPlaceProgram(cellX, cellY)?.placements ?? [])
          .filter((placement) => placement.asset.compositionRole === 'focal')
          .map((placement) => placement.asset.visualGroup ?? placement.asset.id);
        expect(new Set(focalGroups).size).toBe(focalGroups.length);
      }
    }
    expect(first.getRegionalStats()).toMatchObject({
      ambientPlaceAccessProfile: 'route-frontage',
    });
    expect(first.getRegionalStats().cachedAmbientPlaceConnectorCells).toBeGreaterThan(0);
  });

  it('reserves two opposite focal parents and a walkable shared common before frontage', () => {
    const continuousRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      directionX: 1,
      directionY: 0,
    });
    const placeBiome = () => biomeSample('canal-town');
    const oppositeFrontage: RegionalParcelComponentAsset = {
      id: 'parcel:canal-town:shared-common-opposite',
      families: ['canal-town'],
      role: 'mass',
      visualGroup: 'focal:canal-town:shared-common-opposite',
      compositionRole: 'focal',
      frontageAxis: 'east-west',
      compositionSide: 1,
      frontageStations: [0],
      sprite: sprite(COLOURS['canal-town']),
      collision: [[0, 0]],
    };
    const first = makeWorld(
      32, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [oppositeFrontage], [], 'cluster-field-blue-noise',
      'hierarchical-place-field', 'shared-common', 'route-frontage', false,
    );
    const replay = makeWorld(
      47, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', [oppositeFrontage], [], 'cluster-field-blue-noise',
      'hierarchical-place-field', 'shared-common', 'route-frontage', false,
    );
    const bounds = [-96, -96, 128, 128] as const;
    const parents = first.getAmbientPlacementsInBounds(...bounds).filter((placement) => (
      placement.parcelPathId?.endsWith(':common')
    ));
    const allPlacements = first.getAmbientPlacementsInBounds(...bounds);
    const replayParents = replay.getAmbientPlacementsInBounds(...bounds).filter((placement) => (
      placement.parcelPathId?.endsWith(':common')
    ));
    const layouts = first.getLandmarkFabricLayoutsInBounds(...bounds).filter((layout) => (
      layout.connectionMode === 'shared-common'
    ));
    expect(parents).toEqual(replayParents);
    expect(new Set(allPlacements.map((placement) => (
      `${placement.assetId}@${placement.anchorX},${placement.anchorY}`
    ))).size).toBe(allPlacements.length);
    const inspectPrograms = first as unknown as {
      getAmbientPlaceProgram(cellX: number, cellY: number): {
        placements: readonly {
          asset: { id: string };
          anchorX: number;
          anchorY: number;
        }[];
        publicFocalKeys?: readonly string[];
        accessPath?: RegionalParcelPath;
        fabric?: { layout: { id: string } };
      } | null;
    };
    const publicPrograms: Array<NonNullable<ReturnType<
      typeof inspectPrograms.getAmbientPlaceProgram
    >>> = [];
    for (let cellY = -8; cellY <= 8; cellY++) {
      for (let cellX = -8; cellX <= 8; cellX++) {
        const program = inspectPrograms.getAmbientPlaceProgram(cellX, cellY);
        if (program?.publicFocalKeys) publicPrograms.push(program);
      }
    }
    expect(publicPrograms.length).toBeGreaterThan(0);
    expect(publicPrograms.every((program) => (
      program.publicFocalKeys?.length === 2 && program.publicFocalKeys.every((identity) => (
        program.placements.some((placement) => (
          `${placement.asset.id}@${placement.anchorX},${placement.anchorY}` === identity
        ))
      ))
    ))).toBe(true);
    expect(layouts.length).toBeGreaterThan(0);
    const physicallyDisconnectedLayouts = layouts.filter((layout) => {
      const program = publicPrograms.find((candidate) => candidate.fabric?.layout.id === layout.id);
      if (!program?.accessPath) return true;
      const access = rasterizeRegionalParcelPath(program.accessPath);
      return !access.some((cell) => cell.core) || access.filter((cell) => cell.protected)
        .some((cell) => first.isBuildingAt(cell.x, cell.y) || !first.getTile(cell.x, cell.y).walkable);
    });
    expect(physicallyDisconnectedLayouts, JSON.stringify({
      layouts: layouts.map((layout) => layout.id),
      programs: publicPrograms.map((program) => ({
        layout: program.fabric?.layout.id,
        accessPath: program.accessPath?.id,
      })),
    })).toEqual([]);
    const admittedLayoutIds = new Set(layouts.map((layout) => layout.id));
    const collisionConflicts = publicPrograms.filter((program) => (
      program.fabric && admittedLayoutIds.has(program.fabric.layout.id)
    )).flatMap((program) => {
      if (!program.accessPath) return [];
      const protectedCells = rasterizeRegionalParcelPath(program.accessPath)
        .filter((cell) => cell.protected);
      const minX = Math.min(...protectedCells.map((cell) => cell.x));
      const minY = Math.min(...protectedCells.map((cell) => cell.y));
      const maxX = Math.max(...protectedCells.map((cell) => cell.x));
      const maxY = Math.max(...protectedCells.map((cell) => cell.y));
      const provenance = first.getRegionalOverlayContributorsInBounds(minX, minY, maxX, maxY);
      const firstCell = protectedCells[0]!;
      expect(provenance.get(`${firstCell.x},${firstCell.y}`) ?? []).toEqual(
        first.getRegionalOverlayContributorsAt(firstCell.x, firstCell.y),
      );
      return protectedCells.flatMap((cell) => (
        [...(provenance.get(`${cell.x},${cell.y}`) ?? [])]
          .filter((contributor) => contributor.collisionAtCell)
          .map((contributor) => ({
            pathId: program.accessPath!.id,
            cell: [cell.x, cell.y],
            contributor,
          }))
      ));
    });
    expect(collisionConflicts).toEqual([]);
    expect(layouts.every((layout) => {
      const commons = layout.aprons.filter((apron) => apron.role === 'common');
      const common = commons[0];
      if (!common || commons.length !== 1 ||
          layout.aprons.filter((apron) => apron.role === 'spine').length !== 1 ||
          layout.aprons.filter((apron) => apron.role === 'approach').length < 2) return false;
      const northSouth = common.axis === 'north-south';
      const publicCore = [
        [common.centreX, common.centreY],
        [
          common.centreX + (northSouth ? 0 : common.halfAlong * 0.45),
          common.centreY + (northSouth ? common.halfAlong * 0.45 : 0),
        ],
        [
          common.centreX - (northSouth ? 0 : common.halfAlong * 0.45),
          common.centreY - (northSouth ? common.halfAlong * 0.45 : 0),
        ],
        [
          common.centreX + (northSouth ? common.halfAcross * 0.45 : 0),
          common.centreY + (northSouth ? 0 : common.halfAcross * 0.45),
        ],
        [
          common.centreX - (northSouth ? common.halfAcross * 0.45 : 0),
          common.centreY - (northSouth ? 0 : common.halfAcross * 0.45),
        ],
      ] as const;
      return publicCore.every(([x, y]) => (
        sampleRegionalLandmarkFabricLayout(x, y, layout).pavingWeight > 0.9 &&
        first.getTile(Math.floor(x), Math.floor(y)).walkable
      ));
    })).toBe(true);
    expect(first.getRegionalStats()).toMatchObject({
      ambientPlaceFabricProfile: 'shared-common',
    });
  });

  it('adds optional street overlays after freezing meso program admission', () => {
    const continuousRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      directionX: 1,
      directionY: 0,
    });
    const placeBiome = () => biomeSample('canal-town');
    const focal = (
      id: string,
      side: -1 | 1,
    ): RegionalParcelComponentAsset => ({
      id,
      families: ['canal-town'],
      role: 'mass',
      visualGroup: `focal:${id}`,
      compositionRole: 'focal',
      frontageAxis: 'east-west',
      compositionSide: side,
      frontageStations: [0],
      sprite: sprite(COLOURS['canal-town']),
      collision: [[0, 0]],
    });
    const extraFocals = [
      focal('parcel:canal-town:street-negative-a', -1),
      focal('parcel:canal-town:street-negative-b', -1),
      focal('parcel:canal-town:street-positive-a', 1),
      focal('parcel:canal-town:street-positive-b', 1),
    ];
    const control = makeWorld(
      32, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', extraFocals, [], 'cluster-field-blue-noise',
      'hierarchical-place-field', 'shared-common', 'route-frontage', false,
    );
    const first = makeWorld(
      32, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', extraFocals, [], 'cluster-field-blue-noise',
      'hierarchical-place-field', 'shared-common-street-overlay', 'route-frontage', false,
    );
    const replay = makeWorld(
      47, 64, continuousRoute, placeBiome, false, undefined, false, false, false,
      'east-west', extraFocals, [], 'cluster-field-blue-noise',
      'hierarchical-place-field', 'shared-common-street-overlay', 'route-frontage', false,
    );
    type InspectedProgram = {
      root: { asset: { id: string }; siteX: number; siteY: number };
      placements: readonly { asset: { id: string }; anchorX: number; anchorY: number }[];
      publicFocalKeys?: readonly string[];
      fabric?: { layout: { id: string } };
    };
    const admittedPrograms = (world: RegionalWorldTileProvider) => {
      const inspect = world as unknown as {
        buildAmbientPlacements(originX: number, originY: number): {
          placePrograms: readonly InspectedProgram[];
        };
      };
      const programs = new Map<string, unknown>();
      for (const originY of [-64, -32, 0, 32, 64]) {
        for (const originX of [-64, -32, 0, 32, 64]) {
          for (const program of inspect.buildAmbientPlacements(originX, originY).placePrograms) {
            const key = `${program.root.siteX},${program.root.siteY}`;
            programs.set(key, {
              root: `${program.root.asset.id}@${key}`,
              placements: program.placements.map((placement) => (
                `${placement.asset.id}@${placement.anchorX},${placement.anchorY}`
              )),
              publicFocalKeys: program.publicFocalKeys,
              fabric: program.fabric?.layout.id,
            });
          }
        }
      }
      return [...programs.entries()].sort(([a], [b]) => a.localeCompare(b));
    };
    expect(admittedPrograms(first)).toEqual(admittedPrograms(control));

    const bounds = [-96, -72, 128, 72] as const;
    const placements = first.getAmbientPlacementsInBounds(...bounds);
    expect(placements).toEqual(replay.getAmbientPlacementsInBounds(...bounds));
    expect(placements.filter((placement) => placement.parcelPathId === undefined)).toEqual(
      control.getAmbientPlacementsInBounds(...bounds).filter((placement) => (
        placement.parcelPathId === undefined
      )),
    );
    const streetBySite = new Map<string, typeof placements>();
    for (const placement of placements.filter((candidate) => (
      candidate.parcelPathId?.endsWith(':street-overlay')
    ))) {
      const key = `${placement.siteX},${placement.siteY}`;
      streetBySite.set(key, [...(streetBySite.get(key) ?? []), placement]);
    }
    expect(streetBySite.size).toBeGreaterThan(0);
    expect([...streetBySite.values()].every((street) => (
      street.length === 2 &&
      new Set(street.map((placement) => placement.assetId)).size === 2 &&
      new Set(street.map((placement) => Math.sign(placement.anchorY))).size === 2 &&
      street.every((placement) => (
        placement.pathTangentX === 1 && placement.pathTangentY === 0
      ))
    )), JSON.stringify([...streetBySite.entries()].map(([site, street]) => ({
      site,
      street: street.map((placement) => ({
        assetId: placement.assetId,
        anchor: [placement.anchorX, placement.anchorY],
        tangent: [placement.pathTangentX, placement.pathTangentY],
      })),
    })))).toBe(true);

    type InspectedStreetPairCandidate = {
      id: string;
      ownerSiteX: number;
      ownerSiteY: number;
      ownershipX: number;
      ownershipY: number;
      axis: 'north-south' | 'east-west';
      kind: 'strict' | 'replacement';
      priority: number;
      reservedCells: readonly string[];
      visualGroups: readonly string[];
      placements: readonly {
        asset: { id: string };
        anchorX: number;
        anchorY: number;
      }[];
    };
    type InspectedStreetPairProtectedReservation = {
      ownershipCellX: number;
      ownershipCellY: number;
      manifestMaximumAxisReach: number;
      reservedCells: readonly string[];
      visualGroups: readonly {
        ownerSiteX: number;
        ownerSiteY: number;
        visualGroup: string;
      }[];
      sourceIds: readonly string[];
      sourceReservations: readonly {
        sourceId: string;
        kind: 'placement' | 'fabric' | 'connector' | 'civic';
        reservedCells: readonly string[];
      }[];
    };
    type InspectedStreetPairFitDiagnostics = {
      ownerSiteX: number;
      ownerSiteY: number;
      ownershipX: number;
      ownershipY: number;
      routeStartX: number;
      routeStartY: number;
      axis: 'north-south' | 'east-west';
      vocabularyKeys: readonly string[];
      excludedVisualGroups: readonly string[];
      outcome: string;
      failedSide?: -1 | 1;
      sides: readonly {
        side: -1 | 1;
        eligibleAssetIds: readonly string[];
        protectedVisualGroupAssetIds: readonly string[];
        pairVisualGroupAssetIds: readonly string[];
        terrainOrRouteRejectedAttempts: number;
        protectedReservationRejectedAttempts: number;
        protectedHaloRejectedAttempts: number;
        pairFootprintRejectedAttempts: number;
        missingEntranceAttempts: number;
        distantEntranceAttempts: number;
        protectedConflictCells: readonly string[];
        selectedAssetId?: string;
      }[];
      protectedConflictSources: readonly {
        sourceId: string;
        kind: 'placement' | 'fabric' | 'connector' | 'civic';
        conflictingCells: readonly string[];
      }[];
      residualProtectedConflictCells: readonly string[];
      residualProtectedVisualGroups: readonly {
        ownerSiteX: number;
        ownerSiteY: number;
        visualGroup: string;
      }[];
      candidateId?: string;
    };
    type StreetPairInspection = {
      getAmbientPlaceProgram(cellX: number, cellY: number): unknown;
      buildAmbientSharedStreetPairCandidate(
        program: unknown,
        reserved: ReadonlySet<string>,
        excludedVisualGroups?: ReadonlySet<string>,
      ): InspectedStreetPairCandidate | null;
      getAmbientStreetPairCandidates(
        ownershipCellX: number,
        ownershipCellY: number,
      ): readonly InspectedStreetPairCandidate[];
      cacheAmbientStreetPairCandidates(
        key: string,
        candidates: readonly InspectedStreetPairCandidate[],
      ): readonly InspectedStreetPairCandidate[];
      getAmbientStreetPairProtectedReservation(
        ownershipCellX: number,
        ownershipCellY: number,
      ): InspectedStreetPairProtectedReservation;
      cacheAmbientStreetPairProtectedReservation(
        key: string,
        reservation: InspectedStreetPairProtectedReservation,
      ): InspectedStreetPairProtectedReservation;
      getAmbientStreetPairProtectedFitCandidates(
        ownershipCellX: number,
        ownershipCellY: number,
      ): readonly InspectedStreetPairCandidate[];
      cacheAmbientStreetPairProtectedFitCandidates(
        key: string,
        candidates: readonly InspectedStreetPairCandidate[],
      ): readonly InspectedStreetPairCandidate[];
      getAmbientStreetPairProtectedFitDiagnostics(
        ownershipCellX: number,
        ownershipCellY: number,
      ): readonly InspectedStreetPairFitDiagnostics[];
      cacheAmbientStreetPairProtectedFitDiagnostics(
        key: string,
        diagnostics: readonly InspectedStreetPairFitDiagnostics[],
      ): readonly InspectedStreetPairFitDiagnostics[];
      getAmbientCanonicalStreetPairWinners(
        ownershipCellX: number,
        ownershipCellY: number,
      ): readonly InspectedStreetPairCandidate[];
      cacheAmbientCanonicalStreetPairWinners(
        key: string,
        candidates: readonly InspectedStreetPairCandidate[],
      ): readonly InspectedStreetPairCandidate[];
    };
    const inspectFirst = first as unknown as StreetPairInspection;
    const inspectReplay = replay as unknown as StreetPairInspection;
    const candidateSignature = (candidate: InspectedStreetPairCandidate) => ({
      id: candidate.id,
      owner: [candidate.ownerSiteX, candidate.ownerSiteY],
      ownership: [candidate.ownershipX, candidate.ownershipY],
      axis: candidate.axis,
      kind: candidate.kind,
      priority: candidate.priority,
      reservedCells: candidate.reservedCells,
      visualGroups: candidate.visualGroups,
      placements: candidate.placements.map((placement) => (
        `${placement.asset.id}@${placement.anchorX},${placement.anchorY}`
      )),
    });
    let intrinsicPair: InspectedStreetPairCandidate | null = null;
    let replayPair: InspectedStreetPairCandidate | null = null;
    let intrinsicProgram: unknown = null;
    for (let cellY = -4; cellY <= 4 && !intrinsicPair; cellY++) {
      for (let cellX = -4; cellX <= 4 && !intrinsicPair; cellX++) {
        const program = inspectFirst.getAmbientPlaceProgram(cellX, cellY);
        if (!program) continue;
        const candidate = inspectFirst.buildAmbientSharedStreetPairCandidate(program, new Set());
        if (!candidate) continue;
        const replayProgram = inspectReplay.getAmbientPlaceProgram(cellX, cellY);
        if (!replayProgram) continue;
        const candidateReplay = inspectReplay.buildAmbientSharedStreetPairCandidate(
          replayProgram,
          new Set(),
        );
        if (!candidateReplay) continue;
        intrinsicPair = candidate;
        replayPair = candidateReplay;
        intrinsicProgram = program;
      }
    }
    expect(intrinsicPair).not.toBeNull();
    expect(replayPair).not.toBeNull();
    expect(candidateSignature(replayPair!)).toEqual(candidateSignature(intrinsicPair!));
    expect(intrinsicPair).toMatchObject({
      kind: 'strict',
      axis: 'east-west',
    });
    expect(intrinsicPair!.priority).toBeGreaterThanOrEqual(0);
    expect(intrinsicPair!.priority).toBeLessThanOrEqual(1);
    expect(intrinsicPair!.reservedCells.length).toBeGreaterThan(0);
    expect(intrinsicPair!.visualGroups).toHaveLength(2);
    expect(new Set(intrinsicPair!.visualGroups).size).toBe(2);
    expect(intrinsicPair!.placements).toHaveLength(2);
    const semanticAlternative = inspectFirst.buildAmbientSharedStreetPairCandidate(
      intrinsicProgram,
      new Set(),
      new Set(intrinsicPair!.visualGroups),
    );
    expect(semanticAlternative).not.toBeNull();
    expect(semanticAlternative!.visualGroups.every((group) => (
      !intrinsicPair!.visualGroups.includes(group)
    ))).toBe(true);

    const ownershipCells = Array.from({ length: 5 }, (_, index) => ({
      cellX: index - 2,
      cellY: 0,
    }));
    const enumerateCandidates = (
      inspection: StreetPairInspection,
      cells: readonly { cellX: number; cellY: number }[],
    ) => {
      const candidates = new Map<string, InspectedStreetPairCandidate>();
      for (const cell of cells) {
        for (const candidate of inspection.getAmbientStreetPairCandidates(
          cell.cellX,
          cell.cellY,
        )) {
          const owner = regionalStreetPairOwnershipCell(
            candidate.ownershipX,
            candidate.ownershipY,
          );
          expect([owner.cellX, owner.cellY]).toEqual([cell.cellX, cell.cellY]);
          candidates.set(candidate.id, candidate);
        }
      }
      return [...candidates.values()].map(candidateSignature).sort((a, b) => (
        a.id === b.id ? 0 : a.id < b.id ? -1 : 1
      ));
    };
    const forwardCandidates = enumerateCandidates(inspectFirst, ownershipCells);
    const reverseCandidates = enumerateCandidates(inspectReplay, [...ownershipCells].reverse());
    expect(forwardCandidates.length).toBeGreaterThan(0);
    expect(reverseCandidates).toEqual(forwardCandidates);
    expect(enumerateCandidates(inspectFirst, [...ownershipCells].reverse()))
      .toEqual(forwardCandidates);
    const reservationSignature = (reservation: InspectedStreetPairProtectedReservation) => ({
      ownership: [reservation.ownershipCellX, reservation.ownershipCellY],
      manifestMaximumAxisReach: reservation.manifestMaximumAxisReach,
      reservedCells: reservation.reservedCells,
      visualGroups: reservation.visualGroups,
      sourceIds: reservation.sourceIds,
      sourceReservations: reservation.sourceReservations,
    });
    const enumerateReservations = (
      inspection: StreetPairInspection,
      cells: readonly { cellX: number; cellY: number }[],
    ) => cells.map((cell) => reservationSignature(
      inspection.getAmbientStreetPairProtectedReservation(cell.cellX, cell.cellY),
    )).sort((a, b) => (
      a.ownership[1]! - b.ownership[1]! || a.ownership[0]! - b.ownership[0]!
    ));
    const forwardReservations = enumerateReservations(inspectFirst, ownershipCells);
    const reverseReservations = enumerateReservations(
      inspectReplay,
      [...ownershipCells].reverse(),
    );
    expect(reverseReservations).toEqual(forwardReservations);
    expect(enumerateReservations(inspectFirst, [...ownershipCells].reverse()))
      .toEqual(forwardReservations);
    expect(forwardReservations.some((reservation) => (
      reservation.reservedCells.length > 0 && reservation.sourceIds.length > 0
    ))).toBe(true);
    expect(forwardReservations.every((reservation) => (
      reservation.manifestMaximumAxisReach > 0 &&
      [...reservation.reservedCells].sort().join('|') === reservation.reservedCells.join('|') &&
      [...reservation.sourceIds].sort().join('|') === reservation.sourceIds.join('|')
    ))).toBe(true);
    expect(forwardReservations.every((reservation) => (
      reservation.sourceReservations.every((source) => (
        reservation.sourceIds.includes(source.sourceId) &&
        source.reservedCells.length > 0 &&
        source.reservedCells.every((cell) => reservation.reservedCells.includes(cell))
      ))
    ))).toBe(true);
    const enumerateProtectedFits = (
      inspection: StreetPairInspection,
      cells: readonly { cellX: number; cellY: number }[],
    ) => {
      const candidates = new Map<string, InspectedStreetPairCandidate>();
      for (const cell of cells) {
        const reservation = inspection.getAmbientStreetPairProtectedReservation(
          cell.cellX,
          cell.cellY,
        );
        for (const candidate of inspection.getAmbientStreetPairProtectedFitCandidates(
          cell.cellX,
          cell.cellY,
        )) {
          expect(regionalStreetPairCandidateConflictsWithProtectedReservation(
            candidate,
            reservation,
          )).toBe(false);
          candidates.set(candidate.id, candidate);
        }
      }
      return [...candidates.values()].map(candidateSignature).sort((a, b) => (
        a.id === b.id ? 0 : a.id < b.id ? -1 : 1
      ));
    };
    const forwardProtectedFits = enumerateProtectedFits(inspectFirst, ownershipCells);
    const reverseProtectedFits = enumerateProtectedFits(
      inspectReplay,
      [...ownershipCells].reverse(),
    );
    expect(forwardProtectedFits.length).toBeGreaterThan(0);
    expect(reverseProtectedFits).toEqual(forwardProtectedFits);
    expect(enumerateProtectedFits(inspectFirst, [...ownershipCells].reverse()))
      .toEqual(forwardProtectedFits);
    const enumerateFitDiagnostics = (
      inspection: StreetPairInspection,
      cells: readonly { cellX: number; cellY: number }[],
    ) => cells.flatMap((cell) => inspection.getAmbientStreetPairProtectedFitDiagnostics(
      cell.cellX,
      cell.cellY,
    )).sort((a, b) => (
      a.ownerSiteY - b.ownerSiteY || a.ownerSiteX - b.ownerSiteX ||
      a.ownershipY - b.ownershipY || a.ownershipX - b.ownershipX
    ));
    const forwardFitDiagnostics = enumerateFitDiagnostics(inspectFirst, ownershipCells);
    const reverseFitDiagnostics = enumerateFitDiagnostics(
      inspectReplay,
      [...ownershipCells].reverse(),
    );
    expect(forwardFitDiagnostics.length).toBeGreaterThan(0);
    expect(reverseFitDiagnostics).toEqual(forwardFitDiagnostics);
    expect(enumerateFitDiagnostics(inspectFirst, [...ownershipCells].reverse()))
      .toEqual(forwardFitDiagnostics);
    expect(forwardFitDiagnostics.every((diagnostic) => (
      diagnostic.vocabularyKeys.length > 0 && diagnostic.sides.length > 0
    ))).toBe(true);
    expect(forwardFitDiagnostics.some((diagnostic) => (
      diagnostic.sides.some((side) => (
        side.protectedReservationRejectedAttempts > 0 &&
        side.protectedConflictCells.length > 0
      )) && diagnostic.protectedConflictSources.length > 0
    ))).toBe(true);
    expect(forwardFitDiagnostics.every((diagnostic) => (
      diagnostic.protectedConflictSources.every((source) => (
        source.conflictingCells.length > 0 && source.conflictingCells.every((cell) => (
          diagnostic.sides.some((side) => side.protectedConflictCells.includes(cell)) ||
          diagnostic.residualProtectedConflictCells.includes(cell)
        ))
      ))
    ))).toBe(true);
    expect(forwardFitDiagnostics.every((diagnostic) => (
      diagnostic.outcome !== 'residual-protected-conflict' ||
      diagnostic.residualProtectedConflictCells.length > 0 ||
      diagnostic.residualProtectedVisualGroups.length > 0
    ))).toBe(true);
    expect(forwardFitDiagnostics.every((diagnostic) => (
      diagnostic.outcome !== 'residual-protected-conflict'
    ))).toBe(true);
    expect(forwardFitDiagnostics.some((diagnostic) => (
      diagnostic.sides.some((side) => side.protectedHaloRejectedAttempts > 0)
    ))).toBe(true);
    expect(first.getRegionalStats()).toMatchObject({
      cachedAmbientStreetPairOwnershipCells: ownershipCells.length,
      cachedAmbientStreetPairCandidates: forwardCandidates.length,
      cachedAmbientStreetPairProtectedOwnershipCells: ownershipCells.length,
      cachedAmbientStreetPairProtectedFitOwnershipCells: ownershipCells.length,
      cachedAmbientStreetPairProtectedFitCandidates: forwardProtectedFits.length,
      cachedAmbientStreetPairProtectedFitDiagnosticOwnershipCells: ownershipCells.length,
      cachedAmbientStreetPairProtectedFitDiagnostics: forwardFitDiagnostics.length,
    });
    const enumerateWinners = (
      inspection: StreetPairInspection,
      cells: readonly { cellX: number; cellY: number }[],
    ) => cells.flatMap((cell) => inspection.getAmbientCanonicalStreetPairWinners(
      cell.cellX,
      cell.cellY,
    )).map(candidateSignature).sort((a, b) => (
      a.id === b.id ? 0 : a.id < b.id ? -1 : 1
    ));
    const forwardWinners = enumerateWinners(inspectFirst, ownershipCells);
    const reverseWinners = enumerateWinners(inspectReplay, [...ownershipCells].reverse());
    expect(forwardWinners.length).toBeGreaterThan(0);
    const protectedFitIds = new Set(forwardProtectedFits.map((candidate) => candidate.id));
    expect(forwardWinners.every((candidate) => protectedFitIds.has(candidate.id))).toBe(true);
    expect(reverseWinners).toEqual(forwardWinners);
    expect(enumerateWinners(inspectFirst, [...ownershipCells].reverse()))
      .toEqual(forwardWinners);
    expect(first.getRegionalStats()).toMatchObject({
      cachedAmbientStreetPairCanonicalWinnerOwnershipCells: ownershipCells.length,
      cachedAmbientStreetPairCanonicalWinners: forwardWinners.length,
    });
    const streetCandidateCacheLimit = first.getRegionalStats().maxCachedBlocks * 16;
    for (let index = 0; index < streetCandidateCacheLimit + 2; index++) {
      inspectFirst.cacheAmbientStreetPairCandidates(`test-overflow:${index}`, Object.freeze([]));
    }
    expect(first.getRegionalStats().cachedAmbientStreetPairOwnershipCells)
      .toBe(streetCandidateCacheLimit);
    const protectedReservationCacheLimit = first.getRegionalStats().maxCachedBlocks * 16;
    for (let index = 0; index < protectedReservationCacheLimit + 2; index++) {
      inspectFirst.cacheAmbientStreetPairProtectedReservation(`test-overflow:${index}`, Object.freeze({
        ownershipCellX: index,
        ownershipCellY: 0,
        manifestMaximumAxisReach: 1,
        reservedCells: Object.freeze([]),
        visualGroups: Object.freeze([]),
        sourceIds: Object.freeze([]),
        sourceReservations: Object.freeze([]),
      }));
    }
    expect(first.getRegionalStats().cachedAmbientStreetPairProtectedOwnershipCells)
      .toBe(protectedReservationCacheLimit);
    const protectedFitCacheLimit = first.getRegionalStats().maxCachedBlocks * 16;
    for (let index = 0; index < protectedFitCacheLimit + 2; index++) {
      inspectFirst.cacheAmbientStreetPairProtectedFitCandidates(
        `test-overflow:${index}`,
        Object.freeze([]),
      );
    }
    expect(first.getRegionalStats().cachedAmbientStreetPairProtectedFitOwnershipCells)
      .toBe(protectedFitCacheLimit);
    const protectedFitDiagnosticCacheLimit = first.getRegionalStats().maxCachedBlocks * 16;
    for (let index = 0; index < protectedFitDiagnosticCacheLimit + 2; index++) {
      inspectFirst.cacheAmbientStreetPairProtectedFitDiagnostics(
        `test-overflow:${index}`,
        Object.freeze([]),
      );
    }
    expect(first.getRegionalStats().cachedAmbientStreetPairProtectedFitDiagnosticOwnershipCells)
      .toBe(protectedFitDiagnosticCacheLimit);
    const canonicalWinnerCacheLimit = first.getRegionalStats().maxCachedBlocks * 16;
    for (let index = 0; index < canonicalWinnerCacheLimit + 2; index++) {
      inspectFirst.cacheAmbientCanonicalStreetPairWinners(
        `test-overflow:${index}`,
        Object.freeze([]),
      );
    }
    expect(first.getRegionalStats().cachedAmbientStreetPairCanonicalWinnerOwnershipCells)
      .toBe(canonicalWinnerCacheLimit);
    expect(first.getRegionalStats()).toMatchObject({
      ambientPlaceFabricProfile: 'shared-common-street-overlay',
      ambientPlaceAccessProfile: 'route-frontage',
    });
  });

  it('reconciles exact place compositions independently of provider block size', () => {
    const continuousRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      directionX: 1,
      directionY: 0,
    });
    const focal = (
      id: string,
      side: -1 | 1,
    ): RegionalParcelComponentAsset => ({
      id,
      families: ['canal-town'],
      role: 'mass',
      visualGroup: `focal:${id}`,
      compositionRole: 'focal',
      frontageAxis: 'east-west',
      compositionSide: side,
      frontageStations: [0],
      sprite: sprite(COLOURS['canal-town']),
      collision: [[0, 0]],
    });
    const extraFocals = [
      focal('parcel:canal-town:street-negative-a', -1),
      focal('parcel:canal-town:street-negative-b', -1),
      focal('parcel:canal-town:street-positive-a', 1),
      focal('parcel:canal-town:street-positive-b', 1),
    ];
    const makeExactWorld = (blockSize: number) => makeWorld(
      blockSize, 64, continuousRoute, () => biomeSample('canal-town'),
      false, undefined, false, false, false, 'east-west', extraFocals, [],
      'cluster-field-blue-noise', 'hierarchical-place-field',
      'shared-common-street-overlay-exact', 'route-frontage', false,
    );
    const exact = makeExactWorld(32);
    const exactReplay = makeExactWorld(47);
    const bounds = [-96, -72, 128, 72] as const;
    expect(exact.getAmbientPlacementsInBounds(...bounds)).toEqual(
      exactReplay.getAmbientPlacementsInBounds(...bounds),
    );

    type ExactPlacement = {
      asset: {
        id: string;
        visualGroup?: string;
        sprite: {
          width: number;
          height: number;
          tiles: readonly (readonly unknown[])[];
        };
        spriteAnchor?: readonly [number, number];
      };
      siteX: number;
      siteY: number;
      anchorX: number;
      anchorY: number;
    };
    const inspectExact = exact as unknown as {
      buildAmbientPlacements(originX: number, originY: number): {
        placements: readonly ExactPlacement[];
      };
    };
    const exactBySite = new Map<string, Map<string, ExactPlacement>>();
    for (const originY of [-64, -32, 0, 32, 64]) {
      for (const originX of [-64, -32, 0, 32, 64]) {
        for (const placement of inspectExact.buildAmbientPlacements(originX, originY).placements) {
          const site = `${placement.siteX},${placement.siteY}`;
          const identity = `${placement.asset.id}@${placement.anchorX},${placement.anchorY}`;
          const sitePlacements = exactBySite.get(site) ?? new Map<string, ExactPlacement>();
          sitePlacements.set(identity, placement);
          exactBySite.set(site, sitePlacements);
        }
      }
    }
    expect(exactBySite.size).toBeGreaterThan(0);
    for (const sitePlacements of exactBySite.values()) {
      const composition = [...sitePlacements.values()];
      const groups = composition.map((placement) => (
        placement.asset.visualGroup ?? `asset:${placement.asset.id}`
      ));
      expect(new Set(groups).size).toBe(groups.length);
      const visibleCells = composition.flatMap((placement) => {
        const [spriteAnchorX, spriteAnchorY] = placement.asset.spriteAnchor ?? [
          Math.floor(placement.asset.sprite.width / 2),
          placement.asset.sprite.height - 1,
        ];
        return placement.asset.sprite.tiles.flatMap((row, tileY) => (
          row.flatMap((tile, tileX) => tile ? [
            `${placement.anchorX + tileX - spriteAnchorX},` +
              `${placement.anchorY + tileY - spriteAnchorY}`,
          ] : [])
        ));
      });
      expect(new Set(visibleCells).size).toBe(visibleCells.length);
    }
    expect(exact.getRegionalStats()).toMatchObject({
      ambientPlaceFabricProfile: 'shared-common-street-overlay-exact',
    });
  });

  it('admits distinct canonical alternatives only through the exact alternative profile', () => {
    const continuousRoute = (x: number, y: number): RegionalRouteSample => ({
      ...routeSample(x, y),
      directionX: 1,
      directionY: 0,
    });
    const focal = (
      id: string,
      side: -1 | 1,
      canonicalAlternative = false,
    ): RegionalParcelComponentAsset => ({
      id,
      families: ['canal-town'],
      role: 'mass',
      visualGroup: `${canonicalAlternative ? 'alternative' : 'ordinary'}:${side}`,
      compositionRole: 'focal',
      streetPairRole: canonicalAlternative ? 'canonical-alternative' : undefined,
      frontageAxis: 'east-west',
      compositionSide: side,
      frontageStations: [0],
      sprite: sprite(COLOURS['canal-town']),
      collision: [[0, 0]],
    });
    const alternatives = [
      focal('parcel:canal-town:alternative-negative', -1, true),
      focal('parcel:canal-town:alternative-positive', 1, true),
    ];
    const components = [
      focal('parcel:canal-town:ordinary-negative-a', -1),
      focal('parcel:canal-town:ordinary-negative-b', -1),
      focal('parcel:canal-town:ordinary-positive-a', 1),
      focal('parcel:canal-town:ordinary-positive-b', 1),
      ...alternatives,
    ];
    const makeCandidate = (
      blockSize: number,
      profile: RegionalAmbientPlaceFabricProfile,
    ) => makeWorld(
      blockSize, 64, continuousRoute, () => biomeSample('canal-town'),
      false, undefined, false, false, false, 'east-west', components, [],
      'cluster-field-blue-noise', 'hierarchical-place-field', profile, 'route-frontage', false,
    );
    const strict = makeCandidate(32, 'shared-common-street-overlay-exact');
    const candidate = makeCandidate(
      32,
      'shared-common-street-overlay-exact-alternatives',
    );
    const replay = makeCandidate(
      47,
      'shared-common-street-overlay-exact-alternatives',
    );
    const bounds = [-96, -72, 128, 72] as const;
    const isStreet = (placement: { parcelPathId?: string }) => (
      placement.parcelPathId?.endsWith(':street-overlay') ?? false
    );
    const alternativeIds = new Set(alternatives.map((asset) => asset.id));
    expect(strict.getAmbientPlacementsInBounds(...bounds).filter((placement) => (
      isStreet(placement) && alternativeIds.has(placement.assetId)
    ))).toHaveLength(0);
    const placements = candidate.getAmbientPlacementsInBounds(...bounds);
    expect(placements).toEqual(replay.getAmbientPlacementsInBounds(...bounds));
    const street = placements.filter(isStreet);
    expect(street.length).toBeGreaterThan(0);
    expect(street.some((placement) => alternativeIds.has(placement.assetId))).toBe(true);
    const streetBySite = new Map<string, typeof street>();
    for (const placement of street) {
      const site = `${placement.siteX},${placement.siteY}`;
      streetBySite.set(site, [...(streetBySite.get(site) ?? []), placement]);
    }
    expect([...streetBySite.values()].every((pair) => (
      pair.length === 2 && new Set(pair.map((placement) => placement.assetId)).size === 2
    ))).toBe(true);
    expect(candidate.getRegionalStats()).toMatchObject({
      ambientPlaceFabricProfile: 'shared-common-street-overlay-exact-alternatives',
    });
  });

  it('places deterministic civic details only on route-safe landmark shoulders', () => {
    const civicRoute = (x: number, y: number): RegionalRouteSample => {
      const base = routeSample(x, y);
      const nearest = [...SITES].sort((a, b) => Math.abs(x - a[0]) - Math.abs(x - b[0]))[0]!;
      return {
        ...base,
        landmarkDistance: Math.hypot(x - nearest[0], y),
      };
    };
    const first = makeWorld(32, 32, civicRoute, undefined, false, undefined, false, true);
    const second = makeWorld(48, 32, civicRoute, undefined, false, undefined, false, true);
    const placements = first.getCivicDetailPlacementsInBounds(-18, -18, 18, 18);
    expect(placements.length).toBeGreaterThanOrEqual(3);
    expect(new Set(placements.map((placement) => placement.assetId)).size).toBeGreaterThan(1);
    expect(placements.every((placement) => (
      placement.kind === 'civic-detail' && placement.families.includes('canal-town') &&
      placement.siteX === 0 && placement.siteY === 0 &&
      Math.abs(placement.anchorY) >= 2 && Math.abs(placement.anchorY) <= 8 &&
      Math.hypot(placement.anchorX, placement.anchorY) >= 2.5 &&
      Math.hypot(placement.anchorX, placement.anchorY) <= 14
    ))).toBe(true);
    expect(second.getCivicDetailPlacementsInBounds(-18, -18, 18, 18)).toEqual(placements);
    expect(first.getRegionalStats()).toMatchObject({
      civicDetailAssets: 4,
      cachedCivicDetailPlacements: placements.length,
    });
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

  it('builds a route-connected non-urban place without leaking its focal into parcels', () => {
    const forestFocals: RegionalParcelComponentAsset[] = ([-1, 1] as const).map((side) => ({
      id: `forest-place-focal:${side}`,
      families: ['forest'],
      role: 'mass',
      visualGroup: 'forest-place-log',
      compositionRole: 'focal',
      frontageAxis: 'east-west',
      compositionSide: side,
      frontageStations: [0],
      sprite: sprite({ r: 94, g: 72, b: side < 0 ? 38 : 46 }),
      collision: [[0, 0]],
    }));
    const duplicateSupport: RegionalParcelComponentAsset = {
      id: 'forest-place-log-support-duplicate',
      families: ['forest'],
      role: 'mass',
      visualGroup: 'forest-place-log',
      sprite: sprite({ r: 94, g: 72, b: 38 }),
      collision: [[0, 0]],
    };
    const world = makeWorld(
      32,
      32,
      routeSample,
      (x) => biomeSample(nearestFamily(x)),
      false,
      undefined,
      false,
      false,
      false,
      'east-west',
      [...forestFocals, duplicateSupport],
    );
    const entourage = world.getAmbientPlacementsInBounds(20, -22, 60, 22)
      .filter((placement) => placement.siteX === 40 && placement.siteY === 0);
    const placedFocals = entourage.filter((placement) => (
      placement.assetId.startsWith('forest-place-focal:')
    ));
    expect(placedFocals).toHaveLength(1);
    expect(placedFocals[0]?.families).toEqual(['forest']);
    expect(entourage.some((placement) => (
      placement.assetId === duplicateSupport.id
    ))).toBe(false);

    const fabrics = world.getLandmarkFabricLayoutsInBounds(20, -22, 60, 22)
      .filter((layout) => layout.id.includes(':40:0:waystation'));
    expect(fabrics).toHaveLength(1);
    expect(fabrics[0]?.materialFamily).toBe('forest');
    expect(fabrics[0]?.aprons.map((apron) => apron.role).sort())
      .toEqual(['approach', 'threshold']);
    const cells = rasterizeRegionalLandmarkFabricLayout(fabrics[0]!);
    expect(Math.min(...cells.map((cell) => routeSample(cell.x, cell.y).distance)))
      .toBeLessThanOrEqual(1);
    expect(cells.every((cell) => world.getTile(cell.x, cell.y).walkable)).toBe(true);

    const parcelComponents = world.getParcelComponentPlacementsInBounds(-32, -48, 232, 48);
    expect(parcelComponents.length).toBeGreaterThan(0);
    expect(parcelComponents.some((placement) => (
      placement.assetId.startsWith('forest-place-focal:')
    ))).toBe(false);
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

  it('assigns each continuous quay frontage layout to one nearest landmark owner', () => {
    const quayBiome = (_x: number, y: number): BiomeWorldSample => {
      const wet = Math.abs(y - 10) <= 1.25;
      return {
        ...biomeSample('canal-town'),
        waterDistance: wet ? 0 : Math.max(0, Math.abs(y - 10) - 1.25),
        isWater: wet,
        isRiver: wet,
      };
    };
    const secondSite: RegionalLandmarkSite = {
      id: 'site:18',
      x: 18,
      y: 0,
      priority: 0.5,
      landmarkKind: 'arrival',
    };
    const dualLandmarkRoute = (x: number, y: number): RegionalRouteSample => {
      const sample = routeSample(x, y);
      if (x !== secondSite.x || y !== secondSite.y) return sample;
      return {
        ...sample,
        distance: 0,
        signedDistance: 0,
        isRoute: true,
        isWalkableRoute: true,
        routeKind: 'local-road',
        routeId: 'second-route',
        directionX: 1,
        landmarkKind: secondSite.landmarkKind,
        landmarkDistance: 0,
      };
    };
    const world = makeWorld(
      32,
      32,
      dualLandmarkRoute,
      quayBiome,
      false,
      undefined,
      true,
      false,
      false,
      'east-west',
      [],
      [secondSite],
    );
    const frontage = world.getAmbientPlacementsInBounds(-20, 5, 30, 15)
      .filter((placement) => placement.waterfrontId === 'quay:test-canal');
    const physicalKeys = frontage.map((placement) => (
      `${placement.assetId}:${placement.anchorX},${placement.anchorY}:${placement.waterfrontId}`
    ));
    expect(new Set(physicalKeys).size).toBe(frontage.length);
    expect(frontage.length).toBeGreaterThan(0);
    expect(frontage.every((placement) => placement.siteX === 0 && placement.siteY === 0)).toBe(true);
  });

  it('discovers nearby side canals and proves declared frontage access to both quays', () => {
    const verticalBiome = (x: number, _y: number): BiomeWorldSample => {
      const wet = Math.abs(x - 10) <= 1.25;
      return {
        ...biomeSample('canal-town'),
        waterDistance: wet ? 0 : Math.max(0, Math.abs(x - 10) - 1.25),
        isWater: wet,
        isRiver: wet,
      };
    };
    const sideFrontages: readonly RegionalParcelComponentAsset[] = ([-1, 1] as const).map(
      (bankSide) => ({
        id: `side-frontage:${bankSide}`,
        families: ['canal-town'],
        role: 'mass',
        frontageAxis: 'north-south',
        programs: ['waterfront'],
        waterfrontFunction: bankSide === 1 ? 'warehouse' : 'inn',
        quayBankSide: bankSide,
        quayAccessOffset: [0, 0],
        sprite: sprite(bankSide === 1 ? { r: 235, g: 170, b: 82 } : { r: 224, g: 132, b: 74 }),
        collision: [[0, -1]],
      }),
    );
    const world = makeWorld(
      32,
      32,
      routeSample,
      verticalBiome,
      false,
      undefined,
      true,
      false,
      false,
      'north-south',
      sideFrontages,
    );
    const frontage = world.getAmbientPlacementsInBounds(2, -18, 18, 18)
      .filter((placement) => placement.waterfrontId === 'quay:test-canal' &&
        placement.accessAxis === 'north-south' && placement.quayAccessPath);

    expect(frontage.length).toBeGreaterThanOrEqual(2);
    expect(new Set(frontage.map((placement) => placement.assetId)))
      .toEqual(new Set(['side-frontage:-1', 'side-frontage:1']));
    for (const placement of frontage) {
      const path = placement.quayAccessPath!;
      expect(path[0]).toEqual([placement.anchorX, placement.anchorY]);
      expect(path.length).toBeGreaterThan(1);
      expect(path.length).toBeLessThanOrEqual(10);
      expect(placement.connectorLength).toBe(path.length - 1);
      expect(path.every(([x, y]) => !world.isBuildingAt(x, y) && world.getTile(x, y).walkable))
        .toBe(true);
      const [quayX, quayY] = path.at(-1)!;
      expect(world.getTile(quayX, quayY).id).toContain('regional-quay-ground:quay:test-canal');
    }
    expect(world.getTile(0, 0).walkable).toBe(true);
    expect(world.getRegionalStats().cachedQuayFrontageSites).toBeGreaterThan(0);
  });

  it('binds deterministic semantic activity to the declared water and quay surfaces', () => {
    const quayBiome = (_x: number, y: number): BiomeWorldSample => {
      const wet = Math.abs(y - 10) <= 1.25;
      return {
        ...biomeSample('canal-town'),
        waterDistance: wet ? 0 : Math.max(0, Math.abs(y - 10) - 1.25),
        isWater: wet,
        isRiver: wet,
      };
    };
    const first = makeWorld(
      32, 32, routeSample, quayBiome, false, undefined, true, false, true,
    );
    const alternateBlocks = makeWorld(
      48, 32, routeSample, quayBiome, false, undefined, true, false, true,
    );

    // Populate the alternate cache in the reverse direction before comparing
    // the canonical composition. Placement must not depend on traversal order
    // or the cache's tiling geometry.
    for (let x = 56; x >= -24; x -= 8) alternateBlocks.getBuildingTileAt(x, 10);
    const placements = first.getQuayDetailPlacementsInBounds(-24, -4, 56, 20);
    const replay = alternateBlocks.getQuayDetailPlacementsInBounds(-24, -4, 56, 20);
    expect(placements).toEqual(replay);
    expect(placements).toHaveLength(QUAY_DETAILS.length);
    expect(new Set(placements.map((placement) => placement.assetId)))
      .toEqual(new Set(QUAY_DETAILS.map((asset) => asset.id)));
    expect(new Set(placements.map((placement) => (
      `${placement.assetId}:${placement.anchorX},${placement.anchorY}`
    ))).size).toBe(placements.length);
    expect(placements.every((placement) => (
      placement.kind === 'quay-detail' && placement.siteX === 0 && placement.siteY === 0 &&
      placement.parcelPathId === 'quay:test-canal' &&
      placement.waterfrontId === 'quay:test-canal' && placement.accessAxis === 'east-west'
    ))).toBe(true);
    expect(placements.every((placement) => (
      placement.visualAnchorX === placement.anchorX &&
      placement.visualAnchorY === placement.anchorY
    ))).toBe(true);

    const assets = new Map(QUAY_DETAILS.map((asset) => [asset.id, asset]));
    for (const placement of placements) {
      const asset = assets.get(placement.assetId)!;
      for (const [offsetX, offsetY] of asset.collision) {
        const x = placement.anchorX + offsetX;
        const y = placement.anchorY + offsetY;
        const terrain = first.getTile(x, y);
        const overlay = asset.activity
          ? first.getDynamicOverlayTileAt(x, y)
          : first.getBuildingTileAt(x, y);
        expect(overlay).not.toBeNull();
        if (asset.surface === 'water') {
          expect(terrain.walkable, `water detail escaped at ${x},${y}`).toBe(false);
        } else {
          expect(terrain.id, `quay detail escaped at ${x},${y}`)
            .toContain('regional-quay-ground:quay:test-canal');
          expect(terrain.walkable).toBe(true);
        }
      }
    }
    expect(first.isBuildingAt(0, 0)).toBe(false);
    expect(first.getTile(0, 0).walkable).toBe(true);
    first.setWorldLifeState(worldLifeAt(750));
    const shifted = first.getQuayDetailPlacementsInBounds(-24, -4, 56, 20);
    const boatAtRest = placements.find((placement) => assets.get(placement.assetId)?.activity)!;
    const movingBoat = shifted.find((placement) => placement.assetId === boatAtRest.assetId)!;
    expect(movingBoat.anchorX).toBe(boatAtRest.anchorX);
    expect(movingBoat.anchorY).toBe(boatAtRest.anchorY);
    expect(movingBoat.visualAnchorX).toBe(boatAtRest.anchorX + 1);
    expect(movingBoat.visualAnchorY).toBe(boatAtRest.anchorY);
    expect(first.getDynamicOverlayTileAt(movingBoat.visualAnchorX!, movingBoat.visualAnchorY!))
      .not.toBeNull();
    const prepared = first.prepareViewport(-24, -4, 56, 20, 4);
    expect(prepared.dynamicPlacements.length).toBeGreaterThan(0);
    const imported = makeWorld(
      32, 32, routeSample, quayBiome, false, undefined, true, false, true,
    );
    imported.importPreparedViewport(structuredClone(prepared));
    imported.setWorldLifeState(worldLifeAt(750));
    const dynamicCoordinates: string[] = [];
    for (let y = -4; y <= 20; y++) {
      for (let x = -24; x <= 56; x++) {
        const importedTile = imported.getDynamicOverlayTileAt(x, y);
        expect(importedTile).toEqual(first.getDynamicOverlayTileAt(x, y));
        if (importedTile) dynamicCoordinates.push(`${x},${y}`);
      }
    }
    const sparse = imported.getDynamicOverlayTilesInBounds(-24, -4, 56, 20);
    expect(sparse).not.toBeNull();
    expect(sparse!.map((entry) => `${entry.tileX},${entry.tileY}`).sort())
      .toEqual(dynamicCoordinates.sort());
    for (const entry of sparse!) {
      expect(entry.tile).toBe(imported.getDynamicOverlayTileAt(entry.tileX, entry.tileY));
    }
    expect(imported.getRegionalStats().cachedBlocks).toBe(0);
    expect(first.getRegionalStats()).toMatchObject({
      quayDetailAssets: QUAY_DETAILS.length,
      cachedQuayDetailPlacements: placements.length,
    });
    expect(first.getRegionalStats().cachedDynamicQuayOverlayTiles).toBeGreaterThan(0);
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
      version: 3,
      worldSeed: '42',
      bounds: { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      resolution: 1,
      terrainRgba: new Uint8Array([10, 20, 30, 255]),
      terrainMaterial: new Uint8Array([2]),
      terrainWalkable: new Uint8Array([1]),
      overlayCoordinates: new Int32Array([0, 0]),
      overlayRgba: new Uint8Array([40, 50, 60, 128]),
      solid: new Uint8Array([0]),
      dynamicPlacements: [],
    };
    const first = makeWorld(32, 32);
    const second = makeWorld(32, 32);
    first.importPreparedViewport(packed);
    second.importPreparedViewport(packed);

    expect(first.getRegionalStats()).toMatchObject({
      preparedTerrainTiles: 1,
      preparedMaterializedTerrainTiles: 0,
      preparedMaterializedOverlayTiles: 0,
    });
    expect(first.getTileAtResolution(0, 0, 1)).toBe(second.getTileAtResolution(0, 0, 1));
    expect(first.getBuildingTileAt(0, 0)).toBe(second.getBuildingTileAt(0, 0));
    expect(first.getRegionalStats()).toMatchObject({
      preparedTerrainTiles: 1,
      preparedMaterializedTerrainTiles: 1,
      preparedMaterializedOverlayTiles: 1,
    });
    expect(second.getRegionalStats()).toMatchObject({
      preparedTerrainTiles: 1,
      preparedMaterializedTerrainTiles: 1,
      preparedMaterializedOverlayTiles: 1,
    });
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
