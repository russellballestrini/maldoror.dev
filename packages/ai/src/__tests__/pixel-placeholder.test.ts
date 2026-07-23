import { describe, expect, it } from 'vitest';
import { generatePixelPlaceholderSprite } from '../generator.js';

describe('generatePixelPlaceholderSprite', () => {
  it('returns the protocol-native four-frame RGB sprite contract', () => {
    const sprite = generatePixelPlaceholderSprite();

    expect(sprite.width).toBe(16);
    expect(sprite.height).toBe(24);
    for (const direction of ['up', 'down', 'left', 'right'] as const) {
      expect(sprite.frames[direction]).toHaveLength(4);
      for (const frame of sprite.frames[direction]) {
        expect(frame).toHaveLength(24);
        expect(frame.every((row) => row.length === 16)).toBe(true);
        expect(frame.flat().some((pixel) => pixel !== null)).toBe(true);
        expect(frame.flat().every((pixel) => pixel === null || (
          typeof pixel.r === 'number' &&
          typeof pixel.g === 'number' &&
          typeof pixel.b === 'number'
        ))).toBe(true);
      }
    }
  });
});
