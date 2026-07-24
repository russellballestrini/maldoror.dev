import {
  BiomeWorldField,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldTileProvider,
} from '@maldoror/world';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalRouteContactKit,
  loadRegionalRouteMaterialKit,
} from './biome-assets.js';

export interface RegionalWorldAssetPaths {
  biomeMaterials: string;
  routeMaterials: string;
  landmarks: string;
  ambient: string;
  routeContacts: string;
  parcelComponents: string;
  environmentContacts: string;
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
}

/** Build the exact regional stack shared by the background generator, research
 * harness, and eventual live provider. Keeping construction in one seam is
 * essential: a worker package is useful only when it represents the same seed,
 * route grammar, manifests, and cache-independent algorithms as its consumer. */
export async function loadRegionalWorldProvider(
  options: RegionalWorldProviderOptions,
): Promise<LoadedRegionalWorldProvider> {
  const [
    biomeKit,
    routeKit,
    landmarkKit,
    ambientKit,
    routeContactKit,
    parcelKit,
    environmentKit,
  ] = await Promise.all([
    loadRegionalBiomeMaterialKit(options.assets.biomeMaterials),
    loadRegionalRouteMaterialKit(options.assets.routeMaterials),
    loadRegionalLandmarkKit(options.assets.landmarks),
    loadRegionalAmbientKit(options.assets.ambient),
    loadRegionalRouteContactKit(options.assets.routeContacts),
    loadRegionalParcelComponentKit(options.assets.parcelComponents),
    loadRegionalEnvironmentContactKit(options.assets.environmentContacts),
  ]);
  const field = new BiomeWorldField(options.worldSeed, {
    blockSize: 16,
    maxCachedBlocks: 48,
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
    routes,
    routeMaterials: routeKit.routeMaterials,
    crossingMaterials: routeKit.crossingMaterials,
    maxCachedTiles: 4096,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
  });
  const world = new RegionalWorldTileProvider({
    worldSeed: options.worldSeed,
    field,
    routes,
    compositor,
    landmarks: landmarkKit.assets,
    ambient: ambientKit.assets,
    routeContacts: routeContactKit.assets,
    parcelComponents: parcelKit.assets,
    environmentContacts: environmentKit.assets,
    blockSize: landmarkKit.blockSize,
    maxCachedBlocks: 64,
    ambientCellSize: ambientKit.cellSize,
    ambientDensity: ambientKit.density,
    ambientLandmarkClearance: ambientKit.landmarkClearance,
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
    maxPreparedViewports: 4,
  });
  return { field, routes, compositor, world };
}
