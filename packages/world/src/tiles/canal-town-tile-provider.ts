import type {
  BuildingDirection,
  BuildingSprite,
  BuildingTileData,
  PixelGrid,
  Tile,
} from '@maldoror/protocol';
import { getTileById } from './base-tiles.js';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';

export type CanalPlacementRole =
  | 'building'
  | 'bridge'
  | 'bridge-vertical'
  | 'edge'
  | 'foliage'
  | 'street-small'
  | 'street-large'
  | 'water'
  | 'water-detail'
  | 'quay-detail';

/** Runtime form of one manifest asset. Pixels are loaded once in the worker
 * and shared by every SSH session; placement remains pure and deterministic. */
export interface CanalTownAsset {
  id: string;
  roles: CanalPlacementRole[];
  sprite: BuildingSprite;
  /** Solid tile offsets relative to the sprite anchor (bottom-centre). */
  collision: ReadonlyArray<readonly [number, number]>;
}

export interface CanalTownTerrainConfig {
  water: string[];
  paving: string[];
  garden: string[];
  curb: Partial<Record<'n' | 'e' | 's' | 'w' | 'ne' | 'nw' | 'se' | 'sw', string>>;
}

export interface CanalTownTileProviderConfig extends TileProviderConfig {
  assets: readonly CanalTownAsset[];
  terrain: CanalTownTerrainConfig;
  blockSize?: number;
  blockCacheSize?: number;
}

interface Placement {
  asset: CanalTownAsset;
  anchorX: number;
  anchorY: number;
}

interface CachedBlock {
  overlays: Map<string, BuildingTileData>;
  solid: Set<string>;
  accessedAt: number;
}

/**
 * Infinite canal-neighbourhood world.
 *
 * The asset manifest supplies visual vocabulary and collision footprints;
 * this class only supplies stable urban grammar. Every block has waterways,
 * quay edges, bridge crossings, dense building fronts, garden punctuation,
 * and street furniture. Signed block coordinates work identically, so there
 * is no finite painted-district boundary.
 */
export class CanalTownTileProvider extends TileProvider {
  private readonly seed32: number;
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly terrain: CanalTownTerrainConfig;
  private readonly bridgeDeckTiles: Tile[];
  private readonly rolePools = new Map<CanalPlacementRole, CanalTownAsset[]>();
  private readonly blockCache = new Map<string, CachedBlock>();

  constructor(config: CanalTownTileProviderConfig) {
    super(config);
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.blockSize = Math.max(14, config.blockSize ?? 16);
    this.maxCachedBlocks = Math.max(16, config.blockCacheSize ?? 128);
    this.terrain = config.terrain;
    this.bridgeDeckTiles = config.terrain.water.flatMap((id) => {
      const tile = getTileById(id);
      return tile ? [{ ...tile, id: `${tile.id}__bridge-deck`, walkable: true }] : [];
    });

    for (const asset of config.assets) {
      for (const role of asset.roles) {
        const pool = this.rolePools.get(role) ?? [];
        pool.push(asset);
        this.rolePools.set(role, pool);
      }
    }
  }

  override getTile(tileX: number, tileY: number): Tile | null {
    const lx = positiveMod(tileX, this.blockSize);
    const ly = positiveMod(tileY, this.blockSize);

    // Crossing waterways divide each neighbourhood into readable waterfront
    // islands. The 24-tile cadence is larger than a normal viewport, while the
    // paired bridges keep the infinite network traversable in both axes.
    const canalWidth = this.canalWidthAt(tileY);
    const bridgeY = Math.floor(this.blockSize / 2);
    const horizontalWidth = this.horizontalCanalWidthAt(tileX);
    const horizontalStart = bridgeY - Math.floor(horizontalWidth / 2);
    const horizontalEnd = horizontalStart + horizontalWidth - 1;
    const verticalWater = lx < canalWidth;
    const horizontalWater = ly >= horizontalStart && ly <= horizontalEnd;
    const eastWestBridge = verticalWater && ly >= bridgeY - 1 && ly <= bridgeY + 1;
    const northSouthBridge = horizontalWater && lx >= 13 && lx <= 15;
    const bridgeDeck = eastWestBridge || northSouthBridge;
    if (bridgeDeck) {
      const deck = this.pickBridgeDeck(tileX, tileY);
      if (deck) return deck;
    } else if (verticalWater || horizontalWater) {
      return this.pickTerrain(this.terrain.water, tileX, tileY, 'water') ?? super.getTile(tileX, tileY);
    }

    const curbKey = this.curbKey(lx, ly, tileY, horizontalStart, horizontalEnd);
    if (!bridgeDeck && curbKey) {
      const curbId = this.terrain.curb[curbKey];
      if (curbId) {
        const curb = getTileById(curbId);
        if (curb) return curb;
      }
    }

    // Keep paths visually continuous; greenery comes from layered, shadowed
    // assets rather than rectangular grass patches cut into the plaza.
    return this.pickTerrain(this.terrain.paving, tileX, tileY, 'paving') ?? super.getTile(tileX, tileY);
  }

