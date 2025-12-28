import { ValueNoise } from './noise';

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface TerrainTile {
  id: string;
  color: RGB;
}

// Terrain colors as fallback
const TERRAIN_COLORS: Record<string, RGB> = {
  water: { r: 30, g: 100, b: 180 },
  sand: { r: 210, g: 180, b: 140 },
  grass: { r: 34, g: 139, b: 34 },
  dirt: { r: 139, g: 90, b: 43 },
  stone: { r: 128, g: 128, b: 128 },
};

// Terrain tile image cache
const terrainImageCache: Map<string, HTMLImageElement | null> = new Map();
const terrainImageLoading: Set<string> = new Set();

function loadTerrainImage(tileId: string): void {
  if (terrainImageCache.has(tileId) || terrainImageLoading.has(tileId)) return;

  terrainImageLoading.add(tileId);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    terrainImageCache.set(tileId, img);
    terrainImageLoading.delete(tileId);
  };
  img.onerror = () => {
    terrainImageCache.set(tileId, null);
    terrainImageLoading.delete(tileId);
  };
  img.src = `/files/terrain/${tileId}_256.png`;
}

// Preload base terrain tiles
['grass', 'dirt', 'sand', 'water', 'stone'].forEach(loadTerrainImage);

/**
 * Get terrain image for a tile ID (returns null if not loaded or not available)
 */
export function getTerrainImage(tileId: string): HTMLImageElement | null {
  // Ensure loading is started
  loadTerrainImage(tileId);
  return terrainImageCache.get(tileId) ?? null;
}

const CHUNK_SIZE = 16;

interface ChunkData {
  tiles: string[][];
  accessedAt: number;
}

/**
 * Web-based tile provider for procedural terrain generation
 * Generates terrain using the same algorithm as the server
 */
export class TileProviderWeb {
  private worldSeed: bigint;
  private noise: ValueNoise;
  private chunkCache: Map<string, ChunkData> = new Map();
  private maxChunks = 64;

  constructor(seed: string | bigint) {
    this.worldSeed = typeof seed === 'string' ? BigInt(seed) : seed;
    this.noise = new ValueNoise(this.worldSeed);
  }

  /**
   * Get terrain at world coordinates
   */
  getTerrain(tileX: number, tileY: number): TerrainTile {
    const tileId = this.getTileId(tileX, tileY);
    return {
      id: tileId,
      color: TERRAIN_COLORS[tileId] ?? TERRAIN_COLORS.grass,
    };
  }

  /**
   * Get terrain color at world coordinates
   */
  getTerrainColor(tileX: number, tileY: number): RGB {
    return this.getTerrain(tileX, tileY).color;
  }

  /**
   * Get tile ID at world coordinates
   */
  private getTileId(tileX: number, tileY: number): string {
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);

    const chunk = this.getChunk(chunkX, chunkY);
    if (!chunk) return 'grass';

    const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    return chunk.tiles[localY]?.[localX] ?? 'grass';
  }

  /**
   * Get or generate a chunk
   */
  private getChunk(chunkX: number, chunkY: number): ChunkData | null {
    const key = `${chunkX},${chunkY}`;

    let chunk = this.chunkCache.get(key);
    if (chunk) {
      chunk.accessedAt = Date.now();
      return chunk;
    }

    // Generate new chunk
    chunk = this.generateChunk(chunkX, chunkY);
    this.chunkCache.set(key, chunk);

    // Evict old chunks if needed
    this.evictOldChunks();

    return chunk;
  }

  /**
   * Generate a chunk procedurally
   */
  private generateChunk(chunkX: number, chunkY: number): ChunkData {
    const tiles: string[][] = [];

    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row: string[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = chunkX * CHUNK_SIZE + x;
        const worldY = chunkY * CHUNK_SIZE + y;

        // Use noise to determine terrain (same algorithm as server)
        const elevation = this.noise.sample(worldX * 0.05, worldY * 0.05);
        const moisture = this.noise.sample(worldX * 0.03 + 1000, worldY * 0.03 + 1000);

        row.push(this.getTileIdFromTerrain(elevation, moisture));
      }
      tiles.push(row);
    }

    return {
      tiles,
      accessedAt: Date.now(),
    };
  }

  /**
   * Determine tile type from terrain values
   */
  private getTileIdFromTerrain(elevation: number, moisture: number): string {
    // Water in low areas
    if (elevation < 0.3) {
      return 'water';
    }

    // Beach/sand at water edges
    if (elevation < 0.35) {
      return 'sand';
    }

    // Stone at high elevations
    if (elevation > 0.75) {
      return 'stone';
    }

    // Dirt in dry areas
    if (moisture < 0.35) {
      return 'dirt';
    }

    // Default to grass
    return 'grass';
  }

  /**
   * Evict least recently used chunks
   */
  private evictOldChunks(): void {
    if (this.chunkCache.size <= this.maxChunks) return;

    const entries = Array.from(this.chunkCache.entries())
      .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

    const toRemove = entries.slice(0, entries.length - this.maxChunks);
    for (const [key] of toRemove) {
      this.chunkCache.delete(key);
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.chunkCache.clear();
    this.noise.clearCache();
  }
}
