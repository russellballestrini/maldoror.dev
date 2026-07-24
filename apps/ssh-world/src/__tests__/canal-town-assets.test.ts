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
  });
});
