import { describe, expect, it } from 'vitest';
import type { DirectionFrames, PixelGrid, Sprite, Tile, WorldDataProvider } from '@maldoror/protocol';
import { ViewportRenderer } from '../pixel/viewport-renderer.js';

const ground = { r: 210, g: 190, b: 150 };
const actor = { r: 20, g: 60, b: 180 };
const solid = (size: number, color: typeof ground): PixelGrid =>
  Array.from({ length: size }, () => Array.from({ length: size }, () => color));

describe('entity semantic LOD', () => {
  it('enlarges a character but keeps its feet on the authoritative tile', () => {
    const terrain: Tile = { id: 'ground', name: 'ground', walkable: true, pixels: solid(8, ground) };
    const frame = solid(4, actor);
    const frames = [frame, frame, frame, frame] as DirectionFrames;
    const sprite: Sprite = {
      width: 4,
      height: 4,
      frames: { up: frames, down: frames, left: frames, right: frames },
    };
    const world: WorldDataProvider = {
      getTile: () => terrain,
      getPlayers: () => [{
        userId: 'local', username: '', x: 0, y: 0, direction: 'down',
        animationFrame: 0, isMoving: false,
      }],
      getPlayerSprite: () => sprite,
      getLocalPlayerId: () => 'local',
    };
    const renderer = new ViewportRenderer({
      widthTiles: 3,
      heightTiles: 3,
      pixelWidth: 24,
      pixelHeight: 24,
      tileRenderSize: 8,
      dataResolution: 4,
    });
    renderer.setCamera(0, 0);

    const buffer = renderer.renderToBuffer(world, 0).buffer;
    const actorPixels: Array<[number, number]> = [];
    for (let y = 0; y < buffer.length; y++) {
      for (let x = 0; x < buffer[y]!.length; x++) {
        const pixel = buffer[y]![x];
        if (pixel?.r === actor.r && pixel.g === actor.g && pixel.b === actor.b) actorPixels.push([x, y]);
      }
    }

    expect(actorPixels).toHaveLength(100);
    expect(Math.min(...actorPixels.map(([x]) => x))).toBe(7);
    expect(Math.max(...actorPixels.map(([x]) => x))).toBe(16);
    expect(Math.min(...actorPixels.map(([, y]) => y))).toBe(6);
    expect(Math.max(...actorPixels.map(([, y]) => y))).toBe(15);
    const grounded = buffer.flatMap((row) => row).some((pixel) =>
      pixel !== null && pixel.r < ground.r && pixel.g < ground.g && pixel.b < ground.b,
    );
    expect(grounded).toBe(true);
  });

  it('composites authored actor edge coverage over terrain in linear light', () => {
    const black = { r: 0, g: 0, b: 0 };
    const terrain: Tile = { id: 'ground', name: 'ground', walkable: true, pixels: solid(2, black) };
    const frame: PixelGrid = [[{ r: 255, g: 255, b: 255, a: 128 }]];
    const frames = [frame, frame, frame, frame] as DirectionFrames;
    const sprite: Sprite = {
      width: 1,
      height: 1,
      frames: { up: frames, down: frames, left: frames, right: frames },
    };
    const world: WorldDataProvider = {
      getTile: () => terrain,
      getPlayers: () => [{
        userId: 'local', username: '', x: 0, y: 0, direction: 'down',
        animationFrame: 0, isMoving: false,
      }],
      getPlayerSprite: () => sprite,
      getLocalPlayerId: () => 'local',
    };
    const renderer = new ViewportRenderer({
      widthTiles: 3,
      heightTiles: 3,
      pixelWidth: 6,
      pixelHeight: 6,
      tileRenderSize: 2,
      dataResolution: 1,
    });
    renderer.setCamera(0, 0);

    const rendered = renderer.renderToBuffer(world, 0).buffer.flat();
    expect(rendered.some((pixel) => pixel?.r === 188 && pixel.g === 188 && pixel.b === 188)).toBe(true);
    expect(rendered.some((pixel) => pixel?.r === 255 && pixel.g === 255 && pixel.b === 255)).toBe(false);
  });

  it('makes a cached NPC activity phase visible through its presentation name', () => {
    const terrain: Tile = {
      id: 'ground',
      name: 'ground',
      walkable: true,
      pixels: solid(16, ground),
    };
    const frame = solid(4, actor);
    const frames = [frame, frame, frame, frame] as DirectionFrames;
    const sprite: Sprite = {
      width: 4,
      height: 4,
      frames: { up: frames, down: frames, left: frames, right: frames },
    };
    const render = (name: string) => {
      const world: WorldDataProvider = {
        getTile: () => terrain,
        getPlayers: () => [],
        getPlayerSprite: () => null,
        getLocalPlayerId: () => '',
        getNPCs: () => [{
          npcId: 'visible-worker',
          name,
          x: 0,
          y: 0,
          direction: 'down',
          animationFrame: 0,
          isMoving: false,
          role: 'maker',
          activity: 'work',
        }],
        getNPCSprite: () => sprite,
      };
      const renderer = new ViewportRenderer({
        widthTiles: 10,
        heightTiles: 5,
        pixelWidth: 160,
        pixelHeight: 80,
        tileRenderSize: 16,
        dataResolution: 4,
      });
      renderer.setCamera(0, 0);
      return renderer.renderToBuffer(world, 0).overlays;
    };

    const traveling = render('Keeper · traveling');
    const engaged = render('Keeper · engaged');
    expect(traveling).toContainEqual(expect.objectContaining({
      text: 'Keeper · traveling | maker work',
    }));
    expect(engaged).toContainEqual(expect.objectContaining({
      text: 'Keeper · engaged | maker work',
    }));
    expect(traveling).not.toEqual(engaged);
  });
});
