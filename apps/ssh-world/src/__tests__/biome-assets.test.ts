import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOME_FAMILIES } from '@maldoror/world';
import {
  loadRegionalBiomeMaterialKit,
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
});
