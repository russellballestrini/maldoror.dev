/**
 * Child Spawner
 *
 * Handles the creation of child NPCs from two parents.
 * Blends visual prompts and personalities to create unique offspring.
 */

import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { LifecycleConfig, LineageInfo } from './types.js';
import { DEFAULT_LIFECYCLE_CONFIG, calculateLifespan } from './lifecycle-config.js';
import { relationshipManager } from './relationship-manager.js';

export interface ParentInfo {
  id: string;
  name: string;
  visualPrompt?: string;
  personality?: string;
  familyName?: string;
  generation: number;
  geneticTraits?: LineageInfo['geneticTraits'];
}

export interface ChildBlueprint {
  name: string;
  visualPrompt: string;
  personality: string;
  goals: string[];
  familyName: string;
  geneticTraits: LineageInfo['geneticTraits'];
}

export interface SpawnedChild {
  id: string;
  name: string;
  lineageInfo: LineageInfo;
}

export class ChildSpawner {
  private config: LifecycleConfig;
  private anthropic = createAnthropic();

  constructor(config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG) {
    this.config = config;
  }

  /**
   * Get parent info from database
   */
  async getParentInfo(parentId: string): Promise<ParentInfo | null> {
    // Get user info
    const [user] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, parentId))
      .limit(1);

    if (!user) return null;

    // Get lineage info if exists
    const [lineage] = await db
      .select()
      .from(schema.npcLineage)
      .where(eq(schema.npcLineage.npcId, parentId))
      .limit(1);

    return {
      id: parentId,
      name: user.username,
      visualPrompt: user.visualPrompt || undefined,
      personality: user.personality || undefined,
      familyName: lineage?.familyName || undefined,
      generation: lineage?.generation || 0,
      geneticTraits: lineage?.geneticTraits as LineageInfo['geneticTraits'] || undefined,
    };
  }

  /**
   * Generate a blended child blueprint using AI
   */
  async generateChildBlueprint(
    parent1: ParentInfo,
    parent2: ParentInfo
  ): Promise<ChildBlueprint> {
    // Determine family name (use existing or create new)
    const familyName = parent1.familyName || parent2.familyName ||
      this.createFamilyName(parent1.name, parent2.name);

    const childGeneration = Math.max(parent1.generation, parent2.generation) + 1;

    const prompt = `You are creating a child character for a fantasy world simulation.

PARENT 1: ${parent1.name}
Visual appearance: ${parent1.visualPrompt || 'No description available'}
Personality: ${parent1.personality || 'No personality defined'}
Genetic traits: ${JSON.stringify(parent1.geneticTraits || {})}

PARENT 2: ${parent2.name}
Visual appearance: ${parent2.visualPrompt || 'No description available'}
Personality: ${parent2.personality || 'No personality defined'}
Genetic traits: ${JSON.stringify(parent2.geneticTraits || {})}

FAMILY: ${familyName} family (generation ${childGeneration})

Create a unique child character that blends traits from both parents. The child should:
1. Have a unique first name that fits the fantasy setting
2. Inherit physical features from both parents (blend eyes, hair, skin, body type)
3. Inherit some personality traits from each parent but also have unique qualities
4. Have age-appropriate goals for a baby/child

Respond in JSON format:
{
  "name": "FirstName",
  "visualPrompt": "A detailed visual description blending both parents' features...",
  "personality": "A 2-3 sentence personality description...",
  "goals": ["Goal 1", "Goal 2", "Goal 3"],
  "geneticTraits": {
    "dominantColors": ["color1", "color2"],
    "recessiveColors": ["color3"],
    "physicalFeatures": ["feature1", "feature2"],
    "personalityTendencies": ["tendency1", "tendency2"]
  }
}`;

    try {
      const response = await generateText({
        model: this.anthropic('claude-3-5-haiku-20241022'),
        prompt,
        maxTokens: 1024,
      });

      const text = response.text;

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse child blueprint from AI response');
      }

      const blueprint = JSON.parse(jsonMatch[0]) as {
        name: string;
        visualPrompt: string;
        personality: string;
        goals: string[];
        geneticTraits: LineageInfo['geneticTraits'];
      };

      return {
        name: blueprint.name,
        visualPrompt: blueprint.visualPrompt,
        personality: blueprint.personality,
        goals: blueprint.goals || ['Explore the world', 'Learn from parents', 'Play and grow'],
        familyName,
        geneticTraits: blueprint.geneticTraits,
      };
    } catch (error) {
      console.error('[ChildSpawner] Failed to generate blueprint:', error);
      // Fallback: create simple blend
      return this.createFallbackBlueprint(parent1, parent2, familyName);
    }
  }

  /**
   * Create a fallback blueprint if AI fails
   */
  private createFallbackBlueprint(
    parent1: ParentInfo,
    parent2: ParentInfo,
    familyName: string
  ): ChildBlueprint {
    // Simple name generation
    const names = ['Luna', 'Sol', 'Nova', 'Aria', 'Finn', 'Sage', 'River', 'Dawn', 'Star', 'Ember'];
    const name = names[Math.floor(Math.random() * names.length)]!;

    // Simple visual blend
    const visual1 = parent1.visualPrompt || 'a mysterious figure';
    const visual2 = parent2.visualPrompt || 'a mysterious figure';
    const visualPrompt = `A young child who inherits features from both ${parent1.name} and ${parent2.name}. ` +
      `They have a blend of characteristics from: "${visual1}" and "${visual2}".`;

    // Simple personality blend
    const p1Traits = parent1.personality?.split('.').slice(0, 1).join('.') || 'curious nature';
    const p2Traits = parent2.personality?.split('.').slice(0, 1).join('.') || 'adventurous spirit';
    const personality = `A curious and playful child who inherited ${p1Traits} from ${parent1.name} ` +
      `and ${p2Traits} from ${parent2.name}. They are eager to explore and learn.`;

    return {
      name,
      visualPrompt,
      personality,
      goals: ['Explore the world', 'Learn from parents', 'Play and grow'],
      familyName,
      geneticTraits: {
        dominantColors: [],
        recessiveColors: [],
        physicalFeatures: [],
        personalityTendencies: ['curious', 'playful'],
      },
    };
  }

  /**
   * Create a family name from parent names
   */
  private createFamilyName(name1: string, name2: string): string {
    // Take first syllable of each name and combine
    const syllable1 = name1.slice(0, Math.min(3, name1.length));
    const syllable2 = name2.slice(0, Math.min(3, name2.length));

    // Capitalize properly
    const combined = syllable1.charAt(0).toUpperCase() + syllable1.slice(1).toLowerCase() +
      syllable2.toLowerCase();

    return combined;
  }

  /**
   * Spawn a child NPC
   */
  async spawnChild(
    parent1Id: string,
    parent2Id: string,
    birthPosition: { x: number; y: number }
  ): Promise<SpawnedChild | null> {
    // Get parent info
    const parent1 = await this.getParentInfo(parent1Id);
    const parent2 = await this.getParentInfo(parent2Id);

    if (!parent1 || !parent2) {
      console.error('[ChildSpawner] Failed to get parent info');
      return null;
    }

    // Generate child blueprint
    const blueprint = await this.generateChildBlueprint(parent1, parent2);

    // Ensure unique username
    let username = blueprint.name;
    const existingUser = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.username, username))
      .limit(1);

    if (existingUser.length > 0) {
      username = `${blueprint.name}_${Math.random().toString(36).substring(2, 6)}`;
    }

    // Calculate lifespan
    const lifespanHours = calculateLifespan(this.config);
    const childGeneration = Math.max(parent1.generation, parent2.generation) + 1;

    // Create user record
    const [user] = await db
      .insert(schema.users)
      .values({
        username,
        isNpc: true,
        personality: blueprint.personality,
        goals: blueprint.goals,
        visualPrompt: blueprint.visualPrompt,
        aiProvider: 'anthropic',
        aiModel: 'claude-3-5-haiku-20241022',
        decisionIntervalMs: this.config.decisionIntervalByStage.baby,
        spawnX: birthPosition.x,
        spawnY: birthPosition.y,
        roamRadius: 3, // Babies stay close
        npcCreatorId: parent1Id, // Track creator
      })
      .returning();

    if (!user) {
      console.error('[ChildSpawner] Failed to create user record');
      return null;
    }

    // Create player state
    await db.insert(schema.playerState).values({
      userId: user.id,
      x: birthPosition.x,
      y: birthPosition.y,
      direction: 'down',
      isOnline: false,
    });

    // Create lineage record
    const [lineage] = await db
      .insert(schema.npcLineage)
      .values({
        npcId: user.id,
        parent1Id,
        parent2Id,
        generation: childGeneration,
        familyName: blueprint.familyName,
        birthLocationX: birthPosition.x,
        birthLocationY: birthPosition.y,
        lifecycleStage: 'baby',
        expectedLifespanHours: Math.round(lifespanHours),
        geneticTraits: blueprint.geneticTraits,
        inheritedVisualPrompt: blueprint.visualPrompt,
      })
      .returning();

    if (!lineage) {
      console.error('[ChildSpawner] Failed to create lineage record');
      return null;
    }

    // Create family bonds (parent-child relationships)
    await this.createFamilyBonds(user.id, username, parent1, parent2);

    const childInfo: SpawnedChild = {
      id: user.id,
      name: username,
      lineageInfo: {
        npcId: user.id,
        parent1Id,
        parent2Id,
        parent1Name: parent1.name,
        parent2Name: parent2.name,
        generation: childGeneration,
        familyName: blueprint.familyName,
        stage: 'baby',
        birthAt: lineage.birthAt,
        expectedLifespanHours: lineage.expectedLifespanHours,
        ageHours: 0,
        siblings: [],
        children: [],
        geneticTraits: blueprint.geneticTraits,
      },
    };

    console.log(`[ChildSpawner] Spawned child ${username} (${user.id}) at (${birthPosition.x}, ${birthPosition.y})`);
    console.log(`[ChildSpawner] Parents: ${parent1.name} & ${parent2.name}, Generation: ${childGeneration}`);

    return childInfo;
  }

  /**
   * Create family relationship bonds
   */
  private async createFamilyBonds(
    childId: string,
    childName: string,
    parent1: ParentInfo,
    parent2: ParentInfo
  ): Promise<void> {
    // Create parent-child bonds (high affection, trust)
    const familyBondUpdate = {
      familiarity: 1.0,
      affection: 0.9,
      trust: 0.9,
      respect: 0.3,
      attraction: 0,
      newImpression: 'family member',
      currentFeeling: 'familial love',
    };

    // Child -> Parent1
    await relationshipManager.updateRelationship(childId, parent1.id, familyBondUpdate);

    // Child -> Parent2
    await relationshipManager.updateRelationship(childId, parent2.id, familyBondUpdate);

    // Parent1 -> Child
    await relationshipManager.updateRelationship(parent1.id, childId, {
      ...familyBondUpdate,
      newImpression: `my child ${childName}`,
      currentFeeling: 'parental love',
    });

    // Parent2 -> Child
    await relationshipManager.updateRelationship(parent2.id, childId, {
      ...familyBondUpdate,
      newImpression: `my child ${childName}`,
      currentFeeling: 'parental love',
    });

    // Get siblings and create sibling bonds
    const siblings = await db
      .select({ npcId: schema.npcLineage.npcId })
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(eq(schema.npcLineage.parent1Id, parent1.id));

    const siblings2 = await db
      .select({ npcId: schema.npcLineage.npcId })
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(eq(schema.npcLineage.parent2Id, parent2.id));

    const allSiblingIds = [...new Set([
      ...siblings.map((s: { npcId: string }) => s.npcId),
      ...siblings2.map((s: { npcId: string }) => s.npcId),
    ])].filter(id => id !== childId);

    const siblingBondUpdate = {
      familiarity: 0.8,
      affection: 0.6,
      trust: 0.7,
      respect: 0.2,
      attraction: 0,
      newImpression: 'sibling',
      currentFeeling: 'sibling affection',
    };

    for (const siblingId of allSiblingIds) {
      // Child -> Sibling
      await relationshipManager.updateRelationship(childId, siblingId, siblingBondUpdate);
      // Sibling -> Child
      await relationshipManager.updateRelationship(siblingId, childId, {
        ...siblingBondUpdate,
        newImpression: 'new sibling',
        currentFeeling: 'curiosity about new sibling',
      });
    }

    console.log(`[ChildSpawner] Created ${2 + allSiblingIds.length * 2} family bonds`);
  }
}

export const childSpawner = new ChildSpawner();
