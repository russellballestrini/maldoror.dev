import { describe, expect, it } from 'vitest';
import type { Tile, WorldDataProvider, WorldLifeState } from '@maldoror/protocol';
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

function world(life: WorldLifeState): WorldDataProvider {
  return {
    getTile: () => terrain,
    getPlayers: () => [],
    getPlayerSprite: () => null,
    getLocalPlayerId: () => 'local',
    getWorldLifeState: () => life,
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
    expect(terrain.pixels[0]![0]).toEqual(authoredSample);
  });

  it('adds deterministic storm streaks while retaining a coherent cool grade', () => {
    const first = renderer().renderToBuffer(world(state(780, 'storm')), 31).buffer;
    const replay = renderer().renderToBuffer(world(state(780, 'storm')), 31).buffer;
    const clear = renderer().renderToBuffer(world(state(780, 'clear')), 31).buffer;

    expect(first).toEqual(replay);
    expect(first).not.toEqual(clear);
    expect(first.flat().filter((pixel) => pixel?.b && pixel.b > pixel.r).length).toBeGreaterThan(0);
  });
});
