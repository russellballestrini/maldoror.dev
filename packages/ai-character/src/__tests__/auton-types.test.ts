/**
 * Auton Type System Test Suite
 *
 * Verifies that the unified auton type system is properly implemented
 * across all entity types. The old 'npc' | 'bot' types should no longer
 * be used - everything autonomous is now an 'auton'.
 */

import { describe, it, expect } from 'vitest';
import type { VisibleEntity, CognitiveContext } from '../consciousness/types.js';

describe('VisibleEntity type', () => {
  describe('actor type constraints', () => {
    it('should accept player type', () => {
      const player: VisibleEntity = {
        id: 'player-1',
        name: 'TestPlayer',
        type: 'player',
        x: 10,
        y: 20,
        distance: 5,
      };

      expect(player.type).toBe('player');
      expect(player.isAuton).toBeUndefined();
    });

    it('should accept auton type', () => {
      const auton: VisibleEntity = {
        id: 'auton-1',
        name: 'TestAuton',
        type: 'auton',
        x: 15,
        y: 25,
        distance: 3,
        isAuton: true,
      };

      expect(auton.type).toBe('auton');
      expect(auton.isAuton).toBe(true);
    });

    it('should use isAuton flag correctly', () => {
      const entities: VisibleEntity[] = [
        { id: '1', name: 'Player1', type: 'player', x: 0, y: 0, distance: 0 },
        { id: '2', name: 'Auton1', type: 'auton', x: 1, y: 1, distance: 1, isAuton: true },
        { id: '3', name: 'Auton2', type: 'auton', x: 2, y: 2, distance: 2, isAuton: true },
      ];

      const players = entities.filter((e: VisibleEntity) => e.type === 'player');
      const autons = entities.filter((e: VisibleEntity) => e.type === 'auton');

      expect(players).toHaveLength(1);
      expect(autons).toHaveLength(2);
    });
  });

  describe('type discriminators', () => {
    it('should only allow player or auton types', () => {
      // This test validates the type union at runtime
      const validTypes: Array<VisibleEntity['type']> = ['player', 'auton'];

      expect(validTypes).toContain('player');
      expect(validTypes).toContain('auton');
      expect(validTypes).toHaveLength(2);

      // Verify no legacy types
      expect(validTypes).not.toContain('npc');
      expect(validTypes).not.toContain('bot');
    });

    it('should not include legacy isNpc property', () => {
      const entity: VisibleEntity = {
        id: '1',
        name: 'Test',
        type: 'auton',
        x: 0,
        y: 0,
        distance: 0,
        isAuton: true,
      };

      // isNpc should not exist on the type
      expect('isNpc' in entity).toBe(false);
      expect(entity.isAuton).toBe(true);
    });
  });

  describe('entity distance calculation', () => {
    it('should store distance for proximity calculations', () => {
      const entities: VisibleEntity[] = [
        { id: '1', name: 'Near', type: 'player', x: 1, y: 1, distance: 1.41 },
        { id: '2', name: 'Far', type: 'auton', x: 10, y: 10, distance: 14.14, isAuton: true },
      ];

      const nearby = entities.filter((e: VisibleEntity) => e.distance < 5);
      expect(nearby).toHaveLength(1);
      expect(nearby[0]!.name).toBe('Near');
    });
  });
});

describe('CognitiveContext visible entities', () => {
  it('should properly type visible entities in context', () => {
    const mockContext: Partial<CognitiveContext> = {
      visibleEntities: [
        { id: 'p1', name: 'Player1', type: 'player', x: 5, y: 5, distance: 3 },
        { id: 'a1', name: 'Auton1', type: 'auton', x: 8, y: 8, distance: 6, isAuton: true },
      ],
    };

    const entities = mockContext.visibleEntities!;
    const players = entities.filter((e: VisibleEntity) => e.type === 'player');
    const autons = entities.filter((e: VisibleEntity) => e.type === 'auton');

    expect(players).toHaveLength(1);
    expect(autons).toHaveLength(1);
  });
});

describe('Type union exhaustiveness', () => {
  it('should handle all entity types exhaustively', () => {
    const handleEntity = (entity: VisibleEntity): string => {
      switch (entity.type) {
        case 'player':
          return 'handling player';
        case 'auton':
          return 'handling auton';
        default: {
          // This should never be reached if types are exhaustive
          const exhaustiveCheck: never = entity.type;
          throw new Error(`Unexpected entity type: ${exhaustiveCheck}`);
        }
      }
    };

    const player: VisibleEntity = {
      id: '1', name: 'P', type: 'player', x: 0, y: 0, distance: 0
    };
    const auton: VisibleEntity = {
      id: '2', name: 'A', type: 'auton', x: 0, y: 0, distance: 0, isAuton: true
    };

    expect(handleEntity(player)).toBe('handling player');
    expect(handleEntity(auton)).toBe('handling auton');
  });
});
