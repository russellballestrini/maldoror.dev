import type {
  BuildingDirection,
  BuildingSprite,
  BuildingTileData,
  PixelGrid,
  Tile,
} from '@maldoror/protocol';
import { getTileById } from './base-tiles.js';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';
import type { CanalMaterialCompositor } from './canal-material-compositor.js';
import type { CornerCodedTileSet } from './corner-coded-tile-set.js';
import { CanalTownWorldField } from './canal-town-world-field.js';

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
  materialCompositor?: CanalMaterialCompositor;
  cornerTerrain?: {
    paving?: CornerCodedTileSet;
    water?: CornerCodedTileSet;
    garden?: CornerCodedTileSet;
  };
  worldField?: CanalTownWorldField;
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
 * this class supplies a continuous hierarchical field and constraint-aware
 * asset groups. Blocks are cache units only: they do not stamp visual content.
 * Signed coordinates work identically, so there is no finite painted-district
 * boundary.
 */
export class CanalTownTileProvider extends TileProvider {
  private readonly seed32: number;
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly terrain: CanalTownTerrainConfig;
  private readonly bridgeDeckTiles: Tile[];
  private readonly materialCompositor?: CanalMaterialCompositor;
  private readonly cornerTerrain: CanalTownTileProviderConfig['cornerTerrain'];
  private readonly worldField: CanalTownWorldField;
  private readonly rolePools = new Map<CanalPlacementRole, CanalTownAsset[]>();
  private readonly assetsById = new Map<string, CanalTownAsset>();
  private readonly blockCache = new Map<string, CachedBlock>();

  constructor(config: CanalTownTileProviderConfig) {
    super(config);
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.blockSize = Math.max(14, config.blockSize ?? 16);
    this.maxCachedBlocks = Math.max(16, config.blockCacheSize ?? 128);
    this.terrain = config.terrain;
    this.materialCompositor = config.materialCompositor;
    this.cornerTerrain = config.cornerTerrain;
    this.worldField = config.worldField ?? new CanalTownWorldField(config.worldSeed);
    this.bridgeDeckTiles = config.terrain.water.flatMap((id) => {
      const tile = getTileById(id);
      return tile ? [{ ...tile, id: `${tile.id}__bridge-deck`, walkable: true }] : [];
    });

    for (const asset of config.assets) {
      this.assetsById.set(asset.id, asset);
      for (const role of asset.roles) {
        const pool = this.rolePools.get(role) ?? [];
        pool.push(asset);
        this.rolePools.set(role, pool);
      }
    }
  }

  override getTile(tileX: number, tileY: number): Tile | null {
    const terrainCell = this.worldField.sample(tileX, tileY);
    const bridgeDeck = terrainCell.isBridge;
    if (bridgeDeck) {
      const deck = this.pickBridgeDeck(tileX, tileY);
      if (deck) return deck;
    }

    const transition = this.materialCompositor?.getTransitionTile(
      tileX,
      tileY,
      (x, y) => this.worldField.sample(x, y).isWater,
    );
    if (transition) return transition;

    if (terrainCell.isWater) {
      return this.cornerTerrain?.water?.getTile(tileX, tileY) ??
        this.pickTerrain(this.terrain.water, tileX, tileY, 'water') ??
        super.getTile(tileX, tileY);
    }

    const gardenTransition = this.materialCompositor?.getGardenTransitionTile(
      tileX,
      tileY,
      (x, y) => this.worldField.sample(x, y).isGarden,
    );
    if (gardenTransition) return gardenTransition;

    if (terrainCell.isGarden) {
      return this.cornerTerrain?.garden?.getTile(tileX, tileY) ??
        this.pickTerrain(this.terrain.garden, tileX, tileY, 'garden') ??
        super.getTile(tileX, tileY);
    }

    // Keep paths visually continuous; greenery comes from layered, shadowed
    // assets rather than rectangular grass patches cut into the plaza.
    return this.cornerTerrain?.paving?.getTile(tileX, tileY) ??
      this.pickTerrain(this.terrain.paving, tileX, tileY, 'paving') ??
      super.getTile(tileX, tileY);
  }

  override getBuildingTileAt(
    worldX: number,
    worldY: number,
    direction: BuildingDirection = 'north',
  ): BuildingTileData | null {
    const authored = super.getBuildingTileAt(worldX, worldY, direction);
    if (authored) return authored;
    for (const block of this.getProceduralBlocksNear(worldX, worldY)) {
      const tile = block.overlays.get(positionKey(worldX, worldY));
      if (tile) return tile;
    }
    return null;
  }

  override isBuildingAt(worldX: number, worldY: number): boolean {
    if (super.isBuildingAt(worldX, worldY)) return true;
    return this.getProceduralBlocksNear(worldX, worldY)
      .some((block) => block.solid.has(positionKey(worldX, worldY)));
  }

