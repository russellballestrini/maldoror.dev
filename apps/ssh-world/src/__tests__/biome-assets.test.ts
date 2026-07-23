import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOME_FAMILIES } from '@maldoror/world';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalLandmarkKit,
  loadRegionalRouteMaterialKit,
} from '../game/biome-assets.js';

describe('regional biome material manifest', () => {
  it('loads all six authored families into shared bounded source tiles', async () => {
    const kit = await loadRegionalBiomeMaterialKit(path.resolve('assets/biomes/manifest.json'));
    expect(kit.sourceTileSize).toBe(96);
    expect(kit.tiles).toHaveLength(24);
    for (const family of BIOME_FAMILIES) {
      expect(kit.materials[family]).toHaveLength(4);
      for (const tile of kit.materials[family]) {
        expect(tile.pixels).toHaveLength(96);
        expect(tile.pixels[0]).toHaveLength(96);
      }
    }
    expect(kit.materials.coast.every((tile) => tile.material === 'water' && !tile.walkable)).toBe(true);
  });

  it('loads route and bridge surfaces from closed manifest semantics', async () => {
    const kit = await loadRegionalRouteMaterialKit(path.resolve('assets/routes/manifest.json'));
    expect(kit.sourceTileSize).toBe(96);
    expect(kit.tiles).toHaveLength(16);
    expect(Object.keys(kit.routeMaterials).sort()).toEqual(['arterial', 'local-road', 'trail']);
    for (const tiles of Object.values(kit.routeMaterials)) {
      expect(tiles).toHaveLength(4);
      expect(tiles.every((tile) => tile.walkable && tile.pixels.length === 96)).toBe(true);
    }
    expect(kit.crossingMaterials.bridge).toHaveLength(4);
    expect(kit.crossingMaterials.ferry).toBeUndefined();
  });

  it('loads six alpha-keyed landmark clusters with explicit collision thresholds', async () => {
    const kit = await loadRegionalLandmarkKit(path.resolve('assets/biomes/landmarks-manifest.json'));
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.assets).toHaveLength(6);
    expect(new Set(kit.assets.flatMap((asset) => asset.families))).toEqual(new Set(BIOME_FAMILIES));
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(5);
      expect(asset.collision).not.toContainEqual([0, 0]);
      const pixels = asset.sprite.tiles.flatMap((row) => row.flatMap((tile) => tile.pixels.flat()));
      expect(pixels.some((pixel) => pixel === null)).toBe(true);
      expect(pixels.some((pixel) => pixel !== null)).toBe(true);
      expect(pixels.some((pixel) => pixel !== null && pixel.a !== undefined && pixel.a > 0 && pixel.a < 255)).toBe(true);
    }
  });

  it('loads twelve soft-alpha ambient masses with explicit world constraints', async () => {
    const kit = await loadRegionalAmbientKit(path.resolve('assets/biomes/ambient-manifest.json'));
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.cellSize).toBe(4);
    expect(kit.density).toBeCloseTo(0.86);
    expect(kit.assets).toHaveLength(12);
    expect(new Set(kit.assets.flatMap((asset) => asset.families))).toEqual(new Set(BIOME_FAMILIES));
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(5);
      expect(asset.sprite.height).toBe(4);
      expect(asset.routeDistance[0]).toBeGreaterThanOrEqual(2);
      const pixels = asset.sprite.tiles.flatMap((row) => row.flatMap((tile) => tile.pixels.flat()));
      expect(pixels.some((pixel) => pixel === null)).toBe(true);
      expect(pixels.some((pixel) => pixel !== null && pixel.a !== undefined && pixel.a < 255)).toBe(true);
    }
  });
});
