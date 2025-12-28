/**
 * Agent Helper Functions
 *
 * Utilities for working with world observations and making decisions.
 */

import type {
  Direction,
  Position,
  ObservationPayload,
  PlayerInfo,
  NPCInfo,
  TileInfo,
} from './types.js';

// =============================================================================
// Distance & Position Helpers
// =============================================================================

/**
 * Calculate Manhattan distance between two positions
 */
export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/**
 * Calculate Euclidean distance between two positions
 */
export function euclideanDistance(a: Position, b: Position): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get the direction from one position to another
 */
export function directionTo(from: Position, to: Position): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  // Prefer horizontal movement if equal
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  } else {
    return dy > 0 ? 'down' : 'up';
  }
}

/**
 * Get the position after moving in a direction
 */
export function positionAfterMove(pos: Position, direction: Direction): Position {
  switch (direction) {
    case 'up':
      return { x: pos.x, y: pos.y - 1 };
    case 'down':
      return { x: pos.x, y: pos.y + 1 };
    case 'left':
      return { x: pos.x - 1, y: pos.y };
    case 'right':
      return { x: pos.x + 1, y: pos.y };
  }
}

/**
 * Get the opposite direction
 */
export function oppositeDirection(direction: Direction): Direction {
  switch (direction) {
    case 'up':
      return 'down';
    case 'down':
      return 'up';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

// =============================================================================
// Entity Finders
// =============================================================================

/**
 * Find the nearest player to the agent
 */
export function findNearestPlayer(obs: ObservationPayload): PlayerInfo | null {
  if (obs.players.length === 0) return null;
  return obs.players.reduce((nearest, player) =>
    player.distance < nearest.distance ? player : nearest
  );
}

/**
 * Find the nearest NPC to the agent
 */
export function findNearestNPC(obs: ObservationPayload): NPCInfo | null {
  if (obs.npcs.length === 0) return null;
  return obs.npcs.reduce((nearest, npc) => (npc.distance < nearest.distance ? npc : nearest));
}

/**
 * Find a player by username (case-insensitive)
 */
export function findPlayerByName(obs: ObservationPayload, name: string): PlayerInfo | null {
  const lowerName = name.toLowerCase();
  return obs.players.find((p) => p.username.toLowerCase() === lowerName) || null;
}

/**
 * Find an NPC by name (case-insensitive)
 */
export function findNPCByName(obs: ObservationPayload, name: string): NPCInfo | null {
  const lowerName = name.toLowerCase();
  return obs.npcs.find((n) => n.name.toLowerCase().includes(lowerName)) || null;
}

// =============================================================================
// Terrain Helpers
// =============================================================================

/**
 * Get the tile at a relative position from the agent
 */
export function getTileAt(obs: ObservationPayload, relX: number, relY: number): TileInfo | null {
  if (!obs.terrain) return null;
  return obs.terrain.tiles.find((t) => t.relX === relX && t.relY === relY) || null;
}

/**
 * Check if a relative position is walkable
 */
export function canWalkTo(obs: ObservationPayload, relX: number, relY: number): boolean {
  const tile = getTileAt(obs, relX, relY);
  return tile?.walkable ?? false;
}

/**
 * Check if moving in a direction is possible
 */
export function canMove(obs: ObservationPayload, direction: Direction): boolean {
  const offsets: Record<Direction, [number, number]> = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
  };
  const [dx, dy] = offsets[direction];
  return canWalkTo(obs, dx, dy);
}

/**
 * Get all walkable directions from current position
 */
export function getWalkableDirections(obs: ObservationPayload): Direction[] {
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  return directions.filter((dir) => canMove(obs, dir));
}

/**
 * Find the tile type at a relative position
 */
export function getTileType(obs: ObservationPayload, relX: number, relY: number): string | null {
  const tile = getTileAt(obs, relX, relY);
  return tile?.tileType ?? null;
}

// =============================================================================
// Pathfinding Helpers
// =============================================================================

/**
 * Get a simple next direction toward a target position
 * Does not handle obstacles - just gives the naive direction
 */
export function nextDirectionToward(from: Position, to: Position): Direction | null {
  if (from.x === to.x && from.y === to.y) return null;
  return directionTo(from, to);
}

/**
 * Get a walkable direction toward a target, avoiding obstacles
 * Returns null if no walkable path toward target exists
 */
export function walkableDirectionToward(
  obs: ObservationPayload,
  target: Position
): Direction | null {
  const self = obs.self;
  if (self.x === target.x && self.y === target.y) return null;

  const preferred = directionTo(self, target);
  if (canMove(obs, preferred)) return preferred;

  // Try adjacent directions
  const alternates = getAlternateDirections(preferred);
  for (const alt of alternates) {
    if (canMove(obs, alt)) return alt;
  }

  return null;
}

/**
 * Get alternate directions when the preferred one is blocked
 */
function getAlternateDirections(preferred: Direction): Direction[] {
  switch (preferred) {
    case 'up':
    case 'down':
      return ['left', 'right'];
    case 'left':
    case 'right':
      return ['up', 'down'];
  }
}

// =============================================================================
// Chat Helpers
// =============================================================================

/**
 * Check if there are any recent chat messages
 */
export function hasRecentChat(obs: ObservationPayload): boolean {
  return obs.recentChat.length > 0;
}

/**
 * Get the most recent chat message
 */
export function getLastChatMessage(obs: ObservationPayload): { sender: string; text: string } | null {
  if (obs.recentChat.length === 0) return null;
  const msg = obs.recentChat[obs.recentChat.length - 1]!;
  return { sender: msg.senderName, text: msg.text };
}

/**
 * Check if anyone said something containing a keyword
 */
export function chatContains(obs: ObservationPayload, keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return obs.recentChat.some((msg) => msg.text.toLowerCase().includes(lower));
}

// =============================================================================
// Random Helpers
// =============================================================================

/**
 * Pick a random walkable direction
 */
export function randomWalkableDirection(obs: ObservationPayload): Direction | null {
  const walkable = getWalkableDirections(obs);
  if (walkable.length === 0) return null;
  return walkable[Math.floor(Math.random() * walkable.length)]!;
}

/**
 * Pick a random direction (may not be walkable)
 */
export function randomDirection(): Direction {
  const directions: Direction[] = ['up', 'down', 'left', 'right'];
  return directions[Math.floor(Math.random() * directions.length)]!;
}
