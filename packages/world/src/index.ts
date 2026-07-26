// Noise generation
export { SeededRandom, ValueNoise } from './noise/noise.js';
export { spatialHash2DUnit, spatialHash2DUint32 } from './spatial-hash.js';
export { CanalTownWorldField, type CanalTownWorldSample } from './tiles/canal-town-world-field.js';
export {
  BIOME_FAMILIES,
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  REGIONAL_BASIN_SIZE,
  type ArrivalCivicBranchConfig,
  type BiomeFamily,
  type BiomePhysicalSample,
  type BiomeWeights,
  type BiomeWorldFieldConfig,
  type BiomeWorldSample,
  type ConstructedWaterwayBounds,
  type ConstructedWaterwayDescriptor,
  type ConstructedWaterwaySample,
} from './biomes/biome-world-field.js';
export {
  RegionalRouteField,
  type RegionalCrossingKind,
  type RegionalLandmarkKind,
  type RegionalLandmarkSite,
  type RegionalRouteBiomeSampler,
  type RegionalRouteFieldConfig,
  type RegionalRouteKind,
  type RegionalRouteSample,
} from './routes/regional-route-field.js';

// Chunk system
export { ChunkGenerator, type GeneratedChunk } from './chunk/chunk-generator.js';
export { ChunkCache } from './chunk/chunk-cache.js';
export { CHUNK_SIZE } from './chunk/constants.js';

// Spatial indexing
export {
  SpatialIndex,
  worldToCell,
  cellKey,
} from './spatial/spatial-index.js';

// Game loop
export { GameLoop, type TickContext, type GameLoopConfig } from './tick/game-loop.js';

// Tile system
export {
  GRASS_TILE,
  DIRT_TILE,
  STONE_TILE,
  WATER_TILE,
  SAND_TILE,
  VOID_TILE,
  BASE_TILES,
  getTileById,
  setTerrainTile,
  setTerrainTiles,
  getAITileCount,
  hasAITile,
} from './tiles/base-tiles.js';

