import { describe, expect, it } from 'vitest';
import type { Pixel } from '@maldoror/protocol';
import { fitOctant } from '../pixel/octant-fitter.js';
import { OCTANT_CHARS } from '../pixel/octant-chars.js';
import { renderOctantGridCells } from '../pixel/pixel-renderer.js';

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
});
