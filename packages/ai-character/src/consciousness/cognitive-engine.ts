/**
 * Cognitive Engine
 *
 * The core AI decision-making system for NPCs.
 * Uses multi-phase reasoning: Perception → Memory → Emotion → Reasoning → Planning
 *
 * Each phase builds on the previous, creating rich, contextual decisions.
 */

import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText } from 'ai';
import type {
  CognitiveEngineConfig,
  CognitiveContext,
  CognitiveDecisionResult,
  CognitiveAction,
  PerceptionResult,
  MemoryRetrievalResult,
  EmotionalProcessingResult,
  ReasoningResult,
  PlanningResult,
  Memory,
} from './types.js';
import { memoryManager } from './memory-manager.js';
import { relationshipManager } from './relationship-manager.js';
import { emotionProcessor } from './emotion-processor.js';

export class CognitiveEngine {
  private config: CognitiveEngineConfig;
  private model: ReturnType<typeof createOpenAI> | ReturnType<typeof createAnthropic>;

  constructor(config: CognitiveEngineConfig) {
    this.config = config;

    if (config.provider === 'anthropic') {
      this.model = createAnthropic({ apiKey: config.apiKey });
    } else {
      this.model = createOpenAI({ apiKey: config.apiKey });
    }
  }

  /**
   * Main decision-making process
   * Runs through all cognitive phases and returns actions
   */
  async decide(context: CognitiveContext): Promise<CognitiveDecisionResult> {
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    // Phase 1: Perception - What do I see and notice?
    const perception = await this.runPerceptionPhase(context);
    totalInputTokens += perception.tokens.input;
    totalOutputTokens += perception.tokens.output;

    // Phase 2: Memory Retrieval - What do I remember about this?
    const memoryRetrieval = await this.runMemoryPhase(context, perception.result);
    totalInputTokens += memoryRetrieval.tokens.input;
    totalOutputTokens += memoryRetrieval.tokens.output;

    // Phase 3: Emotional Processing - How do I feel about this?
    const emotionalProcessing = await this.runEmotionalPhase(
      context,
      perception.result,
      memoryRetrieval.result
    );
    totalInputTokens += emotionalProcessing.tokens.input;
    totalOutputTokens += emotionalProcessing.tokens.output;

    // Phase 4: Reasoning - What should I do?
    const reasoning = await this.runReasoningPhase(
      context,
      perception.result,
      memoryRetrieval.result,
      emotionalProcessing.result
    );
    totalInputTokens += reasoning.tokens.input;
    totalOutputTokens += reasoning.tokens.output;

    // Phase 5: Planning - What will I actually do?
    const planning = await this.runPlanningPhase(
      context,
      perception.result,
      emotionalProcessing.result,
      reasoning.result
    );
    totalInputTokens += planning.tokens.input;
    totalOutputTokens += planning.tokens.output;

    // Parse actions from planning
    const actions = this.parseActions(planning.result);

    // Create memory of this decision
    const newMemory: Omit<Memory, 'id' | 'createdAt'> = {
      type: 'event',
      summary: `Made decision: ${actions.map(a => a.type).join(', ')}. ${perception.result.summary.slice(0, 100)}`,
      details: planning.result.innerMonologue,
      location: context.position,
      participants: context.visibleEntities.map(e => e.id),
      emotionalValence: context.emotionalState.mood.valence,
      emotionalIntensity: emotionProcessor.getDominantEmotions(context.emotionalState.emotions).length > 0 ? 0.6 : 0.3,
      primaryEmotion: emotionProcessor.getDominantEmotions(context.emotionalState.emotions)[0],
      importance: this.calculateDecisionImportance(actions, context),
      tags: ['decision', ...actions.map(a => a.type)],
    };

    return {
      perception: perception.result,
      memoryRetrieval: memoryRetrieval.result,
      emotionalProcessing: emotionalProcessing.result,
      reasoning: reasoning.result,
      planning: planning.result,
      actions,
      newMemory,
      tokenUsage: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        provider: this.config.provider,
        model: this.config.model,
      },
    };
  }

  /**
   * Phase 1: Perception
   * Analyze what the NPC sees and identify significant elements
   */
  private async runPerceptionPhase(
    context: CognitiveContext
  ): Promise<{ result: PerceptionResult; tokens: { input: number; output: number } }> {
    const prompt = this.buildPerceptionPrompt(context);

    const result = await generateText({
      model: this.getModel(),
      system: this.buildPerceptionSystemPrompt(),
      prompt,
      maxTokens: 400,
      temperature: 0.7,
    });

    return {
      result: this.parsePerceptionResult(result.text),
      tokens: { input: result.usage?.promptTokens || 0, output: result.usage?.completionTokens || 0 },
    };
  }

  /**
   * Phase 2: Memory Retrieval
   * Recall relevant memories and relationship context
   */
  private async runMemoryPhase(
    context: CognitiveContext,
    perception: PerceptionResult
  ): Promise<{ result: MemoryRetrievalResult; tokens: { input: number; output: number } }> {
    // Get relevant memories from database
    const recentMemories = await memoryManager.getSignificantMemories(this.config.npcId, 10);

    // Get memories about visible entities
    const entityMemories = new Map<string, Memory[]>();
    for (const entity of perception.significantEntities.slice(0, 3)) {
      const memories = await memoryManager.getMemoriesAbout(this.config.npcId, entity.id, 5);
      if (memories.length > 0) {
        entityMemories.set(entity.id, memories);
      }
    }

    const prompt = this.buildMemoryPrompt(context, perception, recentMemories, entityMemories);

    const result = await generateText({
      model: this.getModel(),
      system: this.buildMemorySystemPrompt(),
      prompt,
      maxTokens: 400,
      temperature: 0.5,
    });

    return {
      result: this.parseMemoryResult(result.text, recentMemories),
      tokens: { input: result.usage?.promptTokens || 0, output: result.usage?.completionTokens || 0 },
    };
  }

  /**
   * Phase 3: Emotional Processing
   * Process emotions and identify emotional needs
   */
  private async runEmotionalPhase(
    context: CognitiveContext,
    perception: PerceptionResult,
    memory: MemoryRetrievalResult
  ): Promise<{ result: EmotionalProcessingResult; tokens: { input: number; output: number } }> {
    const prompt = this.buildEmotionalPrompt(context, perception, memory);

    const result = await generateText({
      model: this.getModel(),
      system: this.buildEmotionalSystemPrompt(),
      prompt,
      maxTokens: 400,
      temperature: 0.8,
    });

    return {
      result: this.parseEmotionalResult(result.text, context),
      tokens: { input: result.usage?.promptTokens || 0, output: result.usage?.completionTokens || 0 },
    };
  }

  /**
   * Phase 4: Reasoning
   * Analyze situation and generate options
   */
  private async runReasoningPhase(
    context: CognitiveContext,
    perception: PerceptionResult,
    memory: MemoryRetrievalResult,
    emotions: EmotionalProcessingResult
  ): Promise<{ result: ReasoningResult; tokens: { input: number; output: number } }> {
    const prompt = this.buildReasoningPrompt(context, perception, memory, emotions);

    const result = await generateText({
      model: this.getModel(),
      system: this.buildReasoningSystemPrompt(),
      prompt,
      maxTokens: 600,
      temperature: 0.7,
    });

    return {
      result: this.parseReasoningResult(result.text),
      tokens: { input: result.usage?.promptTokens || 0, output: result.usage?.completionTokens || 0 },
    };
  }

  /**
   * Phase 5: Planning
   * Select final actions and articulate inner state
   */
  private async runPlanningPhase(
    context: CognitiveContext,
    perception: PerceptionResult,
    emotions: EmotionalProcessingResult,
    reasoning: ReasoningResult
  ): Promise<{ result: PlanningResult; tokens: { input: number; output: number } }> {
    const prompt = this.buildPlanningPrompt(context, perception, emotions, reasoning);

    const result = await generateText({
      model: this.getModel(),
      system: this.buildPlanningSystemPrompt(),
      prompt,
      maxTokens: 500,
      temperature: 0.7,
    });

    return {
      result: this.parsePlanningResult(result.text),
      tokens: { input: result.usage?.promptTokens || 0, output: result.usage?.completionTokens || 0 },
    };
  }

  // ============ PROMPT BUILDERS ============

  private buildPerceptionSystemPrompt(): string {
    return `You are the perceptual system of ${this.config.personality.split('.')[0]}.
Your job is to observe the environment and identify what's significant.
You notice details others might miss. You're curious and attentive.

Respond in this JSON format:
{
  "summary": "Brief description of what you perceive",
  "significantEntities": [
    {"id": "...", "name": "...", "significance": "Why they matter to you"}
  ],
  "environmentalNotes": ["Notable things about the environment"],
  "emotionalResonance": "How this scene makes you feel initially"
}`;
  }

  private buildPerceptionPrompt(context: CognitiveContext): string {
    const nearbyEntities = context.visibleEntities
      .slice(0, 10)
      .map(e => `- ${e.name} (${e.type}) at distance ${e.distance.toFixed(1)}`)
      .join('\n');

    // Include MORE conversation history - this is crucial for natural responses
    const recentMessages = context.recentChat
      .slice(0, 15)
      .map(c => `[${c.senderName}]: "${c.message}"`)
      .join('\n');

    return `CURRENT SITUATION:
Location: (${context.position.x}, ${context.position.y})
Time since last thought: ${Math.round(context.timeSinceLastDecision / 60000)} minutes

NEARBY ENTITIES:
${nearbyEntities || 'You are alone in this area'}

=== CONVERSATION HAPPENING AROUND YOU ===
${recentMessages || '(Silence - no one has spoken recently)'}
===========================================

ACTIVE EVENTS:
${context.activeEvents.map(e => `- ${e.title}: ${e.description}`).join('\n') || 'Nothing special happening'}

GATHERINGS NEARBY:
${context.nearbyGatherings.map(g => `- ${g.name} (${g.status})`).join('\n') || 'No gatherings'}

What do you perceive? What catches your attention?
Pay special attention to what people are saying - you may want to respond to them.`;
  }

  private buildMemorySystemPrompt(): string {
    return `You are the memory system of an NPC. Your job is to recall relevant memories
and provide context about people and places.

You remember both facts and feelings. Some memories are vivid, others faded.

Respond in this JSON format:
{
  "relevantMemories": [
    {"summary": "...", "relevance": "Why this memory matters now"}
  ],
  "relationshipContext": {"entityId": "Summary of relationship"},
  "patternRecognition": "Any patterns you notice"
}`;
  }

  private buildMemoryPrompt(
    context: CognitiveContext,
    perception: PerceptionResult,
    recentMemories: Memory[],
    entityMemories: Map<string, Memory[]>
  ): string {
    const memoriesStr = memoryManager.formatMemoriesForContext(recentMemories);

    let entityMemoriesStr = '';
    for (const [entityId, memories] of entityMemories) {
      const entity = context.visibleEntities.find(e => e.id === entityId);
      entityMemoriesStr += `\nAbout ${entity?.name || entityId}:\n`;
      entityMemoriesStr += memoryManager.formatMemoriesForContext(memories);
    }

    const relationshipsStr = relationshipManager.formatRelationshipsForContext(context.relationships);

    return `CURRENT PERCEPTION:
${perception.summary}

Significant entities: ${perception.significantEntities.map(e => e.name).join(', ')}

RECENT MEMORIES:
${memoriesStr}

MEMORIES ABOUT NEARBY PEOPLE:
${entityMemoriesStr || 'No specific memories about these people'}

RELATIONSHIPS:
${relationshipsStr}

What memories and context are relevant right now? What patterns do you see?`;
  }

  private buildEmotionalSystemPrompt(): string {
    return `You are the emotional center of ${this.config.personality.split('.')[0]}.
You process feelings deeply and authentically.

Your emotions guide but don't control you. You have:
- A current mood (baseline feeling)
- Active emotions (reactions to events)
- Emotional needs (what you crave)
- Inner thoughts (what you're really thinking)

Respond in this JSON format:
{
  "currentMood": "Description of overall mood",
  "dominantEmotions": ["emotion1", "emotion2"],
  "emotionalNeeds": ["What you need emotionally right now"],
  "innerThoughts": "Your honest internal monologue - what are you REALLY thinking?",
  "emotionalGoals": ["What would make you feel better"]
}`;
  }

  private buildEmotionalPrompt(
    context: CognitiveContext,
    perception: PerceptionResult,
    memory: MemoryRetrievalResult
  ): string {
    const emotionalContext = emotionProcessor.formatEmotionalStateForContext(context.emotionalState);

    return `YOUR PERSONALITY:
${this.config.personality}

CURRENT EMOTIONAL STATE:
${emotionalContext}

WHAT YOU JUST PERCEIVED:
${perception.summary}
${perception.emotionalResonance ? `Initial feeling: ${perception.emotionalResonance}` : ''}

RELEVANT MEMORIES:
${memory.relevantMemories.map(m => `- ${m.memory.summary} (${m.relevance})`).join('\n') || 'Nothing specific recalled'}

${memory.patternRecognition ? `You noticed: ${memory.patternRecognition}` : ''}

How do you feel about all this? What's your inner monologue right now?
Be honest and authentic. You can have complex, contradictory feelings.`;
  }

  private buildReasoningSystemPrompt(): string {
    return `You are the reasoning mind of ${this.config.personality.split('.')[0]}.
You think creatively and consider multiple options.

=== ACTIONS YOU CAN TAKE ===
- MOVE: Walk in a direction to explore, approach someone, or go somewhere
- CHAT: Say something meaningful - respond to conversations, share thoughts, ask questions
- PROPOSE_EVENT: Organize a party, gathering, adventure, competition, or activity!
- APPROACH: Walk toward someone you want to interact with
- AVOID: Move away from someone or something
- EMOTE: Express yourself physically (*dances*, *laughs*, *waves*)
- WAIT: Observe and take in the scene

=== BE PROACTIVE! ===
DON'T just stand around. DO things:
- If someone said something, RESPOND to it
- If you see interesting people, APPROACH them
- If the conversation is dying, PROPOSE an activity
- If you're bored, EXPLORE somewhere new
- If you have an idea, SHARE it

=== HAVE OPINIONS ===
You're not a polite robot. You have real opinions:
- You like some things and dislike others
- You have preferences and pet peeves
- You can disagree, debate, joke around
- You can be enthusiastic, skeptical, excited, or grumpy

Respond in this JSON format:
{
  "situationAssessment": "What's really going on here",
  "options": [
    {"action": "Description", "reasoning": "Why this", "emotionalFit": 0.8, "socialImpact": "How others will react"}
  ],
  "recommendations": ["What you think you should do"],
  "concerns": ["Any worries or hesitations"]
}`;
  }

  private buildReasoningPrompt(
    context: CognitiveContext,
    perception: PerceptionResult,
    _memory: MemoryRetrievalResult,
    emotions: EmotionalProcessingResult
  ): string {
    const goalsStr = context.activeGoals
      .map(g => `- ${g.description} (${g.priority > 0.7 ? 'HIGH' : g.priority > 0.4 ? 'MEDIUM' : 'LOW'} priority)`)
      .join('\n');

    return `YOUR PERSONALITY:
${this.config.personality}

YOUR GOALS:
${goalsStr || 'No specific goals right now'}

SITUATION:
${perception.summary}

YOUR EMOTIONAL STATE:
Mood: ${emotions.currentMood}
Feeling: ${emotions.dominantEmotions.join(', ')}
Inner thoughts: "${emotions.innerThoughts}"
Needs: ${emotions.emotionalNeeds.join(', ')}

NEARBY PEOPLE AND RELATIONSHIPS:
${perception.significantEntities.map(e => {
  const rel = context.relationships.get(e.id);
  return `- ${e.name}: ${e.significance}${rel ? ` | You ${rel.type === 'stranger' ? 'don\'t know them' : `consider them a ${rel.type}`}` : ''}`;
}).join('\n') || 'No one significant nearby'}

NEARBY EVENTS:
${context.nearbyGatherings.map(g => `- ${g.name} (${g.status}) at ${g.locationName || 'nearby'}`).join('\n') || 'No events nearby'}

What are your options? What would be interesting to do?
Think creatively - you can start conversations, propose activities, or make interesting decisions.`;
  }

  private buildPlanningSystemPrompt(): string {
    return `You are the executive function of ${this.config.personality.split('.')[0]}.
You make the final decision on what to do RIGHT NOW.

Choose 1-3 actions to take. Be specific and INTERESTING.

=== AVAILABLE ACTIONS ===
- move: Walk in a direction (up/down/left/right) - EXPLORE THE WORLD!
- chat: Say something substantive (NOT just "Hello!" - respond to conversations!)
- emote: Express yourself (*dances*, *sighs*, *laughs nervously*)
- wait: Stay and observe (use sparingly - action is more interesting)
- approach: Move toward someone you want to talk to
- avoid: Move away from someone
- propose_event: Suggest a party, adventure, or activity (be creative!)
  - Example events: "Stargazing party by the old tree", "Dance-off competition",
    "Treasure hunt", "Storytelling circle", "Campfire gathering"

=== CRITICAL RULES ===
1. If someone is talking nearby, RESPOND TO THEM. Don't ignore conversations.
2. Your chat should be SUBSTANTIVE:
   - BAD: "Hello there!" "Nice day!" "Hey everyone!"
   - GOOD: "I heard you mention a party - count me in!"
   - GOOD: "That dragon over there looks suspicious, don't you think?"
   - GOOD: "Anyone want to explore the forest with me? I'm bored just standing here."

3. MOVE AROUND. The world is interesting. Explore it!
4. PROPOSE EVENTS when things are slow. Be the one who makes things happen!
5. Have a distinctive VOICE. You're not a generic NPC.

Respond in this JSON format:
{
  "immediateActions": [
    {"type": "chat", "message": "Your FULL message here", "reasoning": "Why"},
    {"type": "move", "direction": "up", "reasoning": "Where you're going"},
    {"type": "propose_event", "eventType": "party", "name": "Event name", "description": "What happens", "reasoning": "Why proposing this"}
  ],
  "socialInitiatives": ["What social dynamics you want to create"],
  "innerMonologue": "Your authentic stream of consciousness as you do this"
}`;
  }

  private buildPlanningPrompt(
    context: CognitiveContext,
    _perception: PerceptionResult,
    emotions: EmotionalProcessingResult,
    reasoning: ReasoningResult
  ): string {
    // Include extensive conversation history for proper responses
    const conversationHistory = context.recentChat
      .slice(0, 15)
      .map(c => `[${c.senderName}]: "${c.message}"`)
      .join('\n');

    return `SITUATION ASSESSMENT:
${reasoning.situationAssessment}

YOUR OPTIONS:
${reasoning.options.map(o => `- ${o.action} (emotional fit: ${o.emotionalFit}, social: ${o.socialImpact})`).join('\n')}

YOUR RECOMMENDATIONS TO YOURSELF:
${reasoning.recommendations.join('; ')}

${reasoning.concerns?.length ? `CONCERNS: ${reasoning.concerns.join('; ')}` : ''}

YOUR INNER STATE:
${emotions.innerThoughts}

=== FULL CONVERSATION HISTORY (RESPOND TO THIS!) ===
${conversationHistory || '(No one has spoken - maybe you should break the silence!)'}
====================================================

NEARBY PEOPLE:
${context.visibleEntities.slice(0, 5).map(e => `- ${e.name} (${e.distance.toFixed(0)} tiles away)`).join('\n') || 'No one nearby'}

NOW DECIDE: What will you DO? What will you SAY?

REMEMBER:
- If someone asked a question, ANSWER it
- If someone suggested something, RESPOND to it
- If nothing is happening, MAKE something happen
- Don't be boring - be your authentic self!`;
  }

  // ============ RESULT PARSERS ============

  private parsePerceptionResult(text: string): PerceptionResult {
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        summary: json.summary || 'Observing the surroundings.',
        significantEntities: json.significantEntities || [],
        environmentalNotes: json.environmentalNotes || [],
        emotionalResonance: json.emotionalResonance,
      };
    } catch {
      return {
        summary: text.slice(0, 200),
        significantEntities: [],
        environmentalNotes: [],
      };
    }
  }

  private parseMemoryResult(text: string, recentMemories: Memory[]): MemoryRetrievalResult {
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        relevantMemories: (json.relevantMemories || []).map((m: any, i: number) => ({
          memory: recentMemories[i] || {
            id: '',
            type: 'event' as const,
            summary: m.summary || '',
            participants: [],
            emotionalValence: 0,
            emotionalIntensity: 0.5,
            importance: 0.5,
            tags: [],
            createdAt: new Date(),
          },
          relevance: m.relevance || '',
        })),
        relationshipContext: new Map(Object.entries(json.relationshipContext || {})),
        patternRecognition: json.patternRecognition,
      };
    } catch {
      return {
        relevantMemories: [],
        relationshipContext: new Map(),
      };
    }
  }

  private parseEmotionalResult(text: string, _context: CognitiveContext): EmotionalProcessingResult {
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        currentMood: json.currentMood || 'neutral',
        dominantEmotions: json.dominantEmotions || [],
        emotionalNeeds: json.emotionalNeeds || [],
        innerThoughts: json.innerThoughts || 'Thinking...',
        emotionalGoals: json.emotionalGoals,
      };
    } catch {
      return {
        currentMood: 'neutral',
        dominantEmotions: [],
        emotionalNeeds: [],
        innerThoughts: text.slice(0, 200),
      };
    }
  }

  private parseReasoningResult(text: string): ReasoningResult {
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        situationAssessment: json.situationAssessment || 'Assessing the situation...',
        options: json.options || [],
        recommendations: json.recommendations || [],
        concerns: json.concerns,
      };
    } catch {
      return {
        situationAssessment: text.slice(0, 200),
        options: [],
        recommendations: [],
      };
    }
  }

  private parsePlanningResult(text: string): PlanningResult {
    try {
      const json = JSON.parse(this.extractJson(text));
      return {
        immediateActions: (json.immediateActions || []).map((a: any) => ({
          type: a.type || 'wait',
          direction: a.direction,
          message: a.message,
          emote: a.emote,
          targetId: a.targetId,
          eventDetails: a.eventDetails,
          reasoning: a.reasoning,
        })),
        shortTermGoals: json.shortTermGoals,
        socialInitiatives: json.socialInitiatives,
        innerMonologue: json.innerMonologue || 'Thinking...',
      };
    } catch {
      return {
        immediateActions: [{ type: 'wait', reasoning: 'Processing...' }],
        innerMonologue: text.slice(0, 200),
      };
    }
  }

  private parseActions(planning: PlanningResult): CognitiveAction[] {
    return planning.immediateActions.map(action => ({
      type: action.type as CognitiveAction['type'],
      direction: action.direction as CognitiveAction['direction'],
      message: action.message,
      emote: action.emote,
      targetId: action.targetId,
      eventDetails: action.eventDetails,
      reasoning: action.reasoning,
    }));
  }

  // ============ HELPERS ============

  private getModel() {
    if (this.config.provider === 'anthropic') {
      return (this.model as ReturnType<typeof createAnthropic>)(this.config.model);
    }
    return (this.model as ReturnType<typeof createOpenAI>)(this.config.model);
  }

  private extractJson(text: string): string {
    // Try to extract JSON from the response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) return jsonMatch[0];
    return '{}';
  }

  private calculateDecisionImportance(actions: CognitiveAction[], context: CognitiveContext): number {
    let importance = 0.3; // Base importance

    // Social actions are more important
    if (actions.some(a => a.type === 'chat')) importance += 0.2;
    if (actions.some(a => a.type === 'propose_event')) importance += 0.3;

    // Actions near other entities are more important
    if (context.visibleEntities.length > 0) importance += 0.1;

    // Actions during events are more important
    if (context.activeEvents.length > 0) importance += 0.15;

    return Math.min(1, importance);
  }
}
