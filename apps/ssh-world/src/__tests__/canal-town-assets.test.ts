import { describe, expect, it } from 'vitest';
import { loadCanalTownDefaultAvatar } from '../game/canal-town-assets.js';

describe('canal-town identity assets', () => {
  it('loads the authored traveler without constructing the retired world kit', async () => {
    const avatar = await loadCanalTownDefaultAvatar();

    expect(avatar.width).toBe(96);
    expect(avatar.height).toBe(96);
    expect(Object.keys(avatar.frames).sort()).toEqual(['down', 'left', 'right', 'up']);
    expect(avatar.frames.down).toHaveLength(4);
    expect(avatar.frames.down[0]).toHaveLength(96);
    expect(avatar.frames.down[0]?.[0]).toHaveLength(96);

    const frame = avatar.frames.down[0]!;
    const visible: Array<[number, number]> = [];
    let partialCoverage = 0;
    for (let y = 0; y < frame.length; y++) {
      for (let x = 0; x < frame[y]!.length; x++) {
        const pixel = frame[y]![x];
        if (!pixel) continue;
        visible.push([x, y]);
        if (pixel.a !== undefined && pixel.a < 255) partialCoverage++;
      }
    }

    // A portrait fitted into the square runtime frame must keep transparent
    // side gutters. Opaque-black Sharp padding produced the atlas cut-out.
    expect(frame[0]?.[0]).toBeNull();
    expect(frame[0]?.[95]).toBeNull();
    expect(frame[95]?.[0]).toBeNull();
    expect(frame[95]?.[95]).toBeNull();
    expect(Math.min(...visible.map(([x]) => x))).toBeGreaterThan(0);
    expect(Math.max(...visible.map(([x]) => x))).toBeLessThan(95);
    expect(partialCoverage).toBeGreaterThan(0);
  });
});
