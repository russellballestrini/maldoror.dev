import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  CANAL_TOWN_QUAY_EDGE_VARIATION,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldDerivedCache,
  RegionalWorldTileProvider,
  type RegionalAmbientDistributionProfile,
} from '@maldoror/world';
import {
  loadRegionalRuntimeAssets,
  type RegionalRuntimeAssetProvenance,
} from './regional-runtime-asset-pack.js';

export interface RegionalWorldAssetPaths {
  biomeMaterials: string;
  routeMaterials: string;
  landmarks: string;
  ambient: string;
  civicDetails: string;
  quayDetails: string;
  routeContacts: string;
  parcelComponents: string;
  environmentContacts: string;
  runtimePack: string;
}

export interface RegionalWorldProviderOptions {
  worldSeed: bigint;
  assets: RegionalWorldAssetPaths;
}

export interface LoadedRegionalWorldProvider {
  field: BiomeWorldField;
  routes: RegionalRouteField;
  compositor: RegionalMaterialCompositor;
  world: RegionalWorldTileProvider;
  assetLoad: RegionalRuntimeAssetProvenance;
}

export interface RegionalSessionWorldOptions {
  maxPreparedViewports?: number;
  clearSharedCachesOnDestroy?: boolean;
}

/** Evidence-selected production profile. Keep research controls switchable,
 * but make every faithful runtime seam share the same selected composition. */
export const REGIONAL_AMBIENT_DISTRIBUTION_PROFILE =
  'cluster-field-blue-noise' satisfies RegionalAmbientDistributionProfile;

/** One worker-owned regional kit. Raster assets, semantic fields, routes, and
 * material caches are shared; each SSH session receives its own provider for
 * players, NPCs, user buildings, roads, and prepared-view LRU state. */
export interface LoadedRegionalWorldKit {
  field: BiomeWorldField;
  routes: RegionalRouteField;
  compositor: RegionalMaterialCompositor;
  assetLoad: RegionalRuntimeAssetProvenance;
  createSessionWorld(options?: RegionalSessionWorldOptions): RegionalWorldTileProvider;
  clearSharedCaches(): void;
}

export function defaultRegionalWorldAssetPaths(rootOverride?: string): RegionalWorldAssetPaths {
  const root = rootOverride
    ? path.resolve(rootOverride)
    : fileURLToPath(new URL('../../../../', import.meta.url));
  return {
    biomeMaterials: path.join(root, 'assets/biomes/manifest.json'),
    routeMaterials: path.join(root, 'assets/routes/manifest.json'),
    landmarks: path.join(root, 'assets/biomes/landmarks-manifest.json'),
    ambient: path.join(root, 'assets/biomes/ambient-manifest.json'),
    civicDetails: path.join(root, 'assets/biomes/civic-details-manifest.json'),
    quayDetails: path.join(root, 'assets/biomes/quay-details-manifest.json'),
    routeContacts: path.join(root, 'assets/biomes/route-contacts-manifest.json'),
    parcelComponents: path.join(root, 'assets/biomes/parcel-components-manifest.json'),
    environmentContacts: path.join(root, 'assets/biomes/environment-contacts-manifest.json'),
    runtimePack: fileURLToPath(new URL('../runtime/regional-world-kit-v1.v8.gz', import.meta.url)),
  };
}

/** Build the exact regional stack shared by the background generator, research
 * harness, and eventual live provider. Keeping construction in one seam is
 * essential: a worker package is useful only when it represents the same seed,
 * route grammar, manifests, and cache-independent algorithms as its consumer. */
