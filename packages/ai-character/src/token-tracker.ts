/**
 * Token Tracker
 *
 * Track and log AI token usage to the database.
 */

import type { TokenUsage } from './types.js';
import { MODEL_PRICING } from './types.js';
import { db, schema } from '@maldoror/db';

/**
 * Calculate estimated cost in microdollars
 */
export function calculateCostMicros(usage: TokenUsage): number {
  const pricing = MODEL_PRICING[usage.model];
  if (!pricing) {
    // Default pricing if model not found (conservative estimate)
    return Math.ceil(
      (usage.inputTokens * 1000000 / 1000000) +
      (usage.outputTokens * 3000000 / 1000000)
    );
  }

  const inputCost = Math.ceil((usage.inputTokens * pricing.inputPerMillion) / 1000000);
  const outputCost = Math.ceil((usage.outputTokens * pricing.outputPerMillion) / 1000000);

  return inputCost + outputCost;
}

/**
 * Token Tracker class for logging AI usage to the database
 */
export class TokenTracker {
  /**
   * Log token usage to the database
   */
  async log(userId: string, usage: TokenUsage): Promise<void> {
    try {
      const costMicros = calculateCostMicros(usage);

      await db.insert(schema.aiTokenUsage).values({
        userId,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        estimatedCostMicros: costMicros,
        provider: usage.provider,
        model: usage.model,
      });
    } catch (error) {
      // Log but don't throw - token tracking shouldn't break the bot
      console.error('[TokenTracker] Failed to log usage:', error);
    }
  }

  /**
   * Get total usage for a user in a time period
   */
  async getUserUsage(_userId: string, _since?: Date): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostMicros: number;
    callCount: number;
  }> {
    // TODO: Implement aggregation query
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostMicros: 0,
      callCount: 0,
    };
  }

  /**
   * Get total usage across all NPCs
   */
  async getTotalNpcUsage(_since?: Date): Promise<{
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostMicros: number;
    callCount: number;
  }> {
    // TODO: Implement aggregation query with NPC filter
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostMicros: 0,
      callCount: 0,
    };
  }
}

// Singleton instance
export const tokenTracker = new TokenTracker();
