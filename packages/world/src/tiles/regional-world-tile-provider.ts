import type {
  BuildingDirection,
  BuildingSprite,
  BuildingTileData,
  PixelGrid,
  Tile,
} from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWorldSample,
} from '../biomes/biome-world-field.js';
import type {
  RegionalLandmarkKind,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from './regional-material-compositor.js';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';

export interface RegionalLandmarkAsset {
  id: string;
  families: readonly BiomeFamily[];
  landmarkKinds: readonly RegionalLandmarkKind[];
  sprite: BuildingSprite;
  /** Solid offsets relative to the sprite's bottom-centre anchor. The route
   * threshold itself should remain absent when an asset depicts an entrance. */
  collision: ReadonlyArray<readonly [number, number]>;
}

export interface RegionalLandmarkPlacement {
  assetId: string;
  families: readonly BiomeFamily[];
  siteX: number;
  siteY: number;
  anchorX: number;
  anchorY: number;
}

export interface RegionalWorldBiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
}

export interface RegionalWorldRouteSampler {
  sample(worldX: number, worldY: number): RegionalRouteSample;
}

export interface RegionalWorldTileProviderConfig extends TileProviderConfig {
  field: RegionalWorldBiomeSampler;
  routes: RegionalWorldRouteSampler;
  compositor: RegionalMaterialCompositor;
  landmarks: readonly RegionalLandmarkAsset[];
  blockSize?: number;
  maxCachedBlocks?: number;
}

interface Placement {
  asset: RegionalLandmarkAsset;
  siteX: number;
  siteY: number;
  anchorX: number;
  anchorY: number;
}

interface CachedBlock {
  overlays: Map<string, BuildingTileData>;
  solid: Set<string>;
  placements: Placement[];
  accessedAt: number;
}

/**
 * Regional production-provider seam.
 *
 * Terrain, route material, collision, and sparse vertical landmarks all consume
 * the same coordinate-stable fields. Route sites are the global composition
 * goals; manifest compatibility and local biome weights choose visual identity;
 * terrain/route clearance constrains the final anchor. Cache blocks only retain
 * derived raster placement and cannot alter the underlying world.
 */
export class RegionalWorldTileProvider extends TileProvider {
  private readonly seed32: number;
  private readonly field: RegionalWorldBiomeSampler;
  private readonly routes: RegionalWorldRouteSampler;
  private readonly compositor: RegionalMaterialCompositor;
  private readonly landmarks: readonly RegionalLandmarkAsset[];
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly blockCache = new Map<string, CachedBlock>();
  private accessClock = 0;

  constructor(config: RegionalWorldTileProviderConfig) {
    super(config);
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.routes = config.routes;
    this.compositor = config.compositor;
    this.landmarks = config.landmarks;
    this.blockSize = Math.max(16, config.blockSize ?? 32);
    this.maxCachedBlocks = Math.max(9, config.maxCachedBlocks ?? 64);
    for (const asset of this.landmarks) {
      if (asset.families.length === 0 || asset.landmarkKinds.length === 0) {
        throw new Error(`Regional landmark has no semantic compatibility: ${asset.id}`);
      }
      if (asset.collision.length === 0) {
        throw new Error(`Regional landmark has no collision evidence: ${asset.id}`);
      }
    }
  }

  override getTile(tileX: number, tileY: number): Tile {
    return this.compositor.getTile(tileX, tileY);
  }

  getTileAtResolution(tileX: number, tileY: number, resolution: number): Tile {
    return this.compositor.getTileAtResolution(tileX, tileY, resolution);
  }

  override getBuildingTileAt(
    worldX: number,
    worldY: number,
    direction: BuildingDirection = 'north',
  ): BuildingTileData | null {
    const authored = super.getBuildingTileAt(worldX, worldY, direction);
    if (authored) return authored;
    for (const block of this.blocksNear(worldX, worldY)) {
      const tile = block.overlays.get(positionKey(worldX, worldY));
      if (tile) return tile;
    }
    return null;
  }

  override isBuildingAt(worldX: number, worldY: number): boolean {
    if (super.isBuildingAt(worldX, worldY)) return true;
    return this.blocksNear(worldX, worldY)
      .some((block) => block.solid.has(positionKey(worldX, worldY)));
  }

