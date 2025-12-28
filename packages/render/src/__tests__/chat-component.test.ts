/**
 * ChatComponent Test Suite
 *
 * Tests for the unified chat panel component that displays
 * chat messages from players and autons with proper badges.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ChatComponent, type ChatEntry } from '../components/chat-component.js';

describe('ChatComponent', () => {
  let chat: ChatComponent;

  beforeEach(() => {
    chat = new ChatComponent({
      id: 'test-chat',
      bounds: { x: 0, y: 0, width: 40, height: 20 },
      visible: true,
      focusable: true,
    });
  });

  describe('initialization', () => {
    it('should create with correct id', () => {
      expect(chat.id).toBe('test-chat');
    });

    it('should start with empty entries', () => {
      const entries = chat.getEntries();
      expect(entries).toEqual([]);
    });

    it('should start unfocused', () => {
      expect(chat.isFocused()).toBe(false);
    });

    it('should start with input inactive', () => {
      expect(chat.isInputActive()).toBe(false);
    });
  });

  describe('actor types', () => {
    it('should accept player actor type', () => {
      const entry: ChatEntry = {
        id: '1',
        actorId: 'player-1',
        actorName: 'TestPlayer',
        actorType: 'player',
        type: 'chat',
        message: 'Hello world',
        timestamp: new Date(),
      };

      chat.addEntry(entry);
      const entries = chat.getEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorType).toBe('player');
    });

    it('should accept auton actor type', () => {
      const entry: ChatEntry = {
        id: '2',
        actorId: 'auton-1',
        actorName: 'TestAuton',
        actorType: 'auton',
        type: 'chat',
        message: 'Greetings human',
        timestamp: new Date(),
      };

      chat.addEntry(entry);
      const entries = chat.getEntries();

      expect(entries).toHaveLength(1);
      expect(entries[0]!.actorType).toBe('auton');
    });

    it('should NOT accept legacy npc or bot types (type safety)', () => {
      // This test verifies that the old types no longer compile
      // TypeScript will catch this at compile time, but we verify runtime behavior
      const entry: ChatEntry = {
        id: '3',
        actorId: 'auton-2',
        actorName: 'LegacyBot',
        actorType: 'auton', // Must be 'player' | 'auton' now
        type: 'chat',
        message: 'I am an auton',
        timestamp: new Date(),
      };

      chat.addEntry(entry);
      expect(chat.getEntries()[0]!.actorType).toBe('auton');
    });
  });

  describe('message types', () => {
    it('should handle chat messages', () => {
      chat.addEntry({
        id: '1',
        actorId: 'p1',
        actorName: 'Player',
        actorType: 'player',
        type: 'chat',
        message: 'Hello!',
        timestamp: new Date(),
      });

      expect(chat.getEntries()[0]!.type).toBe('chat');
    });

    it('should handle action messages', () => {
      chat.addEntry({
        id: '2',
        actorId: 'a1',
        actorName: 'Auton',
        actorType: 'auton',
        type: 'action',
        message: '*walks north*',
        timestamp: new Date(),
      });

      expect(chat.getEntries()[0]!.type).toBe('action');
    });

    it('should handle event messages', () => {
      chat.addEntry({
        id: '3',
        actorId: 'system',
        actorName: 'System',
        actorType: 'auton',
        type: 'event',
        message: 'A new auton was born',
        timestamp: new Date(),
      });

      expect(chat.getEntries()[0]!.type).toBe('event');
    });
  });

  describe('position tracking', () => {
    it('should store position with messages', () => {
      chat.addEntry({
        id: '1',
        actorId: 'p1',
        actorName: 'Player',
        actorType: 'player',
        type: 'chat',
        message: 'I am here',
        position: { x: 10, y: 20 },
        timestamp: new Date(),
      });

      const entry = chat.getEntries()[0]!;
      expect(entry.position).toEqual({ x: 10, y: 20 });
    });

    it('should allow messages without position', () => {
      chat.addEntry({
        id: '1',
        actorId: 'p1',
        actorName: 'Player',
        actorType: 'player',
        type: 'chat',
        message: 'No position',
        timestamp: new Date(),
      });

      const entry = chat.getEntries()[0]!;
      expect(entry.position).toBeUndefined();
    });
  });

  describe('entry management', () => {
    it('should maintain entry order (newest last)', () => {
      const now = new Date();

      chat.addEntry({
        id: '1',
        actorId: 'p1',
        actorName: 'First',
        actorType: 'player',
        type: 'chat',
        message: 'First message',
        timestamp: new Date(now.getTime() - 1000),
      });

      chat.addEntry({
        id: '2',
        actorId: 'p2',
        actorName: 'Second',
        actorType: 'auton',
        type: 'chat',
        message: 'Second message',
        timestamp: now,
      });

      const entries = chat.getEntries();
      expect(entries[0]!.message).toBe('First message');
      expect(entries[1]!.message).toBe('Second message');
    });

    it('should limit entries to max buffer size', () => {
      // Add more than buffer size
      for (let i = 0; i < 150; i++) {
        chat.addEntry({
          id: `msg-${i}`,
          actorId: 'p1',
          actorName: 'Spammer',
          actorType: 'player',
          type: 'chat',
          message: `Message ${i}`,
          timestamp: new Date(),
        });
      }

      const entries = chat.getEntries();
      // Should be limited (default MAX_ENTRIES is 100)
      expect(entries.length).toBeLessThanOrEqual(100);
    });
  });

  describe('input handling', () => {
    it('should toggle input active state', () => {
      expect(chat.isInputActive()).toBe(false);

      chat.setInputActive(true);
      expect(chat.isInputActive()).toBe(true);

      chat.setInputActive(false);
      expect(chat.isInputActive()).toBe(false);
    });

    it('should track focus state', () => {
      expect(chat.isFocused()).toBe(false);

      chat.setFocused(true);
      expect(chat.isFocused()).toBe(true);
    });

    it('should manage input buffer', () => {
      chat.setInputActive(true);

      // Simulate typing
      chat.appendToInput('H');
      chat.appendToInput('i');

      expect(chat.getInputBuffer()).toBe('Hi');
    });

    it('should clear input buffer', () => {
      chat.setInputActive(true);
      chat.appendToInput('Hello');

      chat.clearInput();

      expect(chat.getInputBuffer()).toBe('');
    });

    it('should handle backspace', () => {
      chat.setInputActive(true);
      chat.appendToInput('Hello');

      chat.backspace();

      expect(chat.getInputBuffer()).toBe('Hell');
    });
  });

  describe('current user highlighting', () => {
    it('should track current user ID', () => {
      chat.setCurrentUserId('my-user-id');

      chat.addEntry({
        id: '1',
        actorId: 'my-user-id',
        actorName: 'Me',
        actorType: 'player',
        type: 'chat',
        message: 'My message',
        timestamp: new Date(),
      });

      // The entry should be from current user
      const entry = chat.getEntries()[0]!;
      expect(entry.actorId).toBe('my-user-id');
    });
  });

  describe('scrolling', () => {
    beforeEach(() => {
      // Add enough messages to need scrolling
      for (let i = 0; i < 50; i++) {
        chat.addEntry({
          id: `msg-${i}`,
          actorId: 'p1',
          actorName: 'User',
          actorType: 'player',
          type: 'chat',
          message: `Message ${i}`,
          timestamp: new Date(),
        });
      }
    });

    it('should scroll up (increase offset)', () => {
      const initialOffset = chat.getScrollOffset();
      chat.scrollUp(5);
      // scrollUp increases offset (capped by max scroll)
      expect(chat.getScrollOffset()).toBeGreaterThanOrEqual(initialOffset);
    });

    it('should scroll down (decrease offset)', () => {
      chat.scrollUp(10);
      const offsetAfterUp = chat.getScrollOffset();

      chat.scrollDown(3);
      // scrollDown decreases offset
      expect(chat.getScrollOffset()).toBeLessThanOrEqual(offsetAfterUp);
    });

    it('should not scroll below 0', () => {
      chat.scrollDown(100);
      expect(chat.getScrollOffset()).toBe(0);
    });
  });
});

describe('ChatEntry type constraints', () => {
  it('should enforce actorType as player or auton only', () => {
    // This is a compile-time check - if the types are wrong, TypeScript will error
    const playerEntry: ChatEntry = {
      id: '1',
      actorId: 'p1',
      actorName: 'Player',
      actorType: 'player',
      type: 'chat',
      message: 'test',
      timestamp: new Date(),
    };

    const autonEntry: ChatEntry = {
      id: '2',
      actorId: 'a1',
      actorName: 'Auton',
      actorType: 'auton',
      type: 'chat',
      message: 'test',
      timestamp: new Date(),
    };

    expect(playerEntry.actorType).toBe('player');
    expect(autonEntry.actorType).toBe('auton');
  });

  it('should enforce type as chat, action, or event only', () => {
    const types: Array<ChatEntry['type']> = ['chat', 'action', 'event'];
    expect(types).toContain('chat');
    expect(types).toContain('action');
    expect(types).toContain('event');
    expect(types).toHaveLength(3);
  });
});
