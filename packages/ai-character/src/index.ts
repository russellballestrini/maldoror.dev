/**
 * @maldoror/ai-character
 *
 * Shared AI character decision logic for NPCs and bots.
 */

// Types
export type {
  CharacterConfig,
  CharacterAction,
  CharacterObservation,
  DecisionResult,
  TokenUsage,
  ModelPricing,
} from './types.js';

export { MODEL_PRICING } from './types.js';

// Decision Engine
export { CharacterDecisionEngine, type DecisionEngineOptions } from './decision-engine.js';

// Token Tracking
export { TokenTracker, tokenTracker, calculateCostMicros } from './token-tracker.js';

// Building blocks (for custom implementations)
export { buildSystemPrompt, type PromptConfig } from './prompt-builder.js';
export { buildContext } from './context-builder.js';
export { parseActions } from './action-parser.js';

// Advanced Consciousness System (v2)
export * from './consciousness/index.js';
