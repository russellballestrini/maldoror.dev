import { describe, expect, it } from 'vitest';
import type { Pixel } from '@maldoror/protocol';
import { fitOctant } from '../pixel/octant-fitter.js';
import { OCTANT_CHARS } from '../pixel/octant-chars.js';
import {
  packedRgb,
  renderOctantGridCells,
  renderOctantPackedGridCells,
} from '../pixel/pixel-renderer.js';

describe('octant perceptual fitting', () => {
  it('preserves chromatic structure that the luminance split collapses', () => {
    const red = { r: 255, g: 0, b: 0 };
    const equalLuminanceGreen = { r: 0, g: 130, b: 0 };
    const block: Pixel[] = [
      red, red,
      equalLuminanceGreen, equalLuminanceGreen,
      red, red,
      equalLuminanceGreen, equalLuminanceGreen,
    ];

    const baseline = fitOctant(block, 'brightness');
    const candidate = fitOctant(block, 'oklab-kmeans');

    expect(baseline.pattern).toBe(0xff);
    expect(candidate.pattern).not.toBe(0xff);
    expect(candidate.error).toBeLessThan(baseline.error * 0.05);
  });

  it('tracks the exhaustive optimum closely on a multi-colour edge cell', () => {
    const block: Pixel[] = [
      { r: 20, g: 77, b: 88 }, { r: 28, g: 98, b: 104 },
      { r: 32, g: 113, b: 116 }, { r: 187, g: 158, b: 112 },
      { r: 40, g: 130, b: 126 }, { r: 210, g: 185, b: 143 },
      { r: 52, g: 145, b: 136 }, { r: 228, g: 207, b: 171 },
    ];

    const candidate = fitOctant(block, 'oklab-kmeans');
    const optimum = fitOctant(block, 'oklab-exhaustive');

    expect(candidate.error).toBeGreaterThanOrEqual(optimum.error - 1e-10);
    expect(candidate.error).toBeLessThan(optimum.error * 1.15);
  });

  it('keeps a flat cell solid and deterministic', () => {
    const block = Array.from({ length: 8 }, () => ({ r: 84, g: 112, b: 97 }));
    expect(fitOctant(block, 'oklab-kmeans')).toEqual(fitOctant(block, 'oklab-kmeans'));
    expect(fitOctant(block, 'oklab-kmeans').pattern).toBe(0xff);
  });

  it('uses the perceptual gate in the production octant renderer', () => {
    const red = { r: 255, g: 0, b: 0 };
    const equalLuminanceGreen = { r: 0, g: 130, b: 0 };
    const cells = renderOctantGridCells([
      [red, equalLuminanceGreen],
      [equalLuminanceGreen, red],
      [red, equalLuminanceGreen],
      [equalLuminanceGreen, red],
    ]);

    expect(cells[0]?.[0]?.char).not.toBe(OCTANT_CHARS[0xff]);
    expect(cells[0]?.[0]?.fgColor).not.toEqual(cells[0]?.[0]?.bgColor);
  });

  it('packs the exact production octant glyph and colors without cell objects', () => {
    const pixels = [
      [{ r: 15, g: 35, b: 55 }, { r: 190, g: 165, b: 90 }],
      [{ r: 20, g: 45, b: 65 }, { r: 185, g: 160, b: 85 }],
      [{ r: 25, g: 55, b: 75 }, { r: 180, g: 155, b: 80 }],
      [{ r: 30, g: 65, b: 85 }, { r: 175, g: 150, b: 75 }],
    ];
    const object = renderOctantGridCells(pixels);
    const packed = renderOctantPackedGridCells(pixels);
    const expected = object[0]![0]!;

    expect(String.fromCodePoint(packed.codepoints[0]!)).toBe(expected.char);
    expect(packed.foreground[0]).toBe(packedRgb(expected.fgColor!));
    expect(packed.background[0]).toBe(packedRgb(expected.bgColor!));
  });

  it('reconstructs actor-dirty cells exactly over a shared static cell plane', () => {
    const ground = { r: 42, g: 91, b: 67 };
    const actor = { r: 221, g: 83, b: 56 };
    const staticGrid = Array.from({ length: 8 }, () =>
      Array.from({ length: 4 }, () => ground));
    const dynamicGrid = staticGrid.map((row) => [...row]);
    dynamicGrid[2]![1] = actor;
    dynamicGrid[3]![1] = actor;
    const staticMaterials = Array.from({ length: 8 }, () => new Uint8Array(4));
    const dynamicMaterials = staticMaterials.map((row) => row.slice());
    dynamicMaterials[2]![1] = 255;
    dynamicMaterials[3]![1] = 255;

    const expected = renderOctantPackedGridCells(dynamicGrid, undefined, dynamicMaterials);
    const optimized = renderOctantPackedGridCells(
      dynamicGrid,
      undefined,
      dynamicMaterials,
      undefined,
      { buffer: staticGrid, materialGrid: staticMaterials, dirtyCellOffsets: [0] },
    );

    expect([...optimized.codepoints]).toEqual([...expected.codepoints]);
    expect([...optimized.foreground]).toEqual([...expected.foreground]);
    expect([...optimized.background]).toEqual([...expected.background]);
    expect([...optimized.foregroundIndex]).toEqual([...expected.foregroundIndex]);
    expect([...optimized.backgroundIndex]).toEqual([...expected.backgroundIndex]);
  });

  it('derives a weather frame exactly from only its dirty parent cells', () => {
    const ground = { r: 42, g: 91, b: 67 };
    const streak = { r: 129, g: 177, b: 226 };
    const parentGrid = Array.from({ length: 8 }, () =>
      Array.from({ length: 4 }, () => ground));
    const weatherGrid = parentGrid.map((row) => [...row]);
    weatherGrid[1]![0] = streak;
    weatherGrid[6]![3] = streak;
    const materials = Array.from({ length: 8 }, () => new Uint8Array(4));

    const expected = renderOctantPackedGridCells(weatherGrid, undefined, materials);
    const optimized = renderOctantPackedGridCells(
      weatherGrid,
      undefined,
      materials,
      undefined,
      {
        buffer: weatherGrid,
        materialGrid: materials,
        parentBuffer: parentGrid,
        parentDirtyCellOffsets: [0, 3],
      },
    );

    expect([...optimized.codepoints]).toEqual([...expected.codepoints]);
    expect([...optimized.foreground]).toEqual([...expected.foreground]);
    expect([...optimized.background]).toEqual([...expected.background]);
    expect([...optimized.foregroundIndex]).toEqual([...expected.foregroundIndex]);
    expect([...optimized.backgroundIndex]).toEqual([...expected.backgroundIndex]);
  });
});
