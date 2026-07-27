import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import type {
  DirectionFrames,
  PixelGrid,
  Sprite,
  Tile,
  WorldDataProvider,
  WorldLifeState,
  WorldLightSource,
} from '@maldoror/protocol';
import { ViewportRenderer } from '../pixel/viewport-renderer.js';
import { PixelGameRenderer } from '../pixel/pixel-game-renderer.js';

const terrain: Tile = {
  id: 'atmosphere-ground',
  name: 'atmosphere ground',
  walkable: true,
  pixels: [
    [{ r: 180, g: 150, b: 110 }, { r: 180, g: 150, b: 110 }],
    [{ r: 180, g: 150, b: 110 }, { r: 180, g: 150, b: 110 }],
  ],
};

function world(
  life: WorldLifeState,
  options: { tile?: Tile; lights?: WorldLightSource[]; staticIdentity?: object } = {},
): WorldDataProvider {
  return {
    getStaticRenderIdentity: options.staticIdentity
      ? () => options.staticIdentity!
      : undefined,
    getStaticRenderEpoch: options.staticIdentity ? () => 0 : undefined,
    getTile: () => options.tile ?? terrain,
    getPlayers: () => [],
    getPlayerSprite: () => null,
    getLocalPlayerId: () => 'local',
    getWorldLifeState: () => life,
    getLightSourcesInBounds: () => options.lights ?? [],
  };
}

function state(worldMinute: number, weather: WorldLifeState['weather']): WorldLifeState {
  return {
    worldId: 'primary',
    worldSeed: 'atmosphere-proof',
    worldMinute,
    weather,
    weatherIntensity: 0.9,
    weatherUntilWorldMinute: worldMinute + 100,
    season: 'summer',
    rngState: 1234,
    surfaceWetness: 0.12,
    waterTurbulence: 0.08,
    vegetationVitality: 0.72,
    decayPressure: 0.1,
  };
}

function renderer(): ViewportRenderer {
  const value = new ViewportRenderer({
    widthTiles: 4,
    heightTiles: 4,
    pixelWidth: 24,
    pixelHeight: 16,
    tileRenderSize: 2,
    dataResolution: 2,
  });
  value.setCamera(0, 0);
  return value;
}

function meanLuminance(buffer: ReturnType<ViewportRenderer['renderToBuffer']>['buffer']): number {
  const pixels = buffer.flat().filter((pixel) => pixel !== null);
  return pixels.reduce((sum, pixel) => sum + pixel!.r + pixel!.g + pixel!.b, 0) / pixels.length / 3;
}

