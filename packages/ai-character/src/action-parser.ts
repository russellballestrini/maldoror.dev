/**
 * Action Parser
 *
 * Parse LLM responses into validated character actions.
 */

import type { Direction } from '@maldoror/agent';
import type { CharacterAction } from './types.js';

const VALID_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right'];

/**
 * Parse an LLM response string into validated actions
 */
export function parseActions(response: string): CharacterAction[] {
  const trimmed = response.trim();

  // Try direct parse first
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return validateActions(parsed);
    }
  } catch {
    // Not valid JSON, try to extract
  }

  // Try to find JSON array in response
  const jsonMatch = trimmed.match(/\[[\s\S]*?\]/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (Array.isArray(parsed)) {
        return validateActions(parsed);
      }
    } catch {
      // Could not parse extracted JSON
    }
  }

  console.warn('[ActionParser] Could not parse response:', response.slice(0, 100));
  return [{ type: 'wait' }];
}

/**
 * Validate an array of parsed actions
 */
function validateActions(actions: unknown[]): CharacterAction[] {
  const valid: CharacterAction[] = [];

  for (const action of actions) {
    if (!action || typeof action !== 'object') continue;

    const a = action as Record<string, unknown>;

    if (a.type === 'move') {
      const dir = a.direction as string;
      if (VALID_DIRECTIONS.includes(dir as Direction)) {
        valid.push({ type: 'move', direction: dir as Direction });
      }
    } else if (a.type === 'chat') {
      const msg = String(a.message || '').slice(0, 100);
      if (msg.length > 0) {
        valid.push({ type: 'chat', message: msg });
      }
    } else if (a.type === 'wait') {
      valid.push({ type: 'wait' });
    }
  }

  return valid.length > 0 ? valid : [{ type: 'wait' }];
}
