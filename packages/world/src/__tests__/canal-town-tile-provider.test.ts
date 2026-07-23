import { describe, expect, it } from 'vitest';
import type { BuildingSprite, RGB } from '@maldoror/protocol';
import {
  CanalTownTileProvider,
  type CanalTownAsset,
} from '../tiles/canal-town-tile-provider.js';
import { CanalTownWorldField } from '../tiles/canal-town-world-field.js';
import { CanalMaterialCompositor } from '../tiles/canal-material-compositor.js';
import { CornerCodedTileSet } from '../tiles/corner-coded-tile-set.js';

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
  it('uses one continuous field for signed-coordinate water and bridge decks', () => {
    const world = provider();
    const field = new CanalTownWorldField(42n);
    expect(world.getTile(0, 0)?.walkable).toBe(true);
    expect(world.getTile(0, 0)?.id).not.toContain('water');

    const waterCells: Array<readonly [number, number]> = [];
    for (let y = -120; y <= 120; y += 12) {
      for (let x = -24; x <= 24; x++) {
        const sample = field.sample(x, y);
        if (sample.isWater && !sample.isBridge) {
          waterCells.push([x, y]);
          break;
        }
      }
    }
    expect(waterCells.length).toBeGreaterThan(12);
    for (const [x, y] of waterCells) expect(world.getTile(x, y)?.walkable).toBe(false);
  });

  it('places manifest assets deterministically with independent collision masks', () => {
    const a = provider();
    const b = provider();
    let collisionPoint: readonly [number, number] | undefined;
    for (let y = -72; y <= 72 && !collisionPoint; y++) {
      for (let x = -72; x <= 72; x++) {
        if (a.isBuildingAt(x, y)) {
          collisionPoint = [x, y];
          break;
        }
      }
    }
    expect(collisionPoint).toBeDefined();
    const [x, y] = collisionPoint!;
    const buildingA = a.getBuildingTileAt(x, y);
    const buildingB = b.getBuildingTileAt(x, y);

    expect(buildingA?.pixels[0]?.[0]).toEqual(buildingB?.pixels[0]?.[0]);
    expect(a.isBuildingAt(x, y)).toBe(true);
    let visualOnlyPoint: readonly [number, number] | undefined;
    for (let yy = -24; yy <= 0 && !visualOnlyPoint; yy++) {
      for (let xx = -24; xx <= 24; xx++) {
        if (a.getBuildingTileAt(xx, yy) && !a.isBuildingAt(xx, yy)) {
          visualOnlyPoint = [xx, yy];
          break;
        }
      }
    }
    expect(visualOnlyPoint).toBeDefined();
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
    expect(world.getTile(0, 0)?.walkable).toBe(true);
    expect(world.getTile(0, 0)?.materialMask).toBeUndefined();
  });

  it('uses the corner-coded atlas for uniform paving interiors', () => {
    const paving = texture('corner-paving', { r: 211, g: 188, b: 145 });
    const cornerPaving = new CornerCodedTileSet({
      worldSeed: 42n,
      cornerColours: 2,
      tilesByCombination: Array.from({ length: 16 }, () => [paving]),
    });
    const world = new CanalTownTileProvider({
      worldSeed: 42n,
      assets,
      terrain: { water: ['water'], paving: ['stone'], garden: ['grass'], curb: {} },
      blockSize: 24,
      cornerTerrain: { paving: cornerPaving },
    });

    expect(world.getTile(10, 4)?.id).toBe('corner-paving');
    expect(world.getTile(4, 4)?.id).not.toBe('corner-paving');
  });
});
