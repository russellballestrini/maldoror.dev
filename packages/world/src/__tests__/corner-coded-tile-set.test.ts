import { describe, expect, it } from 'vitest';
import type { Tile } from '@maldoror/protocol';
import { CornerCodedTileSet } from '../tiles/corner-coded-tile-set.js';

function tile(combination: number, variant: number): Tile {
  return {
    id: `c${combination}v${variant}`,
    name: `c${combination}v${variant}`,
    pixels: [[{ r: combination, g: variant, b: 0 }]],
    walkable: true,
  };
}

function bank(seed = 42n): CornerCodedTileSet {
  return new CornerCodedTileSet({
    worldSeed: seed,
    cornerColours: 2,
    tilesByCombination: Array.from({ length: 16 }, (_, combination) =>
      Array.from({ length: 4 }, (_, variant) => tile(combination, variant))),
  });
}

describe('CornerCodedTileSet', () => {
  it('is deterministic across signed coordinates and selects multiple shared variants', () => {
    const a = bank();
    const b = bank();
    const ids = new Set<string>();
    for (let y = -20; y <= 20; y++) {
      for (let x = -20; x <= 20; x++) {
        expect(a.getTile(x, y).id).toBe(b.getTile(x, y).id);
        ids.add(a.getTile(x, y).id);
      }
    }
    expect(ids.size).toBeGreaterThan(24);
  });

  it('shares the exact two corner codes across every adjacent edge', () => {
    const set = bank();
    for (let y = -8; y <= 8; y++) {
      for (let x = -8; x <= 8; x++) {
        const here = set.getAddress(x, y).corners;
        const east = set.getAddress(x + 1, y).corners;
        const south = set.getAddress(x, y + 1).corners;
        expect([here[1], here[3]]).toEqual([east[0], east[2]]);
        expect([here[2], here[3]]).toEqual([south[0], south[1]]);
      }
    }
  });

  it('rejects incomplete atlases instead of silently introducing fallback seams', () => {
    expect(() => new CornerCodedTileSet({
      worldSeed: 1n,
      cornerColours: 2,
      tilesByCombination: Array.from({ length: 15 }, (_, combination) => [tile(combination, 0)]),
    })).toThrow(/16 non-empty combinations/);
  });
});
