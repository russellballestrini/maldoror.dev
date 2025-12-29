import { ValueNoise } from './noise';

export type TerrainType = 'grass' | 'dirt' | 'sand' | 'water' | 'stone';

export interface TerrainTile {
  type: TerrainType;
  elevation: number;
  moisture: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export const TERRAIN_COLORS: Record<TerrainType, RGB> = {
  water: { r: 30, g: 100, b: 180 },
  sand: { r: 210, g: 180, b: 140 },
  grass: { r: 34, g: 139, b: 34 },
  dirt: { r: 139, g: 90, b: 43 },
  stone: { r: 128, g: 128, b: 128 },
};

export const TERRAIN_HEIGHTS: Record<TerrainType, number> = {
  water: -0.15,
  sand: 0.0,
  grass: 0.05,
  dirt: 0.08,
  stone: 0.15,
};

const CHUNK_SIZE = 16;

interface ChunkData {
  tiles: TerrainTile[][];
  accessedAt: number;
}

export class TerrainGenerator {
  private worldSeed: bigint;
  private noise: ValueNoise;
  private chunkCache: Map<string, ChunkData> = new Map();
  private maxChunks = 100;

  constructor(seed: string | bigint) {
    this.worldSeed = typeof seed === 'string' ? BigInt(seed) : seed;
    this.noise = new ValueNoise(this.worldSeed);
  }

  getTerrain(tileX: number, tileY: number): TerrainTile {
    const chunkX = Math.floor(tileX / CHUNK_SIZE);
    const chunkY = Math.floor(tileY / CHUNK_SIZE);

    const chunk = this.getChunk(chunkX, chunkY);
    if (!chunk) {
      return { type: 'grass', elevation: 0.5, moisture: 0.5 };
    }

    const localX = ((tileX % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const localY = ((tileY % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;

    return chunk.tiles[localY]?.[localX] ?? { type: 'grass', elevation: 0.5, moisture: 0.5 };
  }

  private getChunk(chunkX: number, chunkY: number): ChunkData | null {
    const key = `${chunkX},${chunkY}`;

    let chunk = this.chunkCache.get(key);
    if (chunk) {
      chunk.accessedAt = Date.now();
      return chunk;
    }

    chunk = this.generateChunk(chunkX, chunkY);
    this.chunkCache.set(key, chunk);
    this.evictOldChunks();

    return chunk;
  }

  private generateChunk(chunkX: number, chunkY: number): ChunkData {
    const tiles: TerrainTile[][] = [];

    for (let y = 0; y < CHUNK_SIZE; y++) {
      const row: TerrainTile[] = [];
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const worldX = chunkX * CHUNK_SIZE + x;
        const worldY = chunkY * CHUNK_SIZE + y;

        const elevation = this.noise.sample(worldX * 0.05, worldY * 0.05);
        const moisture = this.noise.sample(worldX * 0.03 + 1000, worldY * 0.03 + 1000);
        const type = this.getTerrainType(elevation, moisture);

        row.push({ type, elevation, moisture });
      }
      tiles.push(row);
    }

    return { tiles, accessedAt: Date.now() };
  }

  private getTerrainType(elevation: number, moisture: number): TerrainType {
    if (elevation < 0.3) return 'water';
    if (elevation < 0.35) return 'sand';
    if (elevation > 0.75) return 'stone';
    if (moisture < 0.35) return 'dirt';
    return 'grass';
  }

  private evictOldChunks(): void {
    if (this.chunkCache.size <= this.maxChunks) return;

    const entries = Array.from(this.chunkCache.entries())
      .sort((a, b) => a[1].accessedAt - b[1].accessedAt);

    const toRemove = entries.slice(0, entries.length - this.maxChunks);
    for (const [key] of toRemove) {
      this.chunkCache.delete(key);
    }
  }

  clearCache(): void {
    this.chunkCache.clear();
    this.noise.clearCache();
  }
}
