import { describe, expect, it } from 'vitest';
import type { BuildingTileData, Tile, WorldDataProvider } from '@maldoror/protocol';
import { ViewportRenderer } from '../pixel/viewport-renderer.js';

describe('ViewportRenderer building alpha', () => {
  it('composites authored coverage over terrain in linear light', () => {
    const terrainPixels = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () => ({ r: 0, g: 0, b: 0 })));
    const terrain: Tile = {
      id: 'black',
      name: 'black',
      pixels: terrainPixels,
      resolutions: { '2': terrainPixels },
      walkable: true,
    };
    const overlayPixels = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () => ({ r: 255, g: 255, b: 255, a: 128 })));
    const overlay: BuildingTileData = {
      pixels: overlayPixels,
      resolutions: { '2': overlayPixels },
    };
    const world: WorldDataProvider = {
      getTile: () => terrain,
      getBuildingTileAt: () => overlay,
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

    expect(renderer.renderToBuffer(world, 0).buffer.flat()).toEqual(
      Array(4).fill({ r: 188, g: 188, b: 188 }),
    );
  });
});