  getRegionalStats(): {
    landmarkAssets: number;
    cachedBlocks: number;
    cachedPlacements: number;
    cachedOverlayTiles: number;
    cachedSolidTiles: number;
    blockSize: number;
    maxCachedBlocks: number;
  } {
    return {
      landmarkAssets: this.landmarks.length,
      cachedBlocks: this.blockCache.size,
      cachedPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.length,
        0,
      ),
      cachedOverlayTiles: [...this.blockCache.values()].reduce(
        (total, block) => total + block.overlays.size,
        0,
      ),
      cachedSolidTiles: [...this.blockCache.values()].reduce(
        (total, block) => total + block.solid.size,
        0,
      ),
      blockSize: this.blockSize,
      maxCachedBlocks: this.maxCachedBlocks,
    };
  }

  /** Resolve the same constrained placement used by block composition. This is
   * useful to population systems and proof tooling; it does not create a
   * second placement algorithm. */
  resolveLandmarkPlacement(siteX: number, siteY: number): RegionalLandmarkPlacement | null {
    const placement = this.createPlacement(Math.floor(siteX), Math.floor(siteY));
    return placement ? {
      assetId: placement.asset.id,
      families: placement.asset.families,
      siteX: placement.siteX,
      siteY: placement.siteY,
      anchorX: placement.anchorX,
      anchorY: placement.anchorY,
    } : null;
  }

  override destroy(): void {
    this.blockCache.clear();
    this.compositor.clear();
    super.destroy();
  }

  private blocksNear(worldX: number, worldY: number): CachedBlock[] {
    const blockX = floorDiv(worldX, this.blockSize);
    const blockY = floorDiv(worldY, this.blockSize);
    const blocks: CachedBlock[] = [];
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        blocks.push(this.getBlock(blockX + offsetX, blockY + offsetY));
      }
    }
    return blocks;
  }

  private getBlock(blockX: number, blockY: number): CachedBlock {
    const key = `${blockX},${blockY}`;
    const cached = this.blockCache.get(key);
    if (cached) {
      cached.accessedAt = ++this.accessClock;
      this.blockCache.delete(key);
      this.blockCache.set(key, cached);
      return cached;
    }
    const block = this.buildBlock(blockX, blockY);
    this.blockCache.set(key, block);
    while (this.blockCache.size > this.maxCachedBlocks) {
      const oldest = this.blockCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.blockCache.delete(oldest);
    }
    return block;
  }

  private buildBlock(blockX: number, blockY: number): CachedBlock {
    const originX = blockX * this.blockSize;
    const originY = blockY * this.blockSize;
    const placements: Placement[] = [];
    for (let y = originY; y < originY + this.blockSize; y++) {
      for (let x = originX; x < originX + this.blockSize; x++) {
        const placement = this.createPlacement(x, y);
        if (placement) placements.push(placement);
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
      for (const [offsetX, offsetY] of placement.asset.collision) {
        solid.add(positionKey(placement.anchorX + offsetX, placement.anchorY + offsetY));
      }
    }
    return { overlays, solid, placements, accessedAt: ++this.accessClock };
  }

  private createPlacement(siteX: number, siteY: number): Placement | null {
    const route = this.routes.sample(siteX, siteY);
    if (!route.landmarkKind || route.landmarkDistance > 0.1) return null;
    const biome = this.field.sample(siteX, siteY);
    const asset = this.selectAsset(siteX, siteY, biome, route.landmarkKind);
    if (!asset) return null;
    const anchor = this.findConstrainedAnchor(siteX, siteY, route, asset);
    return anchor ? { asset, siteX, siteY, ...anchor } : null;
  }

  private selectAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    landmarkKind: RegionalLandmarkKind,
  ): RegionalLandmarkAsset | null {
    const candidates = this.landmarks.filter((asset) => asset.landmarkKinds.includes(landmarkKind));
    let selected: RegionalLandmarkAsset | null = null;
    let selectedScore = Number.NEGATIVE_INFINITY;
    for (const asset of candidates) {
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      const variation = this.hashUnit(worldX, worldY, stringHash(asset.id)) * 0.025;
      const score = compatibility + variation;
      if (score > selectedScore) {
        selected = asset;
        selectedScore = score;
      }
    }
    return selected;
  }

  private findConstrainedAnchor(
    siteX: number,
    siteY: number,
    route: RegionalRouteSample,
    asset: RegionalLandmarkAsset,
  ): { anchorX: number; anchorY: number } | null {
    const length = Math.hypot(route.directionX, route.directionY);
    const tangentX = length > 0.1 ? route.directionX / length : 1;
    const tangentY = length > 0.1 ? route.directionY / length : 0;
    const normalX = -tangentY;
    const normalY = tangentX;
    const preferredSide = this.hashUnit(siteX, siteY, 0x7a31) < 0.5 ? -1 : 1;
    for (const side of [preferredSide, -preferredSide]) {
      for (let distance = 3; distance <= 7; distance++) {
        const anchorX = Math.round(siteX + normalX * distance * side);
        const anchorY = Math.round(siteY + normalY * distance * side);
        if (this.assetFits(anchorX, anchorY, asset)) return { anchorX, anchorY };
      }
    }
    return null;
  }

  private assetFits(anchorX: number, anchorY: number, asset: RegionalLandmarkAsset): boolean {
    if (this.field.sample(anchorX, anchorY).isWater) return false;
    for (const [offsetX, offsetY] of asset.collision) {
      const x = anchorX + offsetX;
      const y = anchorY + offsetY;
      if (this.field.sample(x, y).isWater || this.routes.sample(x, y).distance < 1.5) return false;
    }
    return true;
  }

  private hashUnit(x: number, y: number, salt: number): number {
    let value = Math.imul((x | 0) ^ this.seed32 ^ salt, 0x45d9f3b);
    value = Math.imul(value ^ (y | 0), 0x119de1f3);
    return ((value ^ (value >>> 16)) >>> 0) / 0xffffffff;
  }
}

function positionKey(x: number, y: number): string {
  return `${x},${y}`;
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

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
