import { describe, expect, it } from 'vitest';
import { REGIONAL_BASIN_SIZE } from '../biomes/biome-world-field.js';
import { spatialHash2DUnit, spatialHash2DUint32 } from '../spatial-hash.js';

describe('spatial coordinate hash', () => {
  it('is deterministic over signed coordinates and remains in the unit interval', () => {
    for (const [x, y] of [[0, 0], [-1, 1], [1, -1], [-2_000_000, 3_000_000]]) {
      const first = spatialHash2DUnit(42, x!, y!, 0x4137);
      expect(first).toBe(spatialHash2DUnit(42, x!, y!, 0x4137));
      expect(first).toBeGreaterThanOrEqual(0);
      expect(first).toBeLessThan(1);
      expect(spatialHash2DUint32(42, x!, y!, 0x4137)).toBeGreaterThanOrEqual(0);
    }
  });

  it('decorrelates both axes of a travel-scale basin jitter field', () => {
    const cellSize = REGIONAL_BASIN_SIZE;
    const xPositions = new Set<number>();
    const yPositions = new Set<number>();
    const phases = new Set<string>();
    let count = 0;
    for (let cellY = -50; cellY <= 50; cellY++) {
      for (let cellX = -50; cellX <= 50; cellX++) {
        const x = Math.floor((cellX + 0.16 + spatialHash2DUnit(
          42,
          cellX,
          cellY,
          0x4137,
        ) * 0.68) * cellSize);
        const y = Math.floor((cellY + 0.16 + spatialHash2DUnit(
          42,
          cellX,
          cellY,
          0x97c1,
        ) * 0.68) * cellSize);
        xPositions.add(x);
        yPositions.add(y);
        phases.add(`${positiveMod(x, cellSize)},${positiveMod(y, cellSize)}`);
        count++;
      }
    }
    // Integer basin centres have at most REGIONAL_BASIN_SIZE distinct phases
    // on either axis, so coordinate collisions grow as the real 112-tile
    // basin scale is crossed. The visual invariant is high diversity in both
    // axes with no directional collapse, not an impossible unique-pixel rate.
    expect(xPositions.size).toBeGreaterThan(count * 0.5);
    expect(yPositions.size).toBeGreaterThan(count * 0.5);
    expect(Math.abs(xPositions.size - yPositions.size)).toBeLessThan(count * 0.02);
    expect(phases.size).toBeGreaterThan(count * 0.4);
  });
});

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}