  getCanalTownStats(): {
    assetCount: number;
    cachedBlocks: number;
    blockSize: number;
    cachedMaterialTransitions: number;
    cachedOverlayTiles: number;
    cachedSolidTiles: number;
  } {
    const assets = new Set<string>();
    for (const pool of this.rolePools.values()) for (const asset of pool) assets.add(asset.id);
    return {
      assetCount: assets.size,
      cachedBlocks: this.blockCache.size,
      blockSize: this.blockSize,
      cachedMaterialTransitions: this.materialCompositor?.getStats().cachedTiles ?? 0,
      cachedOverlayTiles: [...this.blockCache.values()].reduce((total, block) => total + block.overlays.size, 0),
      cachedSolidTiles: [...this.blockCache.values()].reduce((total, block) => total + block.solid.size, 0),
    };
  }

  override destroy(): void {
    this.blockCache.clear();
    super.destroy();
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

  private getProceduralBlocksNear(worldX: number, worldY: number): CachedBlock[] {
    const blockX = floorDiv(worldX, this.blockSize);
    const blockY = floorDiv(worldY, this.blockSize);
    const blocks: CachedBlock[] = [];
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        blocks.push(this.getProceduralBlock(
          (blockX + offsetX) * this.blockSize,
          (blockY + offsetY) * this.blockSize,
        ));
      }
    }
    return blocks;
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
    const place = (
      role: CanalPlacementRole,
      localX: number,
      localY: number,
      authoredOverhang = false,
    ): void => {
      const pool = this.rolePools.get(role);
      if (!pool || pool.length === 0) return;
      const anchorX = originX + localX;
      const anchorY = originY + localY;
      const start = nextRandom() % pool.length;
      for (let offset = 0; offset < pool.length; offset++) {
        const asset = pool[(start + offset) % pool.length]!;
        if (!this.assetFits(role, asset, anchorX, anchorY, authoredOverhang)) continue;
        placements.push({ asset, anchorX, anchorY });
        return;
      }
    };
    const placeLandmark = (
      assetId: string,
      fallbackRole: CanalPlacementRole,
      localX: number,
      localY: number,
      authoredOverhang = false,
    ): void => {
      const asset = this.assetsById.get(assetId);
      const anchorX = originX + localX;
      const anchorY = originY + localY;
      if (asset?.roles.includes(fallbackRole) &&
          this.assetFits(fallbackRole, asset, anchorX, anchorY, authoredOverhang)) {
        placements.push({ asset, anchorX, anchorY });
        return;
      }
      // Minimal test kits and downstream manifests can still render a valid
      // landmark from semantic roles without inheriting production IDs.
      place(fallbackRole, localX, localY, authoredOverhang);
    };

    // Candidate anchors come from a world-space priority field. Keeping only a
    // local maximum in each neighbourhood is an unbounded blue-noise analogue:
    // cache block borders cannot form arrays or duplicate anchors.
    const spacing = 4;
    const firstCellX = floorDiv(originX, spacing) - 1;
    const firstCellY = floorDiv(originY, spacing) - 1;
    const lastCellX = floorDiv(originX + this.blockSize - 1, spacing) + 1;
    const lastCellY = floorDiv(originY + this.blockSize - 1, spacing) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const priority = this.hash(cellX, cellY, stringHash('placement-priority'));
        let wins = true;
        for (let neighbourY = cellY - 1; neighbourY <= cellY + 1 && wins; neighbourY++) {
          for (let neighbourX = cellX - 1; neighbourX <= cellX + 1; neighbourX++) {
            if (neighbourX === cellX && neighbourY === cellY) continue;
            if (neighbourX !== cellX && neighbourY !== cellY) continue;
            if (this.hash(neighbourX, neighbourY, stringHash('placement-priority')) > priority) {
              wins = false;
              break;
            }
          }
        }
        if (!wins) continue;
        const anchorX = cellX * spacing + this.hash(cellX, cellY, stringHash('placement-x')) % spacing;
        const anchorY = cellY * spacing + this.hash(cellX, cellY, stringHash('placement-y')) % spacing;
        if (anchorX < originX || anchorX >= originX + this.blockSize || anchorY < originY || anchorY >= originY + this.blockSize) continue;
        const sample = this.worldField.sample(anchorX, anchorY);
        // The arrival district has its own composition grammar below. Keep
        // stochastic parcels outside its frame so its facade runs, canal
        // contacts, bridges, and negative space read as one landmark.
        const inArrivalFrame = Math.abs(anchorX) <= 15 && Math.abs(anchorY) <= 11;
        if (inArrivalFrame || sample.isPlaza) continue;

