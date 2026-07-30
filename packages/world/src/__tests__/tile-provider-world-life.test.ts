import { describe, expect, it } from 'vitest';
import type { NPCVisualState, WorldLifeState } from '@maldoror/protocol';
import { createPlaceholderSprite, TileProvider } from '../tiles/tile-provider.js';

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

  it('forks a shared static-render identity only for structural mutations', () => {
    const sharedIdentity = {};
    const first = new TileProvider({ worldSeed: 42n, staticRenderIdentity: sharedIdentity });
    const second = new TileProvider({ worldSeed: 42n, staticRenderIdentity: sharedIdentity });

    first.setWorldLifeState(LIFE, 16);
    expect(first.getStaticRenderIdentity()).toBe(second.getStaticRenderIdentity());

    first.setRoad(1, 2, null);
    expect(first.getStaticRenderIdentity()).not.toBe(second.getStaticRenderIdentity());
    expect(second.getStaticRenderIdentity()).toBe(sharedIdentity);
  });

  it('shares deterministic placeholder rasters across session providers', () => {
    const first = createPlaceholderSprite({ r: 12, g: 34, b: 56 });
    const second = createPlaceholderSprite({ r: 12, g: 34, b: 56 });
    const different = createPlaceholderSprite({ r: 12, g: 34, b: 57 });

    expect(second).toBe(first);
    expect(different).not.toBe(first);
  });

  it('dirties an NPC visual only when its derived activity phase changes', () => {
    const world = new TileProvider({ worldSeed: 42n });
    const npc: NPCVisualState = {
      npcId: 'phase-visible-npc',
      name: 'Keeper · traveling',
      x: 1,
      y: 2,
      direction: 'right',
      animationFrame: 0,
      isMoving: true,
      role: 'maker',
      activity: 'work',
      activityPhase: 'traveling',
    };
    world.updateNPC(npc);
    const revision = world.getVisualRevision();
    world.updateNPC({ ...npc });
    expect(world.getVisualRevision()).toBe(revision);
    world.updateNPC({
      ...npc,
      name: 'Keeper · engaged',
      isMoving: false,
      activityPhase: 'engaged',
    });
    expect(world.getVisualRevision()).toBe(revision + 1);
  });
});
