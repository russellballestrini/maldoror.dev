/**
 * Relationship Manager
 *
 * Tracks and manages NPC relationships with other entities.
 * Relationships evolve based on interactions and shared experiences.
 */

import { db, schema } from '@maldoror/db';
import { eq, and } from 'drizzle-orm';
import type { Relationship, RelationshipUpdate } from './types.js';

export class RelationshipManager {
  /**
   * Get all relationships for an NPC
   */
  async getRelationships(npcId: string): Promise<Map<string, Relationship>> {
    const results = await db
      .select()
      .from(schema.npcRelationships)
      .where(eq(schema.npcRelationships.npcId, npcId));

    const map = new Map<string, Relationship>();
    for (const row of results) {
      map.set(row.targetId, this.dbToRelationship(row));
    }
    return map;
  }

  /**
   * Get relationship with a specific entity
   */
  async getRelationship(npcId: string, targetId: string): Promise<Relationship | null> {
    const [result] = await db
      .select()
      .from(schema.npcRelationships)
      .where(
        and(
          eq(schema.npcRelationships.npcId, npcId),
          eq(schema.npcRelationships.targetId, targetId)
        )
      )
      .limit(1);

    return result ? this.dbToRelationship(result) : null;
  }

  /**
   * Create or update a relationship
   */
  async updateRelationship(
    npcId: string,
    targetId: string,
    update: RelationshipUpdate
  ): Promise<Relationship> {
    const existing = await this.getRelationship(npcId, targetId);

    if (existing) {
      // Update existing relationship
      const newImpressions = update.newImpression
        ? [...existing.impressions, update.newImpression].slice(-10)
        : existing.impressions;
      const newExperiences = update.newExperience
        ? [...existing.sharedExperiences, update.newExperience].slice(-10)
        : existing.sharedExperiences;

      // Calculate new relationship type based on dimensions
      const newFamiliarity = update.familiarity !== undefined
        ? Math.max(-1, Math.min(1, existing.familiarity + update.familiarity))
        : existing.familiarity;
      const newAffection = update.affection !== undefined
        ? Math.max(-1, Math.min(1, existing.affection + update.affection))
        : existing.affection;
      const newTrust = update.trust !== undefined
        ? Math.max(-1, Math.min(1, existing.trust + update.trust))
        : existing.trust;
      const newRivalry = update.rivalry !== undefined
        ? Math.max(-1, Math.min(1, existing.rivalry + update.rivalry))
        : existing.rivalry;

      const relationshipType = this.calculateRelationshipType(
        newFamiliarity, newAffection, newTrust, newRivalry
      );

      const [result] = await db
        .update(schema.npcRelationships)
        .set({
          familiarity: newFamiliarity,
          affection: newAffection,
          trust: newTrust,
          respect: update.respect !== undefined
            ? Math.max(-1, Math.min(1, existing.respect + update.respect))
            : existing.respect,
          attraction: update.attraction !== undefined
            ? Math.max(-1, Math.min(1, existing.attraction + update.attraction))
            : existing.attraction,
          rivalry: newRivalry,
          relationshipType,
          interactionCount: existing.interactionCount + 1,
          lastInteractionAt: new Date(),
          impressions: newImpressions,
          sharedExperiences: newExperiences,
          currentFeeling: update.currentFeeling || existing.currentFeeling,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.npcRelationships.npcId, npcId),
            eq(schema.npcRelationships.targetId, targetId)
          )
        )
        .returning();

      return this.dbToRelationship(result!);
    } else {
      // Create new relationship
      const [result] = await db
        .insert(schema.npcRelationships)
        .values({
          npcId,
          targetId,
          familiarity: Math.max(-1, Math.min(1, update.familiarity || 0.1)),
          affection: Math.max(-1, Math.min(1, update.affection || 0)),
          trust: Math.max(-1, Math.min(1, update.trust || 0)),
          respect: Math.max(-1, Math.min(1, update.respect || 0)),
          attraction: Math.max(-1, Math.min(1, update.attraction || 0)),
          rivalry: Math.max(-1, Math.min(1, update.rivalry || 0)),
          relationshipType: 'stranger',
          interactionCount: 1,
          lastInteractionAt: new Date(),
          impressions: update.newImpression ? [update.newImpression] : [],
          sharedExperiences: update.newExperience ? [update.newExperience] : [],
          currentFeeling: update.currentFeeling,
        })
        .returning();

      return this.dbToRelationship(result!);
    }
  }

  /**
   * Record an interaction (updates familiarity and interaction count)
   */
  async recordInteraction(
    npcId: string,
    targetId: string,
    interaction: {
      type: 'chat' | 'approach' | 'share_experience' | 'conflict' | 'help';
      wasPositive: boolean;
      details?: string;
    }
  ): Promise<Relationship> {
    const update: RelationshipUpdate = {
      familiarity: 0.05, // Small familiarity boost per interaction
    };

    // Adjust based on interaction type and outcome
    if (interaction.wasPositive) {
      update.affection = interaction.type === 'help' ? 0.15 : 0.05;
      update.trust = interaction.type === 'share_experience' ? 0.1 : 0.02;
    } else {
      update.affection = interaction.type === 'conflict' ? -0.2 : -0.05;
      update.trust = interaction.type === 'conflict' ? -0.15 : -0.02;
      update.rivalry = interaction.type === 'conflict' ? 0.1 : 0;
    }

    if (interaction.details) {
      update.newExperience = interaction.details;
    }

    return this.updateRelationship(npcId, targetId, update);
  }

  /**
   * Format relationships for LLM context
   */
  formatRelationshipsForContext(relationships: Map<string, Relationship>): string {
    if (relationships.size === 0) return 'No established relationships yet.';

    const entries: string[] = [];

    for (const [targetId, rel] of relationships) {
      const feelings: string[] = [];

      if (rel.affection > 0.5) feelings.push('like them a lot');
      else if (rel.affection > 0.2) feelings.push('like them');
      else if (rel.affection < -0.5) feelings.push('really dislike them');
      else if (rel.affection < -0.2) feelings.push('dislike them');

      if (rel.trust > 0.5) feelings.push('trust them deeply');
      else if (rel.trust < -0.3) feelings.push("don't trust them");

      if (rel.attraction > 0.5) feelings.push('find them attractive');
      if (rel.rivalry > 0.5) feelings.push('see them as a rival');
      if (rel.respect > 0.5) feelings.push('respect them');

      const recentImpression = rel.impressions[rel.impressions.length - 1];

      entries.push(
        `- ${rel.targetName || targetId} (${rel.type}): ` +
        (feelings.length > 0 ? feelings.join(', ') : 'neutral feelings') +
        (recentImpression ? ` | "${recentImpression}"` : '') +
        (rel.currentFeeling ? ` | Currently: ${rel.currentFeeling}` : '')
      );
    }

    return entries.join('\n');
  }

  private calculateRelationshipType(
    familiarity: number,
    affection: number,
    trust: number,
    rivalry: number
  ): Relationship['type'] {
    // Determine relationship type based on dimensions
    if (affection > 0.7 && trust > 0.5) {
      return familiarity > 0.7 ? 'close_friend' : 'friend';
    }
    if (affection > 0.8 && trust > 0.6) {
      return 'lover';
    }
    if (rivalry > 0.6 || affection < -0.5) {
      return affection < -0.6 ? 'enemy' : 'rival';
    }
    if (familiarity > 0.3 && affection > 0) {
      return 'acquaintance';
    }
    if (affection > 0.3) {
      return 'friend';
    }

    return 'stranger';
  }

  private dbToRelationship(row: typeof schema.npcRelationships.$inferSelect): Relationship {
    return {
      id: row.id,
      targetId: row.targetId,
      familiarity: row.familiarity || 0,
      affection: row.affection || 0,
      trust: row.trust || 0,
      respect: row.respect || 0,
      attraction: row.attraction || 0,
      rivalry: row.rivalry || 0,
      type: row.relationshipType as Relationship['type'] || 'stranger',
      interactionCount: row.interactionCount || 0,
      lastInteraction: row.lastInteractionAt || undefined,
      firstMet: row.firstMetAt,
      impressions: (row.impressions as string[]) || [],
      sharedExperiences: (row.sharedExperiences as string[]) || [],
      currentFeeling: row.currentFeeling || undefined,
    };
  }
}

export const relationshipManager = new RelationshipManager();
