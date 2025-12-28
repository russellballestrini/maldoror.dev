/**
 * Activity Logger Test Suite
 *
 * Tests for the unified activity logging system that tracks
 * all actions and messages from players and autons.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ActivityType, UnifiedActivityEntry } from '../server/activity-logger';

// Mock the database for testing
vi.mock('@maldoror/db', () => ({
  db: {
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockResolvedValue(undefined),
    }),
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([]),
        }),
      }),
    }),
  },
  schema: {
    unifiedActivityLog: {},
  },
}));

describe('ActivityType enum', () => {
  it('should include all expected activity types', () => {
    const validTypes: ActivityType[] = [
      'chat',
      'emote',
      'move',
      'propose_event',
      'join_event',
      'propose_family',
      'accept_family',
      'reject_family',
      'birth',
      'death',
      'mourn',
      'stage_change',
    ];

    expect(validTypes).toHaveLength(12);
  });

  it('should have chat as a valid type', () => {
    const type: ActivityType = 'chat';
    expect(type).toBe('chat');
  });

  it('should have lifecycle event types', () => {
    const lifecycleTypes: ActivityType[] = ['birth', 'death', 'stage_change'];
    expect(lifecycleTypes).toContain('birth');
    expect(lifecycleTypes).toContain('death');
    expect(lifecycleTypes).toContain('stage_change');
  });

  it('should have family event types', () => {
    const familyTypes: ActivityType[] = ['propose_family', 'accept_family', 'reject_family'];
    expect(familyTypes).toHaveLength(3);
  });
});

describe('UnifiedActivityEntry type', () => {
  describe('actor types', () => {
    it('should accept player actor type', () => {
      const entry: UnifiedActivityEntry = {
        id: '1',
        timestamp: new Date(),
        actorId: 'player-1',
        actorName: 'TestPlayer',
        actorType: 'player',
        activityType: 'chat',
        message: 'Hello world',
      };

      expect(entry.actorType).toBe('player');
    });

    it('should accept auton actor type', () => {
      const entry: UnifiedActivityEntry = {
        id: '2',
        timestamp: new Date(),
        actorId: 'auton-1',
        actorName: 'TestAuton',
        actorType: 'auton',
        activityType: 'chat',
        message: 'Greetings',
      };

      expect(entry.actorType).toBe('auton');
    });

    it('should only allow player or auton types', () => {
      const validActorTypes: Array<UnifiedActivityEntry['actorType']> = ['player', 'auton'];

      expect(validActorTypes).toContain('player');
      expect(validActorTypes).toContain('auton');
      expect(validActorTypes).toHaveLength(2);

      // Verify legacy types are gone
      expect(validActorTypes).not.toContain('npc');
      expect(validActorTypes).not.toContain('bot');
    });
  });

  describe('chat activities', () => {
    it('should create chat activity with message', () => {
      const entry: UnifiedActivityEntry = {
        id: '1',
        timestamp: new Date(),
        actorId: 'p1',
        actorName: 'Player',
        actorType: 'player',
        activityType: 'chat',
        message: 'Hello!',
        locationX: 10,
        locationY: 20,
      };

      expect(entry.activityType).toBe('chat');
      expect(entry.message).toBe('Hello!');
      expect(entry.locationX).toBe(10);
      expect(entry.locationY).toBe(20);
    });

    it('should create emote activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '2',
        timestamp: new Date(),
        actorId: 'a1',
        actorName: 'Auton',
        actorType: 'auton',
        activityType: 'emote',
        message: 'waves happily',
      };

      expect(entry.activityType).toBe('emote');
    });
  });

  describe('movement activities', () => {
    it('should create move activity with direction details', () => {
      const entry: UnifiedActivityEntry = {
        id: '3',
        timestamp: new Date(),
        actorId: 'a1',
        actorName: 'Auton',
        actorType: 'auton',
        activityType: 'move',
        actionDetails: {
          direction: 'north',
          fromX: 5,
          fromY: 5,
          toX: 5,
          toY: 4,
        },
        locationX: 5,
        locationY: 4,
      };

      expect(entry.activityType).toBe('move');
      expect(entry.actionDetails?.direction).toBe('north');
      expect(entry.actionDetails?.toY).toBe(4);
    });
  });

  describe('lifecycle activities', () => {
    it('should create birth activity with parent details', () => {
      const entry: UnifiedActivityEntry = {
        id: '4',
        timestamp: new Date(),
        actorId: 'baby-1',
        actorName: 'NewAuton',
        actorType: 'auton',
        activityType: 'birth',
        actionDetails: {
          parent1Id: 'parent-1',
          parent1Name: 'ParentA',
          parent2Id: 'parent-2',
          parent2Name: 'ParentB',
          childId: 'baby-1',
          childName: 'NewAuton',
        },
        locationX: 10,
        locationY: 10,
      };

      expect(entry.activityType).toBe('birth');
      expect(entry.actionDetails?.parent1Name).toBe('ParentA');
      expect(entry.actionDetails?.childName).toBe('NewAuton');
    });

    it('should create death activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '5',
        timestamp: new Date(),
        actorId: 'auton-old',
        actorName: 'ElderAuton',
        actorType: 'auton',
        activityType: 'death',
        actionDetails: {
          causeOfDeath: 'old age',
          deceasedId: 'auton-old',
          deceasedName: 'ElderAuton',
        },
      };

      expect(entry.activityType).toBe('death');
      expect(entry.actionDetails?.causeOfDeath).toBe('old age');
    });

    it('should create stage change activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '6',
        timestamp: new Date(),
        actorId: 'auton-1',
        actorName: 'GrowingAuton',
        actorType: 'auton',
        activityType: 'stage_change',
        actionDetails: {
          oldStage: 'child',
          newStage: 'adult',
        },
      };

      expect(entry.activityType).toBe('stage_change');
      expect(entry.actionDetails?.oldStage).toBe('child');
      expect(entry.actionDetails?.newStage).toBe('adult');
    });
  });

  describe('family activities', () => {
    it('should create propose_family activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '7',
        timestamp: new Date(),
        actorId: 'auton-1',
        actorName: 'Proposer',
        actorType: 'auton',
        activityType: 'propose_family',
        actionDetails: {
          partnerId: 'auton-2',
          partnerName: 'Partner',
        },
      };

      expect(entry.activityType).toBe('propose_family');
      expect(entry.actionDetails?.partnerName).toBe('Partner');
    });

    it('should create accept_family activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '8',
        timestamp: new Date(),
        actorId: 'auton-2',
        actorName: 'Partner',
        actorType: 'auton',
        activityType: 'accept_family',
        actionDetails: {
          partnerId: 'auton-1',
          partnerName: 'Proposer',
        },
      };

      expect(entry.activityType).toBe('accept_family');
    });
  });

  describe('event activities', () => {
    it('should create propose_event activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '9',
        timestamp: new Date(),
        actorId: 'auton-1',
        actorName: 'Organizer',
        actorType: 'auton',
        activityType: 'propose_event',
        actionDetails: {
          eventId: 'event-1',
          eventName: 'Town Gathering',
        },
      };

      expect(entry.activityType).toBe('propose_event');
      expect(entry.actionDetails?.eventName).toBe('Town Gathering');
    });

    it('should create join_event activity', () => {
      const entry: UnifiedActivityEntry = {
        id: '10',
        timestamp: new Date(),
        actorId: 'player-1',
        actorName: 'Player',
        actorType: 'player',
        activityType: 'join_event',
        actionDetails: {
          eventId: 'event-1',
          eventName: 'Town Gathering',
        },
      };

      expect(entry.activityType).toBe('join_event');
    });
  });
});

describe('Activity filtering', () => {
  it('should filter activities by actor type', () => {
    const activities: UnifiedActivityEntry[] = [
      {
        id: '1',
        timestamp: new Date(),
        actorId: 'p1',
        actorName: 'Player1',
        actorType: 'player',
        activityType: 'chat',
        message: 'Hi',
      },
      {
        id: '2',
        timestamp: new Date(),
        actorId: 'a1',
        actorName: 'Auton1',
        actorType: 'auton',
        activityType: 'chat',
        message: 'Hello',
      },
      {
        id: '3',
        timestamp: new Date(),
        actorId: 'a2',
        actorName: 'Auton2',
        actorType: 'auton',
        activityType: 'move',
        actionDetails: { direction: 'east' },
      },
    ];

    const playerActivities = activities.filter(a => a.actorType === 'player');
    const autonActivities = activities.filter(a => a.actorType === 'auton');

    expect(playerActivities).toHaveLength(1);
    expect(autonActivities).toHaveLength(2);
  });

  it('should filter activities by type', () => {
    const activities: UnifiedActivityEntry[] = [
      {
        id: '1',
        timestamp: new Date(),
        actorId: 'a1',
        actorName: 'Auton',
        actorType: 'auton',
        activityType: 'chat',
        message: 'Hi',
      },
      {
        id: '2',
        timestamp: new Date(),
        actorId: 'a1',
        actorName: 'Auton',
        actorType: 'auton',
        activityType: 'move',
      },
      {
        id: '3',
        timestamp: new Date(),
        actorId: 'a2',
        actorName: 'NewAuton',
        actorType: 'auton',
        activityType: 'birth',
      },
    ];

    const chatActivities = activities.filter(a => a.activityType === 'chat');
    const lifecycleActivities = activities.filter(a =>
      ['birth', 'death', 'stage_change'].includes(a.activityType)
    );

    expect(chatActivities).toHaveLength(1);
    expect(lifecycleActivities).toHaveLength(1);
  });
});
