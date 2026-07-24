import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOME_FAMILIES } from '@maldoror/world';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalRouteMaterialKit,
  loadRegionalRouteContactKit,
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

  it('loads paired authored route-contact axes for every biome family', async () => {
    const kit = await loadRegionalRouteContactKit(
      path.resolve('assets/biomes/route-contacts-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.cellSize).toBe(10);
    expect(kit.density).toBe(1);
    expect(kit.assets).toHaveLength(12);
    for (const family of BIOME_FAMILIES) {
      const familyAssets = kit.assets.filter((asset) => asset.families.includes(family));
      expect(new Set(familyAssets.map((asset) => asset.accessAxis)))
        .toEqual(new Set(['north-south', 'east-west']));
    }
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(6);
      expect(asset.spriteAnchor).toEqual([3, 3]);
      expect(asset.collision).not.toContainEqual([0, 0]);
      const pixels = asset.sprite.tiles.flatMap((row) => row.flatMap((tile) => tile.pixels.flat()));
      expect(pixels.some((pixel) => pixel === null)).toBe(true);
      expect(pixels.some((pixel) => pixel !== null && pixel.a !== undefined && pixel.a < 255)).toBe(true);
    }
  });

  it('loads explicit modular parcel masses for every biome family', async () => {
    const [kit, ambient] = await Promise.all([
      loadRegionalParcelComponentKit(path.resolve('assets/biomes/parcel-components-manifest.json')),
      loadRegionalAmbientKit(path.resolve('assets/biomes/ambient-manifest.json')),
    ]);
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.minimumLayers).toBe(2);
    expect(kit.maximumLayers).toBe(3);
    expect(kit.layerSpacing).toBe(5);
    expect(kit.assets).toHaveLength(36);
    for (const family of BIOME_FAMILIES) {
      expect(kit.assets.filter((asset) => asset.families.includes(family))).toHaveLength(6);
    }
    for (const asset of kit.assets) {
      expect(asset.role).toBe('mass');
      expect(asset.sprite.width).toBe(5);
      expect(asset.sprite.height).toBe(4);
      expect(asset.collision.length).toBeGreaterThan(0);
    }
    expect(kit.assets.find((asset) => asset.id === 'canal-town-facade-parcel-mass-v1')?.sprite)
      .toBe(ambient.assets.find((asset) => asset.id === 'canal-town-facade-planter-v2')?.sprite);
  });

  it('loads coast and highland contacts with explicit physical envelopes', async () => {
    const kit = await loadRegionalEnvironmentContactKit(
      path.resolve('assets/biomes/environment-contacts-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.cellSize).toBe(18);
    expect(kit.density).toBeCloseTo(0.72);
    expect(kit.assets).toHaveLength(8);
    expect(new Set(kit.assets.flatMap((asset) => asset.families)))
      .toEqual(new Set(['coast', 'mountain']));
    for (const asset of kit.assets) {
      expect(asset.role).toBe('environment-contact');
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(6);
      expect(asset.constraints.landOnly).toBe(true);
      expect(asset.constraints.waterDistance[1]).toBeGreaterThanOrEqual(
        asset.constraints.waterDistance[0],
      );
      const pixels = asset.sprite.tiles.flatMap((row) => row.flatMap((tile) => tile.pixels.flat()));
      expect(pixels.some((pixel) => pixel === null)).toBe(true);
      expect(pixels.some((pixel) => pixel !== null)).toBe(true);
    }
  });
});