export async function loadRegionalWorldKit(
  options: RegionalWorldProviderOptions,
): Promise<LoadedRegionalWorldKit> {
  const loadedAssets = await loadRegionalRuntimeAssets(options.assets);
  const {
    biome: biomeKit,
    routes: routeKit,
    landmarks: landmarkKit,
    ambient: ambientKit,
    civicDetails: civicDetailKit,
    quayDetails: quayDetailKit,
    routeContacts: routeContactKit,
    parcelComponents: parcelKit,
    environmentContacts: environmentKit,
  } = loadedAssets.kits;
  const field = new BiomeWorldField(options.worldSeed, {
    blockSize: 16,
    maxCachedBlocks: 48,
    arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  });
  const routes = new RegionalRouteField(options.worldSeed, field, {
    blockSize: 32,
    maxCachedBlocks: 128,
    maxCachedPaths: 512,
    maxCachedSites: 4096,
    pathStep: 4,
  });
  const compositor = new RegionalMaterialCompositor({
    worldSeed: options.worldSeed,
    field,
    materials: biomeKit.materials,
    overviewMaterials: biomeKit.overviewMaterials,
    landmarkFabricMaterials: biomeKit.landmarkFabricMaterials,
    routes,
    routeMaterials: routeKit.routeMaterials,
    crossingMaterials: routeKit.crossingMaterials,
    routeSurfaceStyles: routeKit.routeSurfaceStyles,
    crossingSurfaceStyles: routeKit.crossingSurfaceStyles,
    maxCachedTiles: 4096,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
    maxOutputResolution: Math.min(biomeKit.sourceTileSize, routeKit.sourceTileSize),
  });
  const derivedCache = new RegionalWorldDerivedCache();
  // Session providers begin with byte-identical canonical terrain and no
  // user-authored roads/buildings. TileProvider forks this token on the first
  // structural mutation, so colocated views can share only safe static frames.
  const staticRenderIdentity = {};
  return {
    field,
    routes,
    compositor,
    assetLoad: loadedAssets.provenance,
    createSessionWorld: (runtimeOptions = {}) => new RegionalWorldTileProvider({
      worldSeed: options.worldSeed,
      field,
      routes,
      compositor,
      landmarks: landmarkKit.assets,
      ambient: ambientKit.assets,
      civicDetails: civicDetailKit.assets,
      quayDetails: quayDetailKit.assets,
      routeContacts: routeContactKit.assets,
      parcelComponents: parcelKit.assets,
      environmentContacts: environmentKit.assets,
      blockSize: landmarkKit.blockSize,
      maxCachedBlocks: 64,
      ambientCellSize: ambientKit.cellSize,
      ambientDensity: ambientKit.density,
      ambientDistributionProfile: REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
      ambientLandmarkClearance: ambientKit.landmarkClearance,
      civicDetailCellSize: civicDetailKit.cellSize,
      civicDetailDensity: civicDetailKit.density,
      quayDetailDensity: quayDetailKit.density,
      quayEdgeVariation: CANAL_TOWN_QUAY_EDGE_VARIATION,
      routeContactCellSize: routeContactKit.cellSize,
      routeContactDensity: routeContactKit.density,
      routeContactLandmarkClearance: routeContactKit.landmarkClearance,
      maxCachedRouteContactCells: 4096,
      parcelMinimumLayers: parcelKit.minimumLayers,
      parcelMaximumLayers: parcelKit.maximumLayers,
      parcelLayerSpacing: parcelKit.layerSpacing,
      environmentContactCellSize: environmentKit.cellSize,
      environmentContactDensity: environmentKit.density,
      environmentContactLandmarkClearance: environmentKit.landmarkClearance,
      maxPreparedViewports: runtimeOptions.maxPreparedViewports ?? 6,
      clearSharedCachesOnDestroy: runtimeOptions.clearSharedCachesOnDestroy ?? false,
      derivedCache,
      staticRenderIdentity,
    }),
    clearSharedCaches: () => {
      derivedCache.clear();
      compositor.clear();
      routes.clear();
      field.clear();
    },
  };
}

export async function loadRegionalWorldProvider(
  options: RegionalWorldProviderOptions,
): Promise<LoadedRegionalWorldProvider> {
  const kit = await loadRegionalWorldKit(options);
  const world = kit.createSessionWorld({ clearSharedCachesOnDestroy: true });
  return {
    field: kit.field,
    routes: kit.routes,
    compositor: kit.compositor,
    world,
    assetLoad: kit.assetLoad,
  };
}
