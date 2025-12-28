/**
 * Decision Loop
 *
 * LLM-powered decision making for the agent bot.
 */

import { generateText, type LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { ObservationPayload, Direction } from '@maldoror/agent';
import { getSystemPrompt } from './prompts.js';
import { buildContext } from './context.js';

export interface DecisionConfig {
  provider: 'anthropic' | 'openai';
  model: string;
  apiKey: string;
  personality: string;
  goals: string[];
}

export interface DecidedAction {
  type: 'move' | 'chat' | 'wait';
  direction?: Direction;
  message?: string;
}

export interface DecisionResult {
  actions: DecidedAction[];
  prompt: string;
  response: string;
}

export class DecisionLoop {
  private model: LanguageModel;
  private systemPrompt: string;

  constructor(config: DecisionConfig) {
    // Create provider with API key
    if (config.provider === 'anthropic') {
      const anthropic = createAnthropic({ apiKey: config.apiKey });
      this.model = anthropic(config.model);
    } else {
      const openai = createOpenAI({ apiKey: config.apiKey });
      this.model = openai(config.model);
    }

    this.systemPrompt = getSystemPrompt({
      personality: config.personality,
      goals: config.goals,
    });
  }

  async decide(observation: ObservationPayload): Promise<DecisionResult> {
    const context = buildContext(observation);
    const fullPrompt = `${this.systemPrompt}\n\n${context}`;

    try {
      const { text } = await generateText({
        model: this.model,
        system: this.systemPrompt,
        prompt: context,
        maxTokens: 200,
        temperature: 0.7,
      });

      return {
        actions: this.parseActions(text),
        prompt: fullPrompt,
        response: text,
      };
    } catch (error) {
      console.error('[DecisionLoop] LLM error:', error);
      // Fallback: random walk
      return {
        actions: [{ type: 'wait' }],
        prompt: fullPrompt,
        response: `ERROR: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  private parseActions(response: string): DecidedAction[] {
    // Try to extract JSON array from response
    const trimmed = response.trim();

    // Try direct parse first
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return this.validateActions(parsed);
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
          return this.validateActions(parsed);
        }
      } catch {
        // Could not parse extracted JSON
      }
    }

    console.warn('[DecisionLoop] Could not parse response:', response.slice(0, 100));
    return [{ type: 'wait' }];
  }

  private validateActions(actions: unknown[]): DecidedAction[] {
    const valid: DecidedAction[] = [];

    for (const action of actions) {
      if (!action || typeof action !== 'object') continue;

      const a = action as Record<string, unknown>;

      if (a.type === 'move') {
        const dir = a.direction as string;
        if (['up', 'down', 'left', 'right'].includes(dir)) {
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
}