describe('persistent world atmosphere', () => {
  it('makes the same authored material visibly darker at midnight than noon', () => {
    const authoredSample = structuredClone(terrain.pixels[0]![0]);
    const noon = renderer().renderToBuffer(world(state(720, 'clear')), 0).buffer;
    const midnight = renderer().renderToBuffer(world(state(0, 'clear')), 0).buffer;
    expect(meanLuminance(midnight)).toBeLessThan(meanLuminance(noon) * 0.5);
    expect(meanLuminance(midnight)).toBeGreaterThan(meanLuminance(noon) * 0.4);
    expect(terrain.pixels[0]![0]).toEqual(authoredSample);
  });

  it('adds deterministic storm streaks while retaining a coherent cool grade', () => {
    const first = renderer().renderToBuffer(world(state(780, 'storm')), 31).buffer;
    const replay = renderer().renderToBuffer(world(state(780, 'storm')), 31).buffer;
    const clear = renderer().renderToBuffer(world(state(780, 'clear')), 31).buffer;
    const visible = first.flat().filter((pixel) => pixel !== null);
    const strongCoolStreaks = visible.filter(
      (pixel) => pixel!.b > pixel!.r + 20 && pixel!.b > pixel!.g + 8,
    );

    expect(first).toEqual(replay);
    expect(first).not.toEqual(clear);
    expect(first.flat().filter((pixel) => pixel?.b && pixel.b > pixel.r).length).toBeGreaterThan(0);
    expect(strongCoolStreaks.length / visible.length).toBeLessThan(0.1);
  });

  it('carries prior rain into darker, sparsely reflective dry-weather surfaces', () => {
    const dry = renderer().renderToBuffer(world({
      ...state(720, 'clear'),
      surfaceWetness: 0,
    }), 11).buffer;
    const wet = renderer().renderToBuffer(world({
      ...state(720, 'clear'),
      surfaceWetness: 0.95,
    }), 11).buffer;

    expect(meanLuminance(wet)).toBeLessThan(meanLuminance(dry) * 0.9);
    expect(wet).not.toEqual(dry);
  });

  it('changes only declared foliage with season and keeps authored pixels immutable', () => {
    const foliage: Tile = { ...terrain, id: 'foliage', material: 'foliage' };
    const authoredSample = structuredClone(foliage.pixels[0]![0]);
    const summer = renderer().renderToBuffer(world({
      ...state(720, 'clear'),
      season: 'summer',
    }, { tile: foliage }), 0).buffer;
    const autumn = renderer().renderToBuffer(world({
      ...state(720, 'clear'),
      season: 'autumn',
      decayPressure: 0.8,
    }, { tile: foliage }), 0).buffer;

    expect(autumn).not.toEqual(summer);
    expect(foliage.pixels[0]![0]).toEqual(authoredSample);
  });

  it('turns declarative lamps into bounded warm night pools without guessing pixels', () => {
    const night = state(0, 'clear');
    const light: WorldLightSource = {
      id: 'lamp:0,0',
      x: 0,
      y: 0,
      radius: 3,
      intensity: 1,
      color: { r: 255, g: 177, b: 88 },
    };
    const dark = renderer().renderToBuffer(world(night), 0).buffer;
    const lit = renderer().renderToBuffer(world(night, { lights: [light] }), 0).buffer;

    const darkCenter = dark[8]![12]!;
    const litCenter = lit[8]![12]!;
    const luminance = (pixel: NonNullable<typeof darkCenter>): number => pixel.r + pixel.g + pixel.b;
    expect(luminance(litCenter)).toBeGreaterThan(luminance(darkCenter) * 1.5);
    expect(meanLuminance(lit)).toBeGreaterThan(meanLuminance(dark) * 1.1);
    expect(lit).not.toEqual(dark);
  });

  it('keeps cached static grading pixel-exact through wet weather and local lights', () => {
    const life = {
      ...state(780, 'storm'),
      surfaceWetness: 0.93,
    };
    const lights: WorldLightSource[] = [{
      id: 'lamp:cache-proof',
      x: 0,
      y: 0,
      radius: 3,
      intensity: 0.85,
      color: { r: 255, g: 177, b: 88 },
    }];
    const uncached = renderer().renderToBuffer(world(life, { lights }), 31).buffer;
    const cachedResult = renderer().renderToBuffer(world(life, {
      lights,
      staticIdentity: {},
    }), 31);

    expect(cachedResult.buffer).toEqual(uncached);
    expect(cachedResult.sharedStaticBuffer).toBeDefined();
  });

  it('reuses a lit static night plane while preserving exact actor pixels', () => {
    const life = state(0, 'clear');
    const lights: WorldLightSource[] = [{
      id: 'lamp:actor-proof',
      x: 0,
      y: 0,
      radius: 4,
      intensity: 0.9,
      color: { r: 255, g: 177, b: 88 },
    }];
    const actorFrame: PixelGrid = [[{ r: 45, g: 91, b: 214, a: 190 }]];
    const actorFrames = [actorFrame, actorFrame, actorFrame, actorFrame] as DirectionFrames;
    const actor: Sprite = {
      width: 1,
      height: 1,
      frames: {
        up: actorFrames,
        down: actorFrames,
        left: actorFrames,
        right: actorFrames,
      },
    };
    const actorWorld = (
      staticIdentity?: object,
      worldLife: WorldLifeState = life,
    ): WorldDataProvider => ({
      ...world(worldLife, { lights, staticIdentity }),
      getPlayers: () => [{
        userId: 'local',
        username: 'local',
        x: 0,
        y: 0,
        direction: 'down',
        animationFrame: 0,
        isMoving: false,
      }],
      getPlayerSprite: () => actor,
    });

    const uncached = renderer().renderToBuffer(actorWorld(), 17);
    const cached = renderer().renderToBuffer(actorWorld({}), 17);

    expect(cached.buffer).toEqual(uncached.buffer);
    expect(cached.sharedStaticBuffer).toBeDefined();
    expect(cached.sharedStaticDirtyCellOffsets?.length).toBeGreaterThan(0);
    expect(cached.buffer).not.toEqual(cached.sharedStaticBuffer);

    const storm = {
      ...state(0, 'storm'),
      surfaceWetness: 0.93,
    };
    expect(renderer().renderToBuffer(actorWorld({}, storm), 31).buffer)
      .toEqual(renderer().renderToBuffer(actorWorld(undefined, storm), 31).buffer);

    const gameRenderer = (): PixelGameRenderer => {
      const value = new PixelGameRenderer({
        stream: new PassThrough(),
        cols: 12,
        rows: 8,
        username: 'local',
        renderMode: 'octant',
        zoomLevel: 10,
        paletteAnimation: false,
        layout: {
          headerRows: 0,
          footerRows: 0,
          leftSidebarCols: 0,
          rightSidebarCols: 0,
        },
      });
      value.setCamera(0, 0);
      value.setAuthoritativePosition(0, 0);
      return value;
    };
    expect(gameRenderer().renderToString(actorWorld({})))
      .toBe(gameRenderer().renderToString(actorWorld()));
    expect(gameRenderer().renderToString(actorWorld({}, storm)))
      .toBe(gameRenderer().renderToString(actorWorld(undefined, storm)));
  });
});
