import type { RGB, Tile } from '@maldoror/protocol';
import { describe, expect, it } from 'vitest';
import type { BiomeFamily, BiomeWeights, BiomeWorldSample } from '../biomes/biome-world-field.js';
import { BIOME_FAMILIES } from '../biomes/biome-world-field.js';
import { RegionalMaterialCompositor, type BiomeSampler } from '../tiles/regional-material-compositor.js';

const COLOURS: Record<BiomeFamily, RGB> = {
  'canal-town': { r: 220, g: 150, b: 90 },
  forest: { r: 25, g: 100, b: 45 },
  coast: { r: 20, g: 130, b: 190 },
  rural: { r: 170, g: 160, b: 55 },
  mountain: { r: 135, g: 135, b: 150 },
  ruins: { r: 120, g: 65, b: 145 },
};

function solidTile(family: BiomeFamily): Tile {
  const colour = COLOURS[family];
  const pixels = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => ({ ...colour })));
  return { id: family, name: family, walkable: family !== 'coast', pixels, resolutions: { '8': pixels } };
}

function sample(weights: BiomeWeights, isWater = false): BiomeWorldSample {
  let primaryIndex = 0;
  for (let index = 1; index < weights.length; index++) if (weights[index]! > weights[primaryIndex]!) primaryIndex = index;
  const ecology = [1, 2, 3, 4].sort((a, b) => weights[b]! - weights[a]!)[0]!;
  return {
    weights,
    primary: BIOME_FAMILIES[primaryIndex]!,
    ecologicalPrimary: BIOME_FAMILIES[ecology] as BiomeWorldSample['ecologicalPrimary'],
    elevation: 0.5,
    slope: 0.01,
    waterDistance: isWater ? 0 : 10,
    isWater,
    isRiver: false,
  };
}

function compositor(field: BiomeSampler, maxCachedTiles = 8): RegionalMaterialCompositor {
  return new RegionalMaterialCompositor({
    worldSeed: 42n,
    field,
    maxCachedTiles,
    materials: Object.fromEntries(BIOME_FAMILIES.map((family) => [family, [solidTile(family)]])) as Record<BiomeFamily, Tile[]>,
  });
}

describe('RegionalMaterialCompositor', () => {
  it('uses cultural families as overlays instead of muddy six-way averaging', () => {
    const town = compositor({ sample: () => sample([1, 0, 0, 0, 0, 0]) });
    expect(town.getTile(0, 0).pixels[4]![4]).toEqual(COLOURS['canal-town']);

    const ruins = compositor({ sample: () => sample([0, 0, 0, 0, 0, 1]) });
    const centre = ruins.getTile(0, 0).pixels[4]![4]!;
    expect(centre.r).toBeGreaterThan(COLOURS.forest.r);
    expect(centre.b).toBeGreaterThan(120);
  });

  it('reconstructs a smooth ecological handoff across neighbouring tiles', () => {
    const field: BiomeSampler = {
      sample: (x) => {
        const coast = Math.max(0, Math.min(1, x / 2));
        return sample([0, 1 - coast, coast, 0, 0, 0], coast >= 0.5);
      },
    };
    const composed = compositor(field);
    const left = composed.getTile(0, 0);
    const right = composed.getTile(1, 0);
    const y = 4;
    const beforeEdge = left.pixels[y]![6]!;
    const leftEdge = left.pixels[y]![7]!;
    const rightEdge = right.pixels[y]![0]!;
    const afterEdge = right.pixels[y]![1]!;
    const jump = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
    expect(jump(leftEdge, rightEdge)).toBeLessThanOrEqual(
      Math.max(jump(beforeEdge, leftEdge), jump(rightEdge, afterEdge)) + 2,
    );
    expect(left.materialMask?.[y]?.[0]).toBe(0);
    expect(left.materialMask?.[y]?.[7]).toBe(1);
    expect(right.materialMask?.[y]?.[7]).toBe(1);
    expect(left.walkable).toBe(true);
    expect(right.walkable).toBe(false);
  });

  it('bounds composed tile cache and reuses live entries', () => {
    const composed = compositor({ sample: () => sample([0, 1, 0, 0, 0, 0]) }, 8);
    const first = composed.getTile(0, 0);
    expect(composed.getTile(0, 0)).toBe(first);
    for (let x = 1; x <= 12; x++) composed.getTile(x, 0);
    expect(composed.getStats()).toEqual({ cachedTiles: 8, maxCachedTiles: 8, sourceSize: 8 });
  });
});