  override getBuildingTileAt(
    worldX: number,
    worldY: number,
    direction: BuildingDirection = 'north',
  ): BuildingTileData | null {
    const authored = super.getBuildingTileAt(worldX, worldY, direction);
    if (authored) return authored;
    return this.getProceduralBlock(worldX, worldY).overlays.get(positionKey(worldX, worldY)) ?? null;
  }

  override isBuildingAt(worldX: number, worldY: number): boolean {
    if (super.isBuildingAt(worldX, worldY)) return true;
    return this.getProceduralBlock(worldX, worldY).solid.has(positionKey(worldX, worldY));
  }

  getCanalTownStats(): { assetCount: number; cachedBlocks: number; blockSize: number } {
    const assets = new Set<string>();
    for (const pool of this.rolePools.values()) for (const asset of pool) assets.add(asset.id);
    return { assetCount: assets.size, cachedBlocks: this.blockCache.size, blockSize: this.blockSize };
  }

  override destroy(): void {
    this.blockCache.clear();
    super.destroy();
  }

  private curbKey(
    lx: number,
    ly: number,
    worldY: number,
    horizontalStart: number,
    horizontalEnd: number,
  ): keyof CanalTownTerrainConfig['curb'] | null {
    if (lx === this.canalWidthAt(worldY)) return 'w';
    if (lx === this.blockSize - 1) return 'e';
    if (ly === horizontalStart - 1) return 'n';
    if (ly === horizontalEnd + 1) return 's';
    return null;
  }

  private canalWidthAt(worldY: number): number {
    const phase = (worldY + (this.seed32 % 29)) / 5.5;
    const wave = Math.sin(phase) + Math.sin(phase * 0.43) * 0.55;
    return wave > 0.55 ? 7 : wave < -0.55 ? 5 : 6;
  }

  private horizontalCanalWidthAt(worldX: number): number {
    const phase = (worldX - (this.seed32 % 31)) / 6.5;
    return Math.sin(phase) > 0.4 ? 6 : 5;
  }

  private pickTerrain(ids: string[], x: number, y: number, salt: string): Tile | null {
    if (ids.length === 0) return null;
    const start = this.hash(x, y, stringHash(salt)) % ids.length;
    for (let offset = 0; offset < ids.length; offset++) {
      const tile = getTileById(ids[(start + offset) % ids.length]!);
      if (tile) return tile;
    }
    return null;
  }

  /** The visible bridge sprite supplies the stone deck. Its transparent pixels
   * must reveal water, not a rectangular paving slab, while collision remains
   * walkable across the complete crossing footprint. */
  private pickBridgeDeck(x: number, y: number): Tile | null {
    if (this.bridgeDeckTiles.length === 0) return null;
    return this.bridgeDeckTiles[this.hash(x, y, stringHash('bridge-deck')) % this.bridgeDeckTiles.length] ?? null;
  }

  private getProceduralBlock(worldX: number, worldY: number): CachedBlock {
    const blockX = floorDiv(worldX, this.blockSize);
    const blockY = floorDiv(worldY, this.blockSize);
    const key = `${blockX},${blockY}`;
    const cached = this.blockCache.get(key);
    if (cached) {
      cached.accessedAt = Date.now();
      return cached;
    }

    const block = this.buildBlock(blockX, blockY);
    this.blockCache.set(key, block);
    if (this.blockCache.size > this.maxCachedBlocks) this.evictBlocks();
    return block;
  }

