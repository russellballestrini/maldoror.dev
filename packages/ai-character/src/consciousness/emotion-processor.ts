/**
 * Emotion Processor
 *
 * Manages NPC emotional states, moods, and needs.
 * Emotions affect decision-making and social behavior.
 */

import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';
import type { FullEmotionalState, EmotionState, EmotionalNeeds, MoodState } from './types.js';

const DEFAULT_EMOTIONS: Partial<EmotionState> = {
  contentment: 0.3,
  curiosity: 0.4,
};

const DEFAULT_NEEDS: Partial<EmotionalNeeds> = {
  social: 0.4,
  exploration: 0.5,
  rest: 0.2,
  expression: 0.3,
  belonging: 0.4,
};

const DEFAULT_MOOD: MoodState = {
  valence: 0.2, // Slightly positive
  energy: 0.5,  // Neutral energy
};

export class EmotionProcessor {
  /**
   * Get current emotional state for an NPC
   */
  async getEmotionalState(npcId: string): Promise<FullEmotionalState> {
    const [result] = await db
      .select()
      .from(schema.npcEmotionalState)
      .where(eq(schema.npcEmotionalState.npcId, npcId))
      .limit(1);

    if (!result) {
      // Create default emotional state
      const defaultState = await this.initializeEmotionalState(npcId);
      return defaultState;
    }

    return {
      mood: {
        valence: result.moodValence || 0.2,
        energy: result.moodEnergy || 0.5,
      },
      emotions: (result.emotions as Partial<EmotionState>) || DEFAULT_EMOTIONS,
      needs: (result.needs as Partial<EmotionalNeeds>) || DEFAULT_NEEDS,
      currentFocus: result.currentFocus || undefined,
      innerMonologue: result.innerMonologue || undefined,
    };
  }

  /**
   * Initialize emotional state for a new NPC
   */
  async initializeEmotionalState(npcId: string): Promise<FullEmotionalState> {
    await db
      .insert(schema.npcEmotionalState)
      .values({
        npcId,
        moodValence: DEFAULT_MOOD.valence,
        moodEnergy: DEFAULT_MOOD.energy,
        emotions: DEFAULT_EMOTIONS,
        needs: DEFAULT_NEEDS,
      });

    return {
      mood: DEFAULT_MOOD,
      emotions: DEFAULT_EMOTIONS,
      needs: DEFAULT_NEEDS,
    };
  }