        const localX = anchorX - originX;
        const localY = anchorY - originY;
        if (sample.isWater) {
          if (!sample.isBridge && priority % 3 === 0) place('water-detail', localX, localY);
          continue;
        }
        if (sample.isGarden) {
          place('foliage', localX, localY);
          if (priority % 4 === 0) place('quay-detail', localX + 1, localY);
          continue;
        }
        if (sample.routeDistance <= 1.8) {
          place(priority % 5 === 0 ? 'street-large' : 'street-small', localX, localY);
        } else if (sample.waterDistance <= 7) {
          place(priority % 4 === 0 ? 'quay-detail' : 'building', localX, localY);
        } else if (sample.routeDistance <= 10) {
          place(priority % 5 === 0 ? 'foliage' : 'building', localX, localY);
        }
      }
    }
    if (blockX === 0 && blockY === 0) {
      // The exact login origin is a deliberately authored landmark within the
      // procedural hierarchy: a central river island, twin branches, a stone
      // bridge plus constructed causeway, continuous outer street walls, and
      // planted bank contacts.
      let upperBridgeX = 0;
      let deepestWater = Number.POSITIVE_INFINITY;
      for (let x = -16; x <= 16; x++) {
        const sample = this.worldField.sample(x, -6);
        if (sample.isBridge && sample.waterDistance < deepestWater) {
          upperBridgeX = x;
          deepestWater = sample.waterDistance;
        }
      }
      place('bridge', upperBridgeX, -6);

      // Front-facing five-tile facades form two continuous outer street walls.
      // Their silhouettes overlap the viewport edge like a real district,
      // instead of presenting four isolated dollhouses on a paving carpet.
      const leftWall = ['flower-shop', 'bakery', 'pottery-workshop', 'flower-conservatory'] as const;
      const rightWall = ['ivy-cafe', 'teal-house', 'blue-canal-house', 'flower-shop'] as const;
      // The y=0 cross street remains a genuine portal through both walls.
      const wallY = [-7, -3, 5, 9] as const;
      for (let index = 0; index < wallY.length; index++) {
        placeLandmark(leftWall[index]!, 'building', -12, wallY[index]!, true);
        placeLandmark(rightWall[index]!, 'building', 12, wallY[index]!, true);
      }

      // Inner and outer bank contacts establish a constructed waterline. Edge
      // pieces sit below foliage/details in painter order, with water life in
      // the channel rather than on the plaza.
      placeLandmark('quay-corner', 'edge', -2, -4);
      placeLandmark('wooden-dock', 'edge', 2, -4);
      placeLandmark('wooden-dock', 'edge', -2, 5);
      placeLandmark('quay-corner', 'edge', 2, 5);
      placeLandmark('wildflower-pots', 'quay-detail', -2, -3);
      placeLandmark('flower-quay-planter', 'quay-detail', 2, -3);
      placeLandmark('lemon-planter', 'quay-detail', -2, 4);
      placeLandmark('rose-arch', 'quay-detail', 2, 4);
      placeLandmark('flowering-shrub', 'foliage', -2, -6);
      placeLandmark('cypress', 'foliage', 2, -6);
      placeLandmark('olive-tree', 'foliage', -2, 7);
      placeLandmark('stone-planter', 'foliage', 2, 7);
      placeLandmark('ivy-trellis', 'foliage', -10, -4);
      placeLandmark('flowering-shrub', 'foliage', 10, 5);
      for (const [x, y] of [[-6, -3], [6, -3], [-6, 4], [6, 4]] as const) {
        place('water-detail', x, y);
      }
      place('street-large', 0, 4);
      for (const [x, y] of [[-2, -3], [2, -3], [-2, 3], [2, 3]] as const) {
        placeLandmark('canal-lamp', 'street-small', x, y);
      }
    }

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

  private assetFits(
    role: CanalPlacementRole,
    asset: CanalTownAsset,
    anchorX: number,
    anchorY: number,
    authoredOverhang = false,
  ): boolean {
    const anchor = this.worldField.sample(anchorX, anchorY);
    if (role === 'bridge' || role === 'bridge-vertical') return anchor.isBridge;
    if (role === 'water' || role === 'water-detail') return anchor.isWater && !anchor.isBridge;
    if (anchor.isWater || anchor.isBridge || anchor.isPlaza) return false;

    for (const [dx, dy] of asset.collision) {
      const sample = this.worldField.sample(anchorX + dx, anchorY + dy);
      if (sample.isWater || sample.isBridge || sample.isPlaza) return false;
      if (role === 'building' && !authoredOverhang && sample.routeDistance < 1.8) return false;
    }

    // Collision masks are intentionally independent, but opaque lower façade
    // tiles still need semantic ground beneath them. Test the bottom two sprite
    // rows so a tower cannot balance on a one-cell island or hang over water.
    if (role === 'building' && !authoredOverhang) {
      const offsetX = Math.floor(asset.sprite.width / 2);
      const offsetY = asset.sprite.height - 1;
      for (let tileY = Math.max(0, asset.sprite.height - 2); tileY < asset.sprite.height; tileY++) {
        for (let tileX = 0; tileX < asset.sprite.width; tileX++) {
          if (!asset.sprite.tiles[tileY]?.[tileX]) continue;
          const sample = this.worldField.sample(
            anchorX + tileX - offsetX,
            anchorY + tileY - offsetY,
          );
          if (sample.isWater || sample.isBridge || sample.isPlaza || sample.routeDistance < 1.2) return false;
        }
      }
    }
    return true;
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
