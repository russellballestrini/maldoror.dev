/**
 * Context Building
 *
 * Convert world observations into LLM-friendly context.
 */

import type { ObservationPayload } from '@maldoror/agent';

export function buildContext(obs: ObservationPayload): string {
  const { self, players, npcs, terrain, recentChat } = obs;

  let context = `=== CURRENT STATE (tick ${obs.tick}) ===

YOUR POSITION: (${self.x}, ${self.y}) facing ${self.direction}

`;

  // Nearby players
  if (players.length > 0) {
    context += `NEARBY PLAYERS (${players.length}):\n`;
    for (const p of players.slice(0, 5)) {
      context += `- "${p.username}" at (${p.x}, ${p.y}), ${p.distance} tiles ${describeDirection(self, p)}\n`;
    }
    context += '\n';
  } else {
    context += 'NEARBY PLAYERS: None visible\n\n';
  }

  // Nearby NPCs
  if (npcs.length > 0) {
    context += `NEARBY NPCS (${npcs.length}):\n`;
    for (const n of npcs.slice(0, 5)) {
      context += `- "${n.name}" at (${n.x}, ${n.y}), ${n.distance} tiles ${describeDirection(self, n)}\n`;
    }
    context += '\n';
  }

  // Walkable directions
  if (terrain && terrain.tiles.length > 0) {
    const walkable = getWalkableDirections(terrain.tiles);
    context += `WALKABLE DIRECTIONS: ${walkable.length > 0 ? walkable.join(', ') : 'none (stuck!)'}\n\n`;
  } else {
    context += 'WALKABLE DIRECTIONS: up, down, left, right (assuming all walkable)\n\n';
  }

  // Recent chat
  if (recentChat.length > 0) {
    context += 'RECENT CHAT:\n';
    for (const msg of recentChat.slice(-3)) {
      context += `- ${msg.senderName}: "${msg.text}"\n`;
    }
    context += '\n';
  }

  context += 'What actions will you take? Respond with a JSON array only.';

  return context;
}

function describeDirection(
  self: { x: number; y: number },
  target: { x: number; y: number }
): string {
  const dx = target.x - self.x;
  const dy = target.y - self.y;

  const parts: string[] = [];
  if (dy < 0) parts.push('north');
  if (dy > 0) parts.push('south');
  if (dx > 0) parts.push('east');
  if (dx < 0) parts.push('west');

  return parts.length > 0 ? `to the ${parts.join('-')}` : 'at your position';
}

function getWalkableDirections(tiles: Array<{ relX: number; relY: number; walkable: boolean }>): string[] {
  const directions: string[] = [];

  const up = tiles.find(t => t.relX === 0 && t.relY === -1);
  const down = tiles.find(t => t.relX === 0 && t.relY === 1);
  const left = tiles.find(t => t.relX === -1 && t.relY === 0);
  const right = tiles.find(t => t.relX === 1 && t.relY === 0);

  if (!up || up.walkable) directions.push('up');
  if (!down || down.walkable) directions.push('down');
  if (!left || left.walkable) directions.push('left');
  if (!right || right.walkable) directions.push('right');

  return directions;
}
