import { describe, expect, it } from 'vitest';
import type { WorldLifeState } from '@maldoror/protocol';
import { TileProvider } from '../tiles/tile-provider.js';

const LIFE: WorldLifeState = {
  worldId: 'visual-revision-proof',
  worldSeed: '42',
  worldMinute: 480,
  weather: 'clear',
  weatherIntensity: 0.1,
  weatherUntilWorldMinute: 600,
  season: 'spring',
  rngState: 1,
  surfaceWetness: 0.2,
  waterTurbulence: 0.1,
  vegetationVitality: 0.7,
  decayPressure: 0.1,
};

describe('TileProvider world-life revisions', () => {
  it('does not dirty an identical terminal atmosphere projection', () => {
    const world = new TileProvider({ worldSeed: 42n });
    world.setWorldLifeState(LIFE, 16);
    const revision = world.getVisualRevision();
    world.setWorldLifeState({ ...LIFE }, 16);
    expect(world.getVisualRevision()).toBe(revision);
  });

  it('can animate precipitation without changing the global grade', () => {
    const world = new TileProvider({ worldSeed: 42n });
    world.setWorldLifeState({ ...LIFE, weather: 'rain' }, 481);
    const revision = world.getVisualRevision();
    world.setWorldLifeState({ ...LIFE, weather: 'rain' }, 482);
    expect(world.getVisualRevision()).toBe(revision + 1);
  });
});