export {
  TileProvider,
  createPlaceholderSprite,
  type TileProviderConfig,
  type BuildingData,
} from './tiles/tile-provider.js';
export { DistrictTileProvider } from './tiles/district-tile-provider.js';
export {
  CanalTownTileProvider,
  type CanalPlacementRole,
  type CanalTownAsset,
  type CanalTownTerrainConfig,
  type CanalTownTileProviderConfig,
} from './tiles/canal-town-tile-provider.js';
export {
  CanalMaterialCompositor,
  type CanalMaterialCompositorConfig,
  type WaterClassifier,
} from './tiles/canal-material-compositor.js';
export {
  RegionalMaterialCompositor,
  type BiomeSampler,
  type RegionalRouteSampler,
  type RegionalRouteSurfaceStyle,
  type RegionalMaterialCompositorConfig,
} from './tiles/regional-material-compositor.js';
export {
  buildRegionalParcelPath,
  buildRegionalPolylinePath,
  distanceToRegionalParcelPath,
  rasterizeRegionalParcelPath,
  sampleRegionalParcelPath,
  type RegionalParcelPath,
  type RegionalParcelPathCell,
  type RegionalParcelPathConfig,
  type RegionalParcelPathFrame,
  type RegionalParcelPathPoint,
  type RegionalPolylinePathConfig,
} from './tiles/regional-parcel-path.js';
export {
  buildRegionalEnvironmentProgramLayout,
  rasterizeRegionalEnvironmentProgramLayout,
  sampleRegionalEnvironmentProgramLayout,
  type RegionalCaveChamber,
  type RegionalEnvironmentProgramBounds,
  type RegionalEnvironmentProgramCell,
  type RegionalEnvironmentProgramKind,
  type RegionalEnvironmentProgramLayout,
  type RegionalEnvironmentProgramLayoutConfig,
  type RegionalEnvironmentProgramRole,
  type RegionalEnvironmentProgramSample,
  type RegionalEnvironmentTerrainSample,
} from './tiles/regional-environment-program-layout.js';
export {
  buildRegionalParcelLayout,
  rasterizeRegionalParcelLayout,
  sampleRegionalParcelLayout,
  type RegionalParcelBoundary,
  type RegionalParcelBounds,
  type RegionalParcelDepthSample,
  type RegionalParcelLayout,
  type RegionalParcelLayoutCell,
  type RegionalParcelLayoutConfig,
  type RegionalParcelLayoutSample,
  type RegionalParcelPlot,
  type RegionalParcelPurpose,
  type RegionalParcelSpatialCell,
} from './tiles/regional-parcel-layout.js';
export {
  buildRegionalLandmarkFabricLayout,
  rasterizeRegionalLandmarkFabricLayout,
  sampleRegionalLandmarkFabricLayout,
  type RegionalLandmarkFabricApron,
  type RegionalLandmarkFabricAxis,
  type RegionalLandmarkFabricBounds,
  type RegionalLandmarkFabricCell,
  type RegionalLandmarkFabricLayout,
  type RegionalLandmarkFabricLayoutConfig,
  type RegionalLandmarkFabricSample,
  type RegionalLandmarkFabricSpatialCell,
  type RegionalLandmarkFocalFootprint,
} from './tiles/regional-landmark-fabric-layout.js';
export {
  buildRegionalWaterfrontLayout,
  rasterizeRegionalWaterfrontLayout,
  sampleRegionalWaterfrontLayout,
  type RegionalWaterfrontBounds,
  type RegionalWaterfrontLayout,
  type RegionalWaterfrontLayoutCell,
  type RegionalWaterfrontLayoutConfig,
  type RegionalWaterfrontLayoutSample,
  type RegionalWaterfrontPolygon,
  type RegionalWaterfrontSpatialCell,
  type RegionalWaterfrontSurfaceRole,
} from './tiles/regional-waterfront-layout.js';
export {
  CANAL_TOWN_QUAY_EDGE_VARIATION,
  buildRegionalQuayLayout,
  regionalQuayCellIsWalkable,
  sampleRegionalQuayLayout,
  type RegionalQuayLayout,
  type RegionalQuayLayoutConfig,
  type RegionalQuayLayoutSample,
} from './tiles/regional-quay-layout.js';
export {
  REGIONAL_MAX_PREPARED_VIEWPORT_AREA,
  RegionalWorldDerivedCache,
  RegionalWorldTileProvider,
  type RegionalAmbientDistributionProfile,
  type RegionalAmbientAsset,
  type RegionalAssetPlacement,
  type RegionalCivicDetailAsset,
  type RegionalEnvironmentConstraints,
  type RegionalEnvironmentContactAsset,
  type RegionalLandmarkAsset,
  type RegionalLandmarkPlacement,
  type RegionalPrewarmResult,
  type RegionalPreparedOverlayTile,
  type RegionalPreparedDynamicPlacement,
  type RegionalPreparedTerrainTile,
  type RegionalPreparedViewport,
  type RegionalPackedPreparedViewport,
  type RegionalParcelConnectorCell,
  type RegionalParcelComponentAsset,
  type RegionalParcelProgram,
  type RegionalQuayDetailAsset,
  type RegionalQuayDetailActivity,
  type RegionalQuayDetailAxis,
  type RegionalQuayDetailSurface,
  type RegionalPreparedViewportPayload,
  type RegionalRouteContactAsset,
  type RegionalRouteContactAxis,
  type RegionalVisualAsset,
  type RegionalWaterfrontFunction,
  type RegionalWorldBiomeSampler,
  type RegionalWorldRouteSampler,
  type RegionalWorldTileProviderConfig,
} from './tiles/regional-world-tile-provider.js';
export {
  CornerCodedTileSet,
  type CornerCodedTileSetConfig,
  type CornerTileAddress,
} from './tiles/corner-coded-tile-set.js';

// Procedural tile generation
export {
  generateProceduralTile,
  generateTerrainPixel,
  generateAllResolutions,
  generateWaterAnimationFrames,
  type TerrainType,
  type NeighborInfo,
} from './tiles/procedural-tiles.js';