  private buildBlock(blockX: number, blockY: number): CachedBlock {
    const originX = blockX * this.blockSize;
    const originY = blockY * this.blockSize;
    const placements: Placement[] = [];
    let randomState = this.hash(blockX, blockY, stringHash('canal-town-placements')) || 1;
    const nextRandom = (): number => {
      randomState ^= randomState << 13;
      randomState ^= randomState >>> 17;
      randomState ^= randomState << 5;
      return randomState >>> 0;
    };
    const place = (role: CanalPlacementRole, localX: number, localY: number): void => {
      const pool = this.rolePools.get(role);
      if (!pool || pool.length === 0) return;
      const asset = pool[nextRandom() % pool.length]!;
      placements.push({ asset, anchorX: originX + localX, anchorY: originY + localY });
    };

    // Two dense rows frame the horizontal canal. Large façades read at terminal
    // scale; plants and signs overlap their feet to remove the cut-out look.
    for (const x of [9, 15, 21]) {
      place('building', x, 8);
      place('building', x, this.blockSize - 3);
      place('quay-detail', x - 2, 9);
      place('street-small', x + 2, 9);
      place('foliage', x - 2, this.blockSize - 3);
      place('street-small', x + 2, this.blockSize - 3);
    }

    const bridgeY = Math.floor(this.blockSize / 2);
    place('bridge', 3, bridgeY);
    place('bridge-vertical', 14, bridgeY + 5);
    place('water', 2, 5);
    place('water', 3, 20);
    for (const y of [4, 8, 17, 21]) place('water-detail', 2, y);
    for (const x of [9, 19]) place('water-detail', x, bridgeY);
    place('edge', 3, 8);
    place('edge', 3, 19);

    // Layered vegetation hugs both quays. The central north/south bridge stays
    // a clear walking ribbon, with small punctuation instead of an empty plaza.
    for (const y of [5, 8, 18, 22]) {
      place('foliage', 8, y);
      place('foliage', this.blockSize - 2, y);
    }
    for (const y of [5, 8, 18, 22]) place('quay-detail', 8, y);
    for (const x of [10, 18, 22]) {
      place('quay-detail', x, 9);
      place('quay-detail', x, 17);
    }
    for (const [x, y] of [[10, 6], [14, 7], [19, 6], [10, 20], [15, 19], [20, 20]] as const) {
      place('street-small', x, y);
    }
    place('street-large', 11, 7);
    place('street-large', 20, 19);

    const overlays = new Map<string, BuildingTileData>();
    const solid = new Set<string>();
    for (const placement of placements) {
      const offsetX = Math.floor(placement.asset.sprite.width / 2);
      const offsetY = placement.asset.sprite.height - 1;
      for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
        for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
          const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
          if (!tile) continue;
          const x = placement.anchorX + tileX - offsetX;
          const y = placement.anchorY + tileY - offsetY;
          const key = positionKey(x, y);
          const beneath = overlays.get(key);
          overlays.set(key, beneath ? compositeTiles(beneath, tile) : tile);
        }
      }
      for (const [dx, dy] of placement.asset.collision) {
        solid.add(positionKey(placement.anchorX + dx, placement.anchorY + dy));
      }
    }

    return { overlays, solid, accessedAt: Date.now() };
  }

  private evictBlocks(): void {
    const oldest = [...this.blockCache.entries()]
      .sort((a, b) => a[1].accessedAt - b[1].accessedAt)
      .slice(0, this.blockCache.size - this.maxCachedBlocks);
    for (const [key] of oldest) this.blockCache.delete(key);
  }

  private hash(x: number, y: number, salt: number): number {
    let h = (this.seed32 ^ salt) | 0;
    h = Math.imul(h ^ x, 0x45d9f3b);
    h = Math.imul(h ^ y, 0x45d9f3b);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function stringHash(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Alpha-over for the occasional deliberate overlap (flowers against a shop
 * wall, furniture in front of a quay). PixelGrid uses null as transparency, so
 * the manifest placement order is also the painter's order. */
function compositeTiles(beneath: BuildingTileData, above: BuildingTileData): BuildingTileData {
  const pixels = compositeGrids(beneath.pixels, above.pixels);
  return { pixels, resolutions: { [String(pixels.length)]: pixels } };
}

function compositeGrids(beneath: PixelGrid, above: PixelGrid): PixelGrid {
  const height = Math.max(beneath.length, above.length);
  const width = Math.max(beneath[0]?.length ?? 0, above[0]?.length ?? 0);
  const result: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row = [];
    for (let x = 0; x < width; x++) row.push(above[y]?.[x] ?? beneath[y]?.[x] ?? null);
    result.push(row);
  }
  return result;
}
