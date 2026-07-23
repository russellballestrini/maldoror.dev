import { describe, expect, it } from 'vitest';
import type { BuildingSprite, RGB } from '@maldoror/protocol';
import {
  CanalTownTileProvider,
  type CanalTownAsset,
} from '../tiles/canal-town-tile-provider.js';
import { CanalMaterialCompositor } from '../tiles/canal-material-compositor.js';

function sprite(color: RGB): BuildingSprite {
  return {
    width: 3,
    height: 3,
    tiles: Array.from({ length: 3 }, () =>
      Array.from({ length: 3 }, () => ({
        pixels: [[color]],
        resolutions: { '1': [[color]] },
      }))),
  };
}

const assets: CanalTownAsset[] = [
  { id: 'house-a', roles: ['building'], sprite: sprite({ r: 200, g: 100, b: 50 }), collision: [[0, 0]] },
  { id: 'house-b', roles: ['building'], sprite: sprite({ r: 80, g: 120, b: 200 }), collision: [[0, 0]] },
  { id: 'bridge', roles: ['bridge'], sprite: sprite({ r: 220, g: 220, b: 190 }), collision: [] },
];

function provider(seed = 42n): CanalTownTileProvider {
  return new CanalTownTileProvider({
    worldSeed: seed,
    assets,
    terrain: { water: ['water'], paving: ['stone'], garden: ['grass'], curb: {} },
    blockSize: 24,
  });
}

function texture(id: string, color: RGB) {
  const pixels = Array.from({ length: 8 }, () => Array(8).fill(color));
  return { id, name: id, pixels, resolutions: { '8': pixels }, walkable: id !== 'water' };
}

describe('CanalTownTileProvider', () => {
  it('continues canals and walkable bridge decks across signed block coordinates', () => {
    const world = provider();
    expect(world.getTile(0, 0)?.walkable).toBe(true);
    expect(world.getTile(0, 0)?.id).toContain('bridge-deck');
    expect(world.getTile(7, 0)?.walkable).toBe(true);
    expect(world.getTile(-24, 0)?.walkable).toBe(false);
    expect(world.getTile(1, 12)?.walkable).toBe(true);
    expect(world.getTile(1, 12)?.id).toContain('bridge-deck');
    expect(world.getTile(-23, 12)?.walkable).toBe(true);
    expect(world.getTile(10, 12)?.walkable).toBe(false);
    expect(world.getTile(14, 12)?.walkable).toBe(true);
  });

  it('places manifest assets deterministically with independent collision masks', () => {
    const a = provider();
    const b = provider();
    const buildingA = a.getBuildingTileAt(9, 8);
    const buildingB = b.getBuildingTileAt(9, 8);

    expect(buildingA?.pixels[0]?.[0]).toEqual(buildingB?.pixels[0]?.[0]);
    expect(a.isBuildingAt(9, 8)).toBe(true);
    expect(a.getBuildingTileAt(3, 12)).not.toBeNull();
    expect(a.isBuildingAt(3, 12)).toBe(false);
  });

  it('uses the shared material compositor at canal boundaries without changing bridge decks', () => {
    const materialCompositor = new CanalMaterialCompositor({
      worldSeed: 42n,
      water: [texture('water', { r: 15, g: 105, b: 145 })],
      paving: [texture('paving', { r: 205, g: 185, b: 145 })],
      edge: [texture('edge', { r: 135, g: 125, b: 105 })],
      maxCachedTiles: 16,
    });
    const world = new CanalTownTileProvider({
      worldSeed: 42n,
      assets,
      terrain: { water: ['water'], paving: ['stone'], garden: ['grass'], curb: {} },
      blockSize: 24,
      materialCompositor,
    });

    const transition = Array.from({ length: 24 }, (_, x) => world.getTile(x, 4))
      .find((tile) => tile?.id.startsWith('canal-material-blend:'));
    expect(transition?.materialMask).toBeDefined();
    expect(materialCompositor.getStats().cachedTiles).toBeGreaterThan(0);
    expect(world.getTile(0, 0)?.id).toContain('bridge-deck');
    expect(world.getTile(0, 0)?.materialMask).toBeUndefined();
  });
});
