import { describe, expect, it } from 'vitest';
import type {
  BuildingTileData,
  DirectionFrames,
  PixelGrid,
  Sprite,
  Tile,
  WorldDataProvider,
} from '@maldoror/protocol';
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

  it('renders transferred packed terrain and overlay pixels exactly like object grids', () => {
    const terrain: Tile = {
      id: 'packed-black',
      name: 'packed black',
      pixels: [],
      packedPixels: {
        width: 2,
        height: 2,
        data: new Uint8Array([
          0, 0, 0, 255, 0, 0, 0, 255,
          0, 0, 0, 255, 0, 0, 0, 255,
        ]),
      },
      walkable: true,
    };
    const overlay: BuildingTileData = {
      pixels: [],
      resolutions: {},
      packedPixels: {
        width: 2,
        height: 2,
        data: new Uint8Array([
          255, 255, 255, 128, 255, 255, 255, 128,
          255, 255, 255, 128, 255, 255, 255, 128,
        ]),
      },
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

  it('shares only the static scene across colocated renderers', () => {
    const ground = { r: 34, g: 78, b: 51 };
    const actor = { r: 211, g: 62, b: 71 };
    const terrainPixels: PixelGrid = Array.from({ length: 2 }, () =>
      Array.from({ length: 2 }, () => ground));
    const terrain: Tile = {
      id: 'shared-ground',
      name: 'shared ground',
      pixels: terrainPixels,
      resolutions: { '2': terrainPixels },
      walkable: true,
    };
    const actorFrame: PixelGrid = [[actor]];
    const directionFrames = [actorFrame, actorFrame, actorFrame, actorFrame] as DirectionFrames;
    const sprite: Sprite = {
      width: 1,
      height: 1,
      frames: {
        up: directionFrames,
        down: directionFrames,
        left: directionFrames,
        right: directionFrames,
      },
    };
    const identity = {};
    let firstTileReads = 0;
    let secondTileReads = 0;
    const world = (withActor: boolean, count: () => void): WorldDataProvider => ({
      getStaticRenderIdentity: () => identity,
      getStaticRenderEpoch: () => 0,
      getTile: () => {
        count();
        return terrain;
      },
      getPlayers: () => withActor ? [{
        userId: 'local', username: '', x: 0, y: 0, direction: 'down',
        animationFrame: 0, isMoving: false,
      }] : [],
      getPlayerSprite: () => withActor ? sprite : null,
      getLocalPlayerId: () => 'local',
    });
    const config = {
      widthTiles: 1,
      heightTiles: 1,
      pixelWidth: 2,
      pixelHeight: 2,
      tileRenderSize: 2,
      dataResolution: 2,
    };
    const first = new ViewportRenderer(config);
    first.setCamera(0, 0);
    first.renderToBuffer(world(false, () => firstTileReads++), 1);

    const second = new ViewportRenderer(config);
    second.setCamera(0, 0);
    const secondBuffer = second.renderToBuffer(world(true, () => secondTileReads++), 61).buffer;

    expect(firstTileReads).toBeGreaterThan(0);
    expect(secondTileReads).toBe(0);
    expect(secondBuffer.flat().some((pixel) =>
      pixel?.r === actor.r && pixel.g === actor.g && pixel.b === actor.b,
    )).toBe(true);
  });
});
