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
  RegionalLandmarkSite,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import { RegionalMaterialCompositor } from './regional-material-compositor.js';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';

export interface RegionalVisualAsset {
  id: string;
  families: readonly BiomeFamily[];
  sprite: BuildingSprite;
  /** Solid offsets relative to the sprite's bottom-centre anchor. Open
   * thresholds remain absent when an asset depicts an entrance or gate. */
  collision: ReadonlyArray<readonly [number, number]>;
}

export interface RegionalLandmarkAsset extends RegionalVisualAsset {
  landmarkKinds: readonly RegionalLandmarkKind[];
}

export interface RegionalAmbientAsset extends RegionalVisualAsset {
  /** Eligible distance band from the regional route graph. A maximum of 999
   * means unbounded, including terrain outside any cached route influence. */
  routeDistance: readonly [number, number];
}

export interface RegionalAssetPlacement {
  assetId: string;
  families: readonly BiomeFamily[];
  siteX: number;
  siteY: number;
  anchorX: number;
  anchorY: number;
}

export type RegionalLandmarkPlacement = RegionalAssetPlacement;

export interface RegionalWorldBiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
}

export interface RegionalWorldRouteSampler {
  sample(worldX: number, worldY: number): RegionalRouteSample;
  getLandmarkSites?(minX: number, minY: number, maxX: number, maxY: number): RegionalLandmarkSite[];
}

export interface RegionalWorldTileProviderConfig extends TileProviderConfig {
  field: RegionalWorldBiomeSampler;
  routes: RegionalWorldRouteSampler;
  compositor: RegionalMaterialCompositor;
  landmarks: readonly RegionalLandmarkAsset[];
  ambient?: readonly RegionalAmbientAsset[];
  blockSize?: number;
  maxCachedBlocks?: number;
  ambientCellSize?: number;
  ambientDensity?: number;
  ambientLandmarkClearance?: number;
}

interface Placement {
  asset: RegionalVisualAsset;
  kind: 'landmark' | 'ambient';
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

const VISIBLE_TILE_CACHE = new WeakMap<BuildingTileData, boolean>();
const LANDMARK_ANCHOR_REACH = 7;

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
  private readonly ambient: readonly RegionalAmbientAsset[];
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly ambientCellSize: number;
  private readonly ambientDensity: number;
  private readonly ambientLandmarkClearance: number;
  private readonly placementMinOffsetX: number;
  private readonly placementMaxOffsetX: number;
  private readonly placementMinOffsetY: number;
  private readonly placementMaxOffsetY: number;
  private readonly blockCache = new Map<string, CachedBlock>();
  private accessClock = 0;