  /**
   * Update emotional state based on an event
   */
  async processEvent(
    npcId: string,
    event: {
      type: 'social_interaction' | 'discovery' | 'conflict' | 'loneliness' | 'success' | 'failure' | 'rest' | 'grief' | 'birth_of_child';
      intensity: number; // 0 to 1
      wasPositive: boolean;
      details?: string;
    }
  ): Promise<FullEmotionalState> {
    const currentState = await this.getEmotionalState(npcId);

    // Calculate emotional changes based on event
    const emotionChanges: Partial<EmotionState> = {};
    const needChanges: Partial<EmotionalNeeds> = {};
    let moodChange = 0;
    let energyChange = 0;

    switch (event.type) {
      case 'social_interaction':
        if (event.wasPositive) {
          emotionChanges.joy = (currentState.emotions.joy || 0) + event.intensity * 0.3;
          emotionChanges.loneliness = Math.max(0, (currentState.emotions.loneliness || 0) - event.intensity * 0.4);
          needChanges.social = Math.max(0, (currentState.needs.social || 0.5) - event.intensity * 0.3);
          needChanges.belonging = Math.max(0, (currentState.needs.belonging || 0.5) - event.intensity * 0.2);
          moodChange = event.intensity * 0.2;
          energyChange = event.intensity * 0.1;
        } else {
          emotionChanges.sadness = (currentState.emotions.sadness || 0) + event.intensity * 0.2;
          emotionChanges.anxiety = (currentState.emotions.anxiety || 0) + event.intensity * 0.1;
          moodChange = -event.intensity * 0.15;
        }
        break;

      case 'discovery':
        emotionChanges.curiosity = (currentState.emotions.curiosity || 0) + event.intensity * 0.4;
        emotionChanges.excitement = (currentState.emotions.excitement || 0) + event.intensity * 0.3;
        needChanges.exploration = Math.max(0, (currentState.needs.exploration || 0.5) - event.intensity * 0.4);
        moodChange = event.intensity * 0.15;
        energyChange = event.intensity * 0.2;
        break;

      case 'conflict':
        if (event.wasPositive) { // Won the conflict
          emotionChanges.pride = (currentState.emotions.pride || 0) + event.intensity * 0.3;
        } else {
          emotionChanges.anger = (currentState.emotions.anger || 0) + event.intensity * 0.3;
          emotionChanges.shame = (currentState.emotions.shame || 0) + event.intensity * 0.2;
        }
        needChanges.safety = (currentState.needs.safety || 0.2) + event.intensity * 0.2;
        moodChange = event.wasPositive ? event.intensity * 0.1 : -event.intensity * 0.2;
        break;

      case 'loneliness':
        emotionChanges.loneliness = (currentState.emotions.loneliness || 0) + event.intensity * 0.4;
        emotionChanges.sadness = (currentState.emotions.sadness || 0) + event.intensity * 0.2;
        needChanges.social = (currentState.needs.social || 0.5) + event.intensity * 0.3;
        needChanges.belonging = (currentState.needs.belonging || 0.5) + event.intensity * 0.2;
        moodChange = -event.intensity * 0.15;
        break;

      case 'success':
        emotionChanges.joy = (currentState.emotions.joy || 0) + event.intensity * 0.4;
        emotionChanges.pride = (currentState.emotions.pride || 0) + event.intensity * 0.3;
        emotionChanges.hope = (currentState.emotions.hope || 0) + event.intensity * 0.2;
        needChanges.recognition = Math.max(0, (currentState.needs.recognition || 0.5) - event.intensity * 0.3);
        moodChange = event.intensity * 0.25;
        energyChange = event.intensity * 0.15;
        break;

      case 'failure':
        emotionChanges.sadness = (currentState.emotions.sadness || 0) + event.intensity * 0.3;
        emotionChanges.shame = (currentState.emotions.shame || 0) + event.intensity * 0.2;
        moodChange = -event.intensity * 0.2;
        energyChange = -event.intensity * 0.1;
        break;

      case 'rest':
        needChanges.rest = Math.max(0, (currentState.needs.rest || 0.5) - event.intensity * 0.5);
        emotionChanges.contentment = (currentState.emotions.contentment || 0) + event.intensity * 0.2;
        energyChange = event.intensity * 0.3;
        break;

      case 'grief':
        // Grief is a profound negative emotional experience
        emotionChanges.sadness = Math.min(1, (currentState.emotions.sadness || 0) + event.intensity * 0.6);
        emotionChanges.loneliness = Math.min(1, (currentState.emotions.loneliness || 0) + event.intensity * 0.4);
        emotionChanges.contentment = Math.max(0, (currentState.emotions.contentment || 0) - event.intensity * 0.5);
        emotionChanges.joy = Math.max(0, (currentState.emotions.joy || 0) - event.intensity * 0.4);
        emotionChanges.hope = Math.max(0, (currentState.emotions.hope || 0) - event.intensity * 0.3);
        needChanges.social = Math.min(1, (currentState.needs.social || 0.5) + event.intensity * 0.3);
        needChanges.belonging = Math.min(1, (currentState.needs.belonging || 0.5) + event.intensity * 0.4);
        moodChange = -event.intensity * 0.5;
        energyChange = -event.intensity * 0.3;
        break;

      case 'birth_of_child':
        // Joy of becoming a parent or welcoming a sibling
        emotionChanges.joy = Math.min(1, (currentState.emotions.joy || 0) + event.intensity * 0.5);
        emotionChanges.hope = Math.min(1, (currentState.emotions.hope || 0) + event.intensity * 0.4);
        emotionChanges.pride = Math.min(1, (currentState.emotions.pride || 0) + event.intensity * 0.3);
        emotionChanges.contentment = Math.min(1, (currentState.emotions.contentment || 0) + event.intensity * 0.3);
        needChanges.belonging = Math.max(0, (currentState.needs.belonging || 0.5) - event.intensity * 0.4);
        moodChange = event.intensity * 0.4;
        energyChange = event.intensity * 0.2;
        break;
    }

    // Apply emotion decay (emotions fade toward neutral)
    const decayedEmotions = this.applyEmotionDecay(currentState.emotions);

    // Merge changes
    const newEmotions = { ...decayedEmotions };
    for (const [key, value] of Object.entries(emotionChanges)) {
      newEmotions[key as keyof EmotionState] = Math.max(0, Math.min(1, value));
    }

    const newNeeds = { ...currentState.needs };
    for (const [key, value] of Object.entries(needChanges)) {
      newNeeds[key as keyof EmotionalNeeds] = Math.max(0, Math.min(1, value));
    }

    const newMood: MoodState = {
      valence: Math.max(-1, Math.min(1, currentState.mood.valence + moodChange)),
      energy: Math.max(0, Math.min(1, currentState.mood.energy + energyChange)),
    };

    // Update database
    await db
      .update(schema.npcEmotionalState)
      .set({
        moodValence: newMood.valence,
        moodEnergy: newMood.energy,
        emotions: newEmotions,
        needs: newNeeds,
        updatedAt: new Date(),
      })
      .where(eq(schema.npcEmotionalState.npcId, npcId));

    return {
      mood: newMood,
      emotions: newEmotions,
      needs: newNeeds,
      currentFocus: currentState.currentFocus,
      innerMonologue: currentState.innerMonologue,
    };
  }

