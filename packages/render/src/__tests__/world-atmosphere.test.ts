import { describe, expect, it } from 'vitest';
import type { Tile, WorldDataProvider, WorldLifeState, WorldLightSource } from '@maldoror/protocol';
import { ViewportRenderer } from '../pixel/viewport-renderer.js';

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
  options: { tile?: Tile; lights?: WorldLightSource[] } = {},
): WorldDataProvider {
  return {
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
});
