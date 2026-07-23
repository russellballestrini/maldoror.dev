import { describe, expect, it } from 'vitest';
import type { Tile, WorldDataProvider } from '@maldoror/protocol';
import { ViewportRenderer } from '../pixel/viewport-renderer.js';

describe('ViewportRenderer material masks', () => {
  it('preserves per-pixel water ownership instead of painting the whole tile as water', () => {
    const pixels = [
      [{ r: 20, g: 90, b: 130 }, { r: 190, g: 170, b: 130 }],
      [{ r: 190, g: 170, b: 130 }, { r: 190, g: 170, b: 130 }],
    ];
    const tile: Tile = {
      id: 'material-transition',
      name: 'material transition',
      pixels,
      material: 'water',
      materialMask: [new Uint8Array([1, 0]), new Uint8Array([0, 0])],
      walkable: true,
    };
    const world: WorldDataProvider = {
      getTile: () => tile,
      getPlayers: () => [],
      getPlayerSprite: () => null,
      getLocalPlayerId: () => 'local',
    };
    const renderer = new ViewportRenderer({
      widthTiles: 1,
      heightTiles: 1,
      pixelWidth: 2,
      pixelHeight: 2,
      tileRenderSize: 2,
      dataResolution: 2,
    });
    renderer.setCamera(0, 0);

    const materialGrid = renderer.renderToBuffer(world, 0).materialGrid!;
    const waterPixels = materialGrid.flatMap((row) => [...row]).filter((value) => value > 0);
    expect(waterPixels).toHaveLength(1);
    expect(materialGrid[0]![0]).toBeGreaterThan(0);
    expect(materialGrid[0]![1]).toBe(0);
    expect(materialGrid[1]![0]).toBe(0);
    expect(materialGrid[1]![1]).toBe(0);
  });

  it('requests procedural terrain at the visible screen resolution', () => {
    const pixels = [
      [{ r: 30, g: 60, b: 90 }, { r: 30, g: 60, b: 90 }],
      [{ r: 30, g: 60, b: 90 }, { r: 30, g: 60, b: 90 }],
    ];
    const tile: Tile = {
      id: 'demand-driven-terrain@2',
      name: 'demand-driven terrain',
      pixels,
      walkable: true,
      resolutions: { '2': pixels },
    };
    const requestedResolutions: number[] = [];
    let fallbackCalls = 0;
    const world: WorldDataProvider = {
      getTile: () => {
        fallbackCalls++;
        return tile;
      },
      getTileAtResolution: (_x, _y, resolution) => {
        requestedResolutions.push(resolution);
        return tile;
      },
      getPlayers: () => [],
      getPlayerSprite: () => null,
      getLocalPlayerId: () => 'local',
    };
    const renderer = new ViewportRenderer({
      widthTiles: 1,
      heightTiles: 1,
      pixelWidth: 2,
      pixelHeight: 2,
      tileRenderSize: 2,
      dataResolution: 2,
    });
    renderer.setCamera(0, 0);

    renderer.renderToBuffer(world, 0);

    expect(requestedResolutions.length).toBeGreaterThan(0);
    expect(new Set(requestedResolutions)).toEqual(new Set([2]));
    expect(fallbackCalls).toBe(0);
  });
});