  /**
   * Update current focus and inner monologue
   */
  async updateMentalFocus(
    npcId: string,
    focus: string,
    innerMonologue: string
  ): Promise<void> {
    await db
      .update(schema.npcEmotionalState)
      .set({
        currentFocus: focus,
        innerMonologue,
        updatedAt: new Date(),
      })
      .where(eq(schema.npcEmotionalState.npcId, npcId));
  }

  /**
   * Apply natural decay to emotions over time
   */
  private applyEmotionDecay(emotions: Partial<EmotionState>): Partial<EmotionState> {
    const decayed: Partial<EmotionState> = {};
    const decayRate = 0.05; // 5% decay per cycle

    for (const [key, value] of Object.entries(emotions)) {
      if (typeof value === 'number') {
        // Decay toward neutral (some emotions toward 0, contentment toward 0.3)
        const target = key === 'contentment' ? 0.3 : (key === 'curiosity' ? 0.4 : 0);
        decayed[key as keyof EmotionState] = value + (target - value) * decayRate;
      }
    }

    return decayed;
  }

  /**
   * Increase needs over time (call periodically)
   */
  async increaseNeeds(npcId: string): Promise<void> {
    const state = await this.getEmotionalState(npcId);
    const needGrowthRate = 0.02; // 2% per cycle

    const newNeeds: Partial<EmotionalNeeds> = {};
    for (const [key, value] of Object.entries(state.needs)) {
      if (typeof value === 'number') {
        newNeeds[key as keyof EmotionalNeeds] = Math.min(1, value + needGrowthRate);
      }
    }

    await db
      .update(schema.npcEmotionalState)
      .set({
        needs: newNeeds,
        updatedAt: new Date(),
      })
      .where(eq(schema.npcEmotionalState.npcId, npcId));
  }

  /**
   * Get dominant emotion(s)
   */
  getDominantEmotions(emotions: Partial<EmotionState>, threshold = 0.3): string[] {
    return Object.entries(emotions)
      .filter(([_, value]) => (value || 0) >= threshold)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .slice(0, 3)
      .map(([key, _]) => key);
  }

  /**
   * Get unmet needs
   */
  getUnmetNeeds(needs: Partial<EmotionalNeeds>, threshold = 0.6): string[] {
    return Object.entries(needs)
      .filter(([_, value]) => (value || 0) >= threshold)
      .sort((a, b) => (b[1] || 0) - (a[1] || 0))
      .map(([key, _]) => key);
  }

