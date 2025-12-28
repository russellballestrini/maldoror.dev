/**
 * AI Character Types
 *
 * Shared types for LLM-powered character decision making.
 */

import type { Direction } from '@maldoror/agent';

/**
 * Configuration for an AI-powered character
 */
export interface CharacterConfig {
  userId: string;
  username: string;
  personality: string;
  goals: string[];
  aiProvider: 'anthropic' | 'openai';
  aiModel: string;
  apiKey: string;
  spawnX?: number;
  spawnY?: number;
  roamRadius?: number;
  decisionIntervalMs?: number;
}

/**
 * A single action the character can take
 */
export interface CharacterAction {
  type: 'move' | 'chat' | 'wait';
  direction?: Direction;
  message?: string;
}

/**
 * Token usage from an LLM call
 */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
}

/**
 * Result of a character decision
 */
export interface DecisionResult {
  actions: CharacterAction[];
  tokenUsage: TokenUsage;
  prompt: string;
  response: string;
}

/**
 * Observation data for character context
 */
export interface CharacterObservation {
  tick: number;
  self: {
    x: number;
    y: number;
    direction: Direction;
  };
  players: Array<{
    userId: string;
    username: string;
    x: number;
    y: number;
    distance: number;
  }>;
  npcs: Array<{
    id: string;
    name: string;
    x: number;
    y: number;
    distance: number;
  }>;
  terrain?: {
    tiles: Array<{
      relX: number;
      relY: number;
      walkable: boolean;
    }>;
  };
  recentChat: Array<{
    senderName: string;
    text: string;
    timestamp: number;
  }>;
}

/**
 * Pricing info for cost estimation (in microdollars per 1M tokens)
 */
export interface ModelPricing {
  inputPerMillion: number;  // microdollars
  outputPerMillion: number; // microdollars
}

export const MODEL_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  'gpt-4o-mini': { inputPerMillion: 150000, outputPerMillion: 600000 },
  'gpt-4o': { inputPerMillion: 2500000, outputPerMillion: 10000000 },
  'gpt-4-turbo': { inputPerMillion: 10000000, outputPerMillion: 30000000 },
  // Anthropic
  'claude-sonnet-4-20250514': { inputPerMillion: 3000000, outputPerMillion: 15000000 },
  'claude-3-5-sonnet-20241022': { inputPerMillion: 3000000, outputPerMillion: 15000000 },
  'claude-3-haiku-20240307': { inputPerMillion: 250000, outputPerMillion: 1250000 },
};
