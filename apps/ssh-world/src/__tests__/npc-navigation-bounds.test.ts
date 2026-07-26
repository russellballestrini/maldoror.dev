import { describe, expect, it } from 'vitest';
import {
  coalesceNPCNavigationBounds,
  npcNavigationBoundsForHome,
} from '../game/npc-navigation-bounds.js';

describe('NPC navigation preparation bounds', () => {
  it('builds an integer padded envelope around a persisted roam disc', () => {
    expect(npcNavigationBoundsForHome(-9, 1, 15)).toEqual({
      minX: -26,
      minY: -16,
      maxX: 8,
      maxY: 18,
    });
  });

  it('coalesces overlapping signed roam regions without losing coverage', () => {
    expect(coalesceNPCNavigationBounds([
      { minX: -26, minY: -16, maxX: 8, maxY: 18 },
      { minX: -29, minY: -33, maxX: 5, maxY: 1 },
    ], 15, 8192)).toEqual([
      { minX: -29, minY: -33, maxX: 8, maxY: 18 },
    ]);
  });

  it('compacts nearest regions deterministically under the viewport limit', () => {
    const bounds = [0, 20, 40].map((x) => ({ minX: x, minY: 0, maxX: x + 4, maxY: 4 }));
    expect(coalesceNPCNavigationBounds(bounds, 2, 256)).toEqual([
      { minX: 0, minY: 0, maxX: 24, maxY: 4 },
      { minX: 40, minY: 0, maxX: 44, maxY: 4 },
    ]);
  });

  it('fails explicitly when safe bounded preparation is impossible', () => {
    expect(() => coalesceNPCNavigationBounds([
      { minX: 0, minY: 0, maxX: 9, maxY: 9 },
      { minX: 100, minY: 100, maxX: 109, maxY: 109 },
    ], 1, 256)).toThrow(/cannot compact/);
  });
});