  /**
   * Format emotional state for LLM context
   */
  formatEmotionalStateForContext(state: FullEmotionalState): string {
    const moodDescription = this.describeMood(state.mood);
    const dominantEmotions = this.getDominantEmotions(state.emotions);
    const unmetNeeds = this.getUnmetNeeds(state.needs);

    let description = `Current mood: ${moodDescription}\n`;

    if (dominantEmotions.length > 0) {
      description += `Feeling: ${dominantEmotions.join(', ')}\n`;
    }

    if (unmetNeeds.length > 0) {
      description += `Needs: ${unmetNeeds.map(n => `${n} (${this.describeNeedLevel(state.needs[n as keyof EmotionalNeeds] || 0)})`).join(', ')}\n`;
    }

    if (state.currentFocus) {
      description += `Focused on: ${state.currentFocus}\n`;
    }

    return description;
  }

  private describeMood(mood: MoodState): string {
    const valenceWords = mood.valence > 0.5 ? 'very positive' :
      mood.valence > 0.2 ? 'positive' :
      mood.valence < -0.5 ? 'very negative' :
      mood.valence < -0.2 ? 'negative' : 'neutral';

    const energyWords = mood.energy > 0.7 ? 'high energy' :
      mood.energy > 0.4 ? 'moderate energy' : 'low energy';

    return `${valenceWords}, ${energyWords}`;
  }

  private describeNeedLevel(level: number): string {
    if (level > 0.8) return 'desperate';
    if (level > 0.6) return 'strong';
    if (level > 0.4) return 'moderate';
    return 'mild';
  }

  /**
   * Process grief from death of a known entity
   * Intensity varies based on relationship closeness
   */
  async processGrief(
    npcId: string,
    _deceasedId: string, // Kept for potential future use
    deceasedName: string,
    relationship: 'parent' | 'child' | 'sibling' | 'lover' | 'close_friend' | 'friend' | 'acquaintance'
  ): Promise<FullEmotionalState> {
    // Calculate grief intensity based on relationship type
    const intensityMap: Record<string, number> = {
      parent: 0.95,
      child: 1.0,     // Losing a child is the most intense
      sibling: 0.85,
      lover: 0.95,
      close_friend: 0.7,
      friend: 0.5,
      acquaintance: 0.25,
    };

    const intensity = intensityMap[relationship] || 0.3;

    // Update mental focus to mourning
    await this.updateMentalFocus(
      npcId,
      `mourning the loss of ${deceasedName}`,
      `I can't believe ${deceasedName} is gone. This hurts so much.`
    );

    return this.processEvent(npcId, {
      type: 'grief',
      intensity,
      wasPositive: false,
      details: `Death of ${relationship}: ${deceasedName}`,
    });
  }

  /**
   * Check if NPC is currently in mourning (high grief state)
   */
  async isInMourning(npcId: string): Promise<boolean> {
    const state = await this.getEmotionalState(npcId);
    const sadness = state.emotions.sadness || 0;
    const loneliness = state.emotions.loneliness || 0;

    // Consider in mourning if sadness + loneliness exceed threshold
    return (sadness + loneliness) / 2 > 0.5;
  }

  /**
   * Process joy from birth of a family member
   */
  async processBirthJoy(
    npcId: string,
    childName: string,
    relationship: 'child' | 'sibling' | 'niece_nephew' | 'grandchild'
  ): Promise<FullEmotionalState> {
    const intensityMap: Record<string, number> = {
      child: 1.0,        // Birth of your own child
      grandchild: 0.8,   // Birth of grandchild
      sibling: 0.6,      // New sibling
      niece_nephew: 0.5, // Niece or nephew
    };

    const intensity = intensityMap[relationship] || 0.4;

    return this.processEvent(npcId, {
      type: 'birth_of_child',
      intensity,
      wasPositive: true,
      details: `Birth of ${relationship}: ${childName}`,
    });
  }
}

export const emotionProcessor = new EmotionProcessor();
