// Noise generation
export { SeededRandom, ValueNoise } from './noise/noise.js';
export { CanalTownWorldField, type CanalTownWorldSample } from './tiles/canal-town-world-field.js';
export {
  BIOME_FAMILIES,
  BiomeWorldField,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldFieldConfig,
  type BiomeWorldSample,
} from './biomes/biome-world-field.js';

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
  type RegionalMaterialCompositorConfig,
} from './tiles/regional-material-compositor.js';
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
