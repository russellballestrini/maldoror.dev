import { describe, expect, it } from 'vitest';
import { resamplePixelGrid } from '../pixel/pixel-resampler.js';

describe('resamplePixelGrid', () => {
  it('area-averages all source pixels when reducing', () => {
    const result = resamplePixelGrid([
      [{ r: 0, g: 0, b: 0 }, { r: 100, g: 0, b: 0 }],
      [{ r: 0, g: 100, b: 0 }, { r: 100, g: 100, b: 0 }],
    ], 1, 1);
    expect(result).toEqual([[{ r: 50, g: 50, b: 0 }]]);
  });

  it('keeps sparse opaque detail instead of averaging it with black', () => {
    const result = resamplePixelGrid([
      [{ r: 240, g: 120, b: 60 }, null],
      [null, null],
    ], 1, 1);
    expect(result).toEqual([[{ r: 240, g: 120, b: 60 }]]);
  });

  it('uses transparency-aware interpolation when enlarging', () => {
    const result = resamplePixelGrid([[{ r: 10, g: 20, b: 30 }]], 3, 2);
    expect(result.flat()).toEqual(Array(6).fill({ r: 10, g: 20, b: 30 }));
  });
});
