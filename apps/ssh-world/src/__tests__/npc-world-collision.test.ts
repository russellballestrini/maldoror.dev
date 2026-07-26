import { describe, expect, it, vi } from 'vitest';
import { resolveNPCWorldCollision } from '../game/npc-world-collision.js';

describe('NPC world collision authority', () => {
  it('uses the regional authority exclusively when it is installed', () => {
    const legacyWalkable = vi.fn(() => false);
    const regional = vi.fn((x: number, y: number) => x === -3 && y === 7);

    expect(resolveNPCWorldCollision(regional, legacyWalkable, -9, 1)).toBe(false);
    expect(resolveNPCWorldCollision(regional, legacyWalkable, -3, 7)).toBe(true);
    expect(regional).toHaveBeenCalledTimes(2);
    expect(legacyWalkable).not.toHaveBeenCalled();
  });

  it('retains the legacy generator only as the explicit rollback authority', () => {
    expect(resolveNPCWorldCollision(null, () => true, -9, 1)).toBe(false);
    expect(resolveNPCWorldCollision(null, () => false, -9, 1)).toBe(true);
  });
});