  constructor(config: RegionalWorldTileProviderConfig) {
    super(config);
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.routes = config.routes;
    this.compositor = config.compositor;
    this.landmarks = config.landmarks;
    this.ambient = config.ambient ?? [];
    this.blockSize = Math.max(16, config.blockSize ?? 32);
    this.maxCachedBlocks = Math.max(9, config.maxCachedBlocks ?? 64);
    this.ambientCellSize = Math.max(3, config.ambientCellSize ?? 4);
    this.ambientDensity = Math.max(0, Math.min(1, config.ambientDensity ?? 0.86));
    this.ambientLandmarkClearance = Math.max(4, config.ambientLandmarkClearance ?? 9);
    for (const asset of this.landmarks) {
      if (asset.families.length === 0 || asset.landmarkKinds.length === 0) {
        throw new Error(`Regional landmark has no semantic compatibility: ${asset.id}`);
      }
      if (asset.collision.length === 0) {
        throw new Error(`Regional landmark has no collision evidence: ${asset.id}`);
      }
    }
    for (const asset of this.ambient) {
      if (asset.families.length === 0 || asset.collision.length === 0 ||
          asset.routeDistance[0] < 0 || asset.routeDistance[1] < asset.routeDistance[0]) {
        throw new Error(`Regional ambient asset has invalid semantics: ${asset.id}`);
      }
    }
    const placementAssets: readonly RegionalVisualAsset[] = [...this.landmarks, ...this.ambient];
    const extentX = placementAssets.flatMap((asset) => {
      const reach = this.landmarks.includes(asset as RegionalLandmarkAsset) ? LANDMARK_ANCHOR_REACH : 0;
      return [
        -Math.floor(asset.sprite.width / 2) - reach,
        asset.sprite.width - 1 - Math.floor(asset.sprite.width / 2) + reach,
        ...asset.collision.flatMap(([offsetX]) => [offsetX - reach, offsetX + reach]),
      ];
    });
    const extentY = placementAssets.flatMap((asset) => {
      const reach = this.landmarks.includes(asset as RegionalLandmarkAsset) ? LANDMARK_ANCHOR_REACH : 0;
      return [
        -(asset.sprite.height - 1) - reach,
        reach,
        ...asset.collision.flatMap(([, offsetY]) => [offsetY - reach, offsetY + reach]),
      ];
    });
    this.placementMinOffsetX = Math.min(0, ...extentX);
    this.placementMaxOffsetX = Math.max(0, ...extentX);
    this.placementMinOffsetY = Math.min(0, ...extentY);
    this.placementMaxOffsetY = Math.max(0, ...extentY);
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
    ambientAssets: number;
    cachedBlocks: number;
    cachedPlacements: number;
    cachedLandmarkPlacements: number;
    cachedAmbientPlacements: number;
    cachedOverlayTiles: number;
    cachedSolidTiles: number;
    blockSize: number;
    maxCachedBlocks: number;
  } {
    return {
      landmarkAssets: this.landmarks.length,
      ambientAssets: this.ambient.length,
      cachedBlocks: this.blockCache.size,
      cachedPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.length,
        0,
      ),
      cachedLandmarkPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter((placement) => placement.kind === 'landmark').length,
        0,
      ),
      cachedAmbientPlacements: [...this.blockCache.values()].reduce(
        (total, block) => total + block.placements.filter((placement) => placement.kind === 'ambient').length,
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

  getAmbientPlacementsInBounds(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
  ): RegionalAssetPlacement[] {
    const placements: RegionalAssetPlacement[] = [];
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        for (const placement of this.getBlock(blockX, blockY).placements) {
          if (placement.kind !== 'ambient' || placement.anchorX < minX || placement.anchorX > maxX ||
              placement.anchorY < minY || placement.anchorY > maxY) continue;
          placements.push({
            assetId: placement.asset.id,
            families: placement.asset.families,
            siteX: placement.siteX,
            siteY: placement.siteY,
            anchorX: placement.anchorX,
            anchorY: placement.anchorY,
          });
        }
      }
    }
    return placements.sort((a, b) => a.anchorY - b.anchorY || a.anchorX - b.anchorX ||
      a.assetId.localeCompare(b.assetId));
  }

  override destroy(): void {
    this.blockCache.clear();
    this.compositor.clear();
    super.destroy();
  }

  private blocksNear(worldX: number, worldY: number): CachedBlock[] {
    const blocks: CachedBlock[] = [];
    const firstBlockX = floorDiv(worldX - this.placementMaxOffsetX, this.blockSize);
    const lastBlockX = floorDiv(worldX - this.placementMinOffsetX, this.blockSize);
    const firstBlockY = floorDiv(worldY - this.placementMaxOffsetY, this.blockSize);
    const lastBlockY = floorDiv(worldY - this.placementMinOffsetY, this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) {
        blocks.push(this.getBlock(blockX, blockY));
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
    const landmarkSites = this.routes.getLandmarkSites?.(
      originX,
      originY,
      originX + this.blockSize - 1,
      originY + this.blockSize - 1,
    );
    if (landmarkSites) {
      for (const site of landmarkSites) {
        const placement = this.createPlacement(site.x, site.y);
        if (placement) placements.push(placement);
      }
    } else {
      for (let y = originY; y < originY + this.blockSize; y++) {
        for (let x = originX; x < originX + this.blockSize; x++) {
          const placement = this.createPlacement(x, y);
          if (placement) placements.push(placement);
        }
      }
    }
    placements.push(...this.buildAmbientPlacements(originX, originY));

    const overlays = new Map<string, BuildingTileData>();
    const solid = new Set<string>();
    for (const placement of placements) {
      const offsetX = Math.floor(placement.asset.sprite.width / 2);
      const offsetY = placement.asset.sprite.height - 1;
      for (let tileY = 0; tileY < placement.asset.sprite.height; tileY++) {
        for (let tileX = 0; tileX < placement.asset.sprite.width; tileX++) {
          const tile = placement.asset.sprite.tiles[tileY]?.[tileX];
          if (!tile || !hasVisiblePixels(tile)) continue;
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
    return anchor ? { asset, kind: 'landmark', siteX, siteY, ...anchor } : null;
  }

  private buildAmbientPlacements(originX: number, originY: number): Placement[] {
    if (this.ambient.length === 0 || this.ambientDensity <= 0) return [];
    const placements: Placement[] = [];
    const firstCellX = floorDiv(originX, this.ambientCellSize) - 1;
    const lastCellX = floorDiv(originX + this.blockSize - 1, this.ambientCellSize) + 1;
    const firstCellY = floorDiv(originY, this.ambientCellSize) - 1;
    const lastCellY = floorDiv(originY + this.blockSize - 1, this.ambientCellSize) + 1;
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const candidate = this.ambientCandidate(cellX, cellY);
        if (candidate.x < originX || candidate.x >= originX + this.blockSize ||
            candidate.y < originY || candidate.y >= originY + this.blockSize ||
            !this.isAmbientPriorityMaximum(cellX, cellY) ||
            this.hashUnit(cellX, cellY, 0x4d17) > this.ambientDensity) continue;
        const route = this.routes.sample(candidate.x, candidate.y);
        if (route.landmarkDistance < this.ambientLandmarkClearance) continue;
        const biome = this.field.sample(candidate.x, candidate.y);
        const asset = this.selectAmbientAsset(candidate.x, candidate.y, biome, route);
        if (!asset || !this.assetFits(candidate.x, candidate.y, asset)) continue;
        placements.push({
          asset,
          kind: 'ambient',
          siteX: candidate.x,
          siteY: candidate.y,
          anchorX: candidate.x,
          anchorY: candidate.y,
        });
      }
    }
    return placements;
  }

  private ambientCandidate(cellX: number, cellY: number): { x: number; y: number } {
    const inset = 0.12;
    const span = 1 - inset * 2;
    return {
      x: Math.floor((cellX + inset + this.hashUnit(cellX, cellY, 0x2d91) * span) * this.ambientCellSize),
      y: Math.floor((cellY + inset + this.hashUnit(cellX, cellY, 0x6b35) * span) * this.ambientCellSize),
    };
  }

  private isAmbientPriorityMaximum(cellX: number, cellY: number): boolean {
    const priority = this.hashUnit(cellX, cellY, 0x7f21);
    for (let offsetY = -2; offsetY <= 2; offsetY++) {
      for (let offsetX = -2; offsetX <= 2; offsetX++) {
        if ((offsetX === 0 && offsetY === 0) || Math.abs(offsetX) + Math.abs(offsetY) > 2) continue;
        const neighbour = this.hashUnit(cellX + offsetX, cellY + offsetY, 0x7f21);
        if (neighbour > priority || (neighbour === priority &&
            (offsetY < 0 || (offsetY === 0 && offsetX < 0)))) return false;
      }
    }
    return true;
  }

  private selectAmbientAsset(
    worldX: number,
    worldY: number,
    biome: BiomeWorldSample,
    route: RegionalRouteSample,
  ): RegionalAmbientAsset | null {
    const eligible: Array<{ asset: RegionalAmbientAsset; compatibility: number }> = [];
    for (const asset of this.ambient) {
      const [minimumRouteDistance, maximumRouteDistance] = asset.routeDistance;
      if (route.distance < minimumRouteDistance ||
          (maximumRouteDistance < 999 && route.distance > maximumRouteDistance)) continue;
      const compatibility = Math.max(...asset.families.map((family) => (
        biome.weights[BIOME_FAMILIES.indexOf(family)] ?? 0
      )));
      eligible.push({ asset, compatibility });
    }
    if (eligible.length === 0) return null;
    const strongest = Math.max(...eligible.map((candidate) => candidate.compatibility));
    const variants = eligible
      .filter((candidate) => Math.abs(candidate.compatibility - strongest) < 1e-7)
      .map((candidate) => candidate.asset)
      .sort((a, b) => a.id.localeCompare(b.id));
    const cellX = floorDiv(worldX, this.ambientCellSize);
    const cellY = floorDiv(worldY, this.ambientCellSize);
    const variantIndex = positiveMod(cellX * 3 + cellY * 5 + this.seed32, variants.length);
    return variants[variantIndex] ?? null;
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

  private assetFits(anchorX: number, anchorY: number, asset: RegionalVisualAsset): boolean {
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

function positiveMod(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function hasVisiblePixels(tile: BuildingTileData): boolean {
  const cached = VISIBLE_TILE_CACHE.get(tile);
  if (cached !== undefined) return cached;
  const visible = tile.pixels.some((row) => row.some((pixel) => pixel !== null));
  VISIBLE_TILE_CACHE.set(tile, visible);
  return visible;
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
