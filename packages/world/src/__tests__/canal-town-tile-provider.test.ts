import { describe, expect, it } from 'vitest';
import type { BuildingSprite, RGB } from '@maldoror/protocol';
import {
  CanalTownTileProvider,
  type CanalTownAsset,
} from '../tiles/canal-town-tile-provider.js';

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

describe('CanalTownTileProvider', () => {
  it('continues canals and walkable bridge decks across signed block coordinates', () => {
    const world = provider();
    expect(world.getTile(0, 0)?.walkable).toBe(false);
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
});
