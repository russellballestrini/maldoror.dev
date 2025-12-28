/**
 * Character Decision Engine
 *
 * LLM-powered decision making for AI characters (NPCs and bots).
 */

import { generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type {
  CharacterConfig,
  CharacterObservation,
  DecisionResult,
  TokenUsage,
} from './types.js';
import { buildSystemPrompt } from './prompt-builder.js';
import { buildContext } from './context-builder.js';
import { parseActions } from './action-parser.js';

export interface DecisionEngineOptions {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  personality: string;
  goals: string[];
}

/**
 * Character Decision Engine
 *
 * Handles LLM-based decision making for AI characters.
 * Can be used by both in-process NPCs and external bots.
 */
export class CharacterDecisionEngine {
  private model: LanguageModel;
  private systemPrompt: string;
  private provider: string;
  private modelName: string;

  constructor(options: DecisionEngineOptions) {
    this.provider = options.provider;
    this.modelName = options.model;

    // Create provider with API key
    if (options.provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey: options.apiKey });
      this.model = anthropic(options.model);
    } else {
      const openai = createOpenAI({ apiKey: options.apiKey });
      this.model = openai(options.model);
    }

    this.systemPrompt = buildSystemPrompt({
      personality: options.personality,
      goals: options.goals,
    });
  }

  /**
   * Make a decision based on the current observation
   */
  async decide(observation: CharacterObservation): Promise<DecisionResult> {
    const context = buildContext(observation);
    const fullPrompt = `${this.systemPrompt}\n\n${context}`;

    try {
      const result = await generateText({
        model: this.model,
        system: this.systemPrompt,
        prompt: context,
        maxTokens: 200,
        temperature: 0.7,
      });

      const tokenUsage: TokenUsage = {
        inputTokens: result.usage?.promptTokens || 0,
        outputTokens: result.usage?.completionTokens || 0,
        provider: this.provider,
        model: this.modelName,
      };

      return {
        actions: parseActions(result.text),
        tokenUsage,
        prompt: fullPrompt,
        response: result.text,
      };
    } catch (error) {
      console.error('[CharacterDecisionEngine] LLM error:', error);

      // Return a wait action on error with zero token usage
      const tokenUsage: TokenUsage = {
        inputTokens: 0,
        outputTokens: 0,
        provider: this.provider,
        model: this.modelName,
      };

      return {
        actions: [{ type: 'wait' }],
        tokenUsage,
        prompt: fullPrompt,
        response: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a decision engine from a character config
   */
  static fromConfig(config: CharacterConfig): CharacterDecisionEngine {
    return new CharacterDecisionEngine({
      provider: config.aiProvider,
      model: config.aiModel,
      apiKey: config.apiKey,
      personality: config.personality,
      goals: config.goals,
    });
  }
}
