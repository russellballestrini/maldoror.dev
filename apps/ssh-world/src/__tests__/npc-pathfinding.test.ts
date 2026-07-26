import { describe, expect, it } from 'vitest';
import { findBoundedNPCPath, findBoundedNPCPathStep } from '../game/npc-pathfinding.js';

describe('bounded NPC pathfinding', () => {
  it('takes a deterministic shortest detour around authored collision', () => {
    const blocked = new Set(['1,-1', '1,0', '1,1']);
    const route = (tieBreaker: number): string[] => {
      let x = 0;
      let y = 0;
      const steps: string[] = [];
      for (let index = 0; index < 12 && (x !== 2 || y !== 0); index++) {
        const step = findBoundedNPCPathStep({
          startX: x,
          startY: y,
          targetX: 2,
          targetY: 0,
          homeX: 0,
          homeY: 0,
          roamRadius: 5,
          tieBreaker,
          isBlocked: (candidateX, candidateY) => blocked.has(`${candidateX},${candidateY}`),
        });
        expect(step).not.toBeNull();
        x = step!.x;
        y = step!.y;
        steps.push(`${x},${y}`);
      }
      expect([x, y]).toEqual([2, 0]);
      return steps;
    };

    expect(route(17)).toEqual(route(17));
    expect(route(17)).toHaveLength(6);
    expect(findBoundedNPCPath({
      startX: 0,
      startY: 0,
      targetX: 2,
      targetY: 0,
      homeX: 0,
      homeY: 0,
      roamRadius: 5,
      tieBreaker: 17,
      isBlocked: (x, y) => blocked.has(`${x},${y}`),
    })).toHaveLength(6);
  });

  it('never searches beyond the persisted roam disc', () => {
    const inspected: Array<readonly [number, number]> = [];
    const step = findBoundedNPCPathStep({
      startX: 0,
      startY: 0,
      targetX: 2,
      targetY: 0,
      homeX: 0,
      homeY: 0,
      roamRadius: 2,
      tieBreaker: 0,
      isBlocked: (x, y) => {
        inspected.push([x, y]);
        return x === 1 || y === 1 || y === -1;
      },
    });

    expect(step).toBeNull();
    expect(inspected.every(([x, y]) => x * x + y * y <= 4)).toBe(true);
  });
});
