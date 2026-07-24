import { describe, expect, it } from 'vitest';
import type { PackedPixelGrid, PixelGrid } from '@maldoror/protocol';
import { resamplePackedPixelGrid, resamplePixelGrid } from '../pixel/pixel-resampler.js';

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
    expect(result).toEqual([[{ r: 240, g: 120, b: 60, a: 64 }]]);
  });

  it('preserves authored partial alpha while resampling coverage', () => {
    const result = resamplePixelGrid([
      [{ r: 220, g: 80, b: 40, a: 128 }, null],
      [null, null],
    ], 1, 1);
    expect(result).toEqual([[{ r: 220, g: 80, b: 40, a: 32 }]]);
  });

  it('uses transparency-aware interpolation when enlarging', () => {
    const result = resamplePixelGrid([[{ r: 10, g: 20, b: 30 }]], 3, 2);
    expect(result.flat()).toEqual(Array(6).fill({ r: 10, g: 20, b: 30 }));
  });
});

describe('resamplePackedPixelGrid', () => {
  it.each([
    ['same size', 4, 3],
    ['area reduction', 2, 2],
    ['bilinear enlargement', 7, 5],
  ])('is pixel-exact with object-grid reconstruction at %s', (_name, width, height) => {
    const source: PixelGrid = [
      [{ r: 8, g: 16, b: 24 }, null, { r: 90, g: 80, b: 70, a: 128 }, { r: 1, g: 2, b: 3 }],
      [null, { r: 200, g: 120, b: 40, a: 32 }, { r: 12, g: 34, b: 56 }, null],
      [{ r: 255, g: 200, b: 100 }, { r: 2, g: 4, b: 8, a: 240 }, null, { r: 70, g: 60, b: 50 }],
    ];
    expect(resamplePackedPixelGrid(pack(source), width, height))
      .toEqual(resamplePixelGrid(source, width, height));
  });

  it('rejects malformed planes instead of reading outside the raster', () => {
    expect(() => resamplePackedPixelGrid({ width: 2, height: 2, data: new Uint8Array(3) }, 1, 1))
      .toThrow('dimensions do not match');
  });
});

function pack(grid: PixelGrid): PackedPixelGrid {
  const height = grid.length;
  const width = grid[0]?.length ?? 0;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = grid[y]?.[x];
      if (!pixel) continue;
      const offset = (y * width + x) * 4;
      data[offset] = pixel.r;
      data[offset + 1] = pixel.g;
      data[offset + 2] = pixel.b;
      data[offset + 3] = pixel.a ?? 255;
    }
  }
  return { width, height, data };
}
