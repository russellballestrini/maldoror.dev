/**
 * Reproduction Manager
 *
 * Handles NPC reproduction proposals, eligibility checking, and birth coordination.
 * Works with the lifecycle, lineage, and population systems to manage family creation.
 */

import { db, schema } from '@maldoror/db';
import { eq, and, or, ne } from 'drizzle-orm';
import type { LifecycleConfig, ReproductionProposal } from './types.js';
import { DEFAULT_LIFECYCLE_CONFIG } from './lifecycle-config.js';
import { populationController } from './population-controller.js';
import { lineageManager } from './lineage-manager.js';
import { lifecycleManager } from './lifecycle-manager.js';
import { relationshipManager } from './relationship-manager.js';

// Type aliases for database rows
type ProposalRow = typeof schema.npcReproductionProposals.$inferSelect;
type UserRow = typeof schema.users.$inferSelect;

export interface ReproductionEligibility {
  eligible: boolean;
  reasons: string[];
  successModifier?: number;
}

export interface ProposalResult {
  success: boolean;
  proposal?: ReproductionProposal;
  reason?: string;
}

export interface AcceptanceResult {
  success: boolean;
  birthScheduledAt?: Date;
  reason?: string;
}

export class ReproductionManager {
  private config: LifecycleConfig;

  // Minimum relationship thresholds for reproduction proposal
  private readonly MIN_AFFECTION = 0.7;
  private readonly MIN_ATTRACTION = 0.5;
  private readonly MIN_TRUST = 0.5;
  private readonly PROPOSAL_EXPIRY_HOURS = 24;

  constructor(config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG) {
    this.config = config;
  }

  /**
   * Check if an NPC can propose reproduction with a partner
   */
  async checkEligibility(proposerId: string, partnerId: string): Promise<ReproductionEligibility> {
    const reasons: string[] = [];
    let successModifier = 1.0;

    // 1. Check both are adults
    const proposerLineage = await lifecycleManager.getLineageInfo(proposerId);
    const partnerLineage = await lifecycleManager.getLineageInfo(partnerId);

    if (!proposerLineage || proposerLineage.stage !== 'adult') {
      reasons.push('Proposer is not an adult');
    }
    if (!partnerLineage || partnerLineage.stage !== 'adult') {
      reasons.push('Partner is not an adult');
    }

    // 2. Check relationship requirements
    const relationship = await relationshipManager.getRelationship(proposerId, partnerId);
    if (!relationship) {
      reasons.push('No established relationship');
    } else {
      if (relationship.affection < this.MIN_AFFECTION) {
        reasons.push(`Affection too low (${relationship.affection.toFixed(2)} < ${this.MIN_AFFECTION})`);
      }
      if (relationship.attraction < this.MIN_ATTRACTION) {
        reasons.push(`Attraction too low (${relationship.attraction.toFixed(2)} < ${this.MIN_ATTRACTION})`);
      }
      if (relationship.trust < this.MIN_TRUST) {
        reasons.push(`Trust too low (${relationship.trust.toFixed(2)} < ${this.MIN_TRUST})`);
      }
      if (relationship.type !== 'lover' && relationship.type !== 'close_friend') {
        reasons.push(`Relationship type (${relationship.type}) not suitable for family`);
      }
    }

    // 3. Check for pending proposals
    const existingProposal = await this.getPendingProposal(proposerId, partnerId);
    if (existingProposal) {
      reasons.push('Already have a pending proposal with this partner');
    }

    // 4. Check reproduction cooldown
    const proposerCooldown = await this.checkCooldown(proposerId);
    const partnerCooldown = await this.checkCooldown(partnerId);
    if (!proposerCooldown.canReproduce) {
      reasons.push(`Proposer on cooldown: ${proposerCooldown.hoursRemaining?.toFixed(1)}h remaining`);
    }
    if (!partnerCooldown.canReproduce) {
      reasons.push(`Partner on cooldown: ${partnerCooldown.hoursRemaining?.toFixed(1)}h remaining`);
    }

    // 5. Check population limits
    const populationMod = await populationController.getReproductionModifiers();
    if (!populationMod.canReproduce) {
      reasons.push(populationMod.reason || 'Population at capacity');
    } else {
      successModifier *= populationMod.successRateModifier;
      if (populationMod.reason) {
        reasons.push(populationMod.reason);
      }
    }

    // 6. Check inbreeding prevention
    const canMateResult = await lineageManager.canMate(proposerId, partnerId);
    if (!canMateResult.canMate) {
      reasons.push(canMateResult.reason || 'Cannot mate with close family');
    }

    return {
      eligible: reasons.filter(r => !r.includes('boosted') && !r.includes('reduced')).length === 0,
      reasons,
      successModifier,
    };
  }

  /**
   * Check cooldown for an NPC (time since last birth)
   */
  private async checkCooldown(npcId: string): Promise<{
    canReproduce: boolean;
    hoursRemaining?: number;
  }> {
    // Find most recent completed proposal where this NPC is a parent
    const [lastBirth] = await db
      .select({ birthScheduledAt: schema.npcReproductionProposals.birthScheduledAt })
      .from(schema.npcReproductionProposals)
      .where(
        and(
          or(
            eq(schema.npcReproductionProposals.proposerId, npcId),
            eq(schema.npcReproductionProposals.partnerId, npcId)
          ),
          eq(schema.npcReproductionProposals.status, 'completed')
        )
      )
      .orderBy(schema.npcReproductionProposals.birthScheduledAt)
      .limit(1);

    if (!lastBirth?.birthScheduledAt) {
      return { canReproduce: true };
    }

    const hoursSinceBirth = (Date.now() - lastBirth.birthScheduledAt.getTime()) / (1000 * 60 * 60);
    if (hoursSinceBirth >= this.config.reproductionCooldownHours) {
      return { canReproduce: true };
    }

    return {
      canReproduce: false,
      hoursRemaining: this.config.reproductionCooldownHours - hoursSinceBirth,
    };
  }

  /**
   * Get pending proposal between two NPCs (in either direction)
   */
  async getPendingProposal(npc1Id: string, npc2Id: string): Promise<ReproductionProposal | null> {
    const [proposal] = await db
      .select()
      .from(schema.npcReproductionProposals)
      .where(
        and(
          eq(schema.npcReproductionProposals.status, 'pending'),
          or(
            and(
              eq(schema.npcReproductionProposals.proposerId, npc1Id),
              eq(schema.npcReproductionProposals.partnerId, npc2Id)
            ),
            and(
              eq(schema.npcReproductionProposals.proposerId, npc2Id),
              eq(schema.npcReproductionProposals.partnerId, npc1Id)
            )
          )
        )
      )
      .limit(1);

    return proposal ? this.dbToProposal(proposal) : null;
  }

  /**
   * Get all pending proposals for an NPC (where they are the partner)
   */
  async getPendingProposalsForNpc(npcId: string): Promise<ReproductionProposal[]> {
    const proposals = await db
      .select()
      .from(schema.npcReproductionProposals)
      .innerJoin(schema.users, eq(schema.npcReproductionProposals.proposerId, schema.users.id))
      .where(
        and(
          eq(schema.npcReproductionProposals.partnerId, npcId),
          eq(schema.npcReproductionProposals.status, 'pending')
        )
      );

    return proposals.map((row: { npc_reproduction_proposals: ProposalRow; users: UserRow }) => ({
      ...this.dbToProposal(row.npc_reproduction_proposals),
      proposerName: row.users.username,
    }));
  }

  /**
   * Create a reproduction proposal
   */
  async createProposal(
    proposerId: string,
    partnerId: string,
    proposalMessage?: string
  ): Promise<ProposalResult> {
    // Check eligibility
    const eligibility = await this.checkEligibility(proposerId, partnerId);
    if (!eligibility.eligible) {
      return {
        success: false,
        reason: eligibility.reasons.join('; '),
      };
    }

    // Get relationship metrics for record
    const relationship = await relationshipManager.getRelationship(proposerId, partnerId);

    // Create proposal
    try {
      const [proposal] = await db
        .insert(schema.npcReproductionProposals)
        .values({
          proposerId,
          partnerId,
          status: 'pending',
          affectionLevel: relationship?.affection,
          attractionLevel: relationship?.attraction,
          trustLevel: relationship?.trust,
          proposalMessage,
          expiresAt: new Date(Date.now() + this.PROPOSAL_EXPIRY_HOURS * 60 * 60 * 1000),
        })
        .returning();

      return {
        success: true,
        proposal: this.dbToProposal(proposal!),
      };
    } catch (error) {
      // Likely duplicate proposal constraint
      return {
        success: false,
        reason: 'Failed to create proposal - may already exist',
      };
    }
  }

  /**
   * Accept a reproduction proposal
   */
  async acceptProposal(proposalId: string): Promise<AcceptanceResult> {
    const [proposal] = await db
      .select()
      .from(schema.npcReproductionProposals)
      .where(eq(schema.npcReproductionProposals.id, proposalId))
      .limit(1);

    if (!proposal) {
      return { success: false, reason: 'Proposal not found' };
    }

    if (proposal.status !== 'pending') {
      return { success: false, reason: `Proposal status is ${proposal.status}, not pending` };
    }

    // Re-check eligibility (conditions may have changed)
    const eligibility = await this.checkEligibility(proposal.proposerId, proposal.partnerId);
    if (!eligibility.eligible) {
      // Cancel the proposal
      await db
        .update(schema.npcReproductionProposals)
        .set({ status: 'cancelled', respondedAt: new Date() })
        .where(eq(schema.npcReproductionProposals.id, proposalId));

      return {
        success: false,
        reason: `No longer eligible: ${eligibility.reasons.join('; ')}`,
      };
    }

    // Apply success modifier (population-based birth rate adjustment)
    const shouldSucceed = Math.random() < (eligibility.successModifier || 1.0);
    if (!shouldSucceed) {
      // Mark as rejected due to population pressure
      await db
        .update(schema.npcReproductionProposals)
        .set({ status: 'rejected', respondedAt: new Date() })
        .where(eq(schema.npcReproductionProposals.id, proposalId));

      return {
        success: false,
        reason: 'Birth attempt unsuccessful (population pressure)',
      };
    }

    // Schedule birth after gestation period
    const birthScheduledAt = new Date(
      Date.now() + this.config.gestationPeriodMinutes * 60 * 1000
    );

    await db
      .update(schema.npcReproductionProposals)
      .set({
        status: 'accepted',
        respondedAt: new Date(),
        birthScheduledAt,
      })
      .where(eq(schema.npcReproductionProposals.id, proposalId));

    return {
      success: true,
      birthScheduledAt,
    };
  }

  /**
   * Reject a reproduction proposal
   */
  async rejectProposal(proposalId: string): Promise<{ success: boolean; reason?: string }> {
    const [proposal] = await db
      .select()
      .from(schema.npcReproductionProposals)
      .where(eq(schema.npcReproductionProposals.id, proposalId))
      .limit(1);

    if (!proposal) {
      return { success: false, reason: 'Proposal not found' };
    }

    if (proposal.status !== 'pending') {
      return { success: false, reason: `Proposal status is ${proposal.status}, not pending` };
    }

    await db
      .update(schema.npcReproductionProposals)
      .set({
        status: 'rejected',
        respondedAt: new Date(),
      })
      .where(eq(schema.npcReproductionProposals.id, proposalId));

    return { success: true };
  }

  /**
   * Get proposals ready for birth (accepted and past gestation)
   */
  async getReadyForBirth(): Promise<ReproductionProposal[]> {
    const proposals = await db
      .select()
      .from(schema.npcReproductionProposals)
      .where(
        and(
          eq(schema.npcReproductionProposals.status, 'accepted'),
          ne(schema.npcReproductionProposals.birthScheduledAt, null as unknown as Date)
        )
      );

    const now = Date.now();
    return proposals
      .filter((p: ProposalRow) => p.birthScheduledAt && p.birthScheduledAt.getTime() <= now)
      .map((p: ProposalRow) => this.dbToProposal(p));
  }

  /**
   * Mark a proposal as completed (after birth)
   */
  async markCompleted(proposalId: string, childId: string): Promise<void> {
    await db
      .update(schema.npcReproductionProposals)
      .set({
        status: 'completed',
        childId,
      })
      .where(eq(schema.npcReproductionProposals.id, proposalId));
  }

  /**
   * Expire old pending proposals
   */
  async expireOldProposals(): Promise<number> {
    const now = new Date();
    const result = await db
      .update(schema.npcReproductionProposals)
      .set({ status: 'expired' })
      .where(
        and(
          eq(schema.npcReproductionProposals.status, 'pending'),
          ne(schema.npcReproductionProposals.expiresAt, null as unknown as Date)
        )
      )
      .returning();

    // Filter to only count actually expired ones
    return result.filter((r: ProposalRow) => r.expiresAt && r.expiresAt.getTime() < now.getTime()).length;
  }

  /**
   * Format proposal for LLM context
   */
  formatProposalForContext(proposal: ReproductionProposal): string {
    const proposer = proposal.proposerName || proposal.proposerId;
    return `${proposer} has proposed having a family with you. ` +
      (proposal.proposalMessage ? `They said: "${proposal.proposalMessage}"` : '');
  }

  private dbToProposal(row: typeof schema.npcReproductionProposals.$inferSelect): ReproductionProposal {
    return {
      id: row.id,
      proposerId: row.proposerId,
      partnerId: row.partnerId,
      status: row.status as ReproductionProposal['status'],
      proposedAt: row.proposedAt,
      respondedAt: row.respondedAt || undefined,
      affectionLevel: row.affectionLevel || undefined,
      attractionLevel: row.attractionLevel || undefined,
      trustLevel: row.trustLevel || undefined,
      proposalMessage: row.proposalMessage || undefined,
      childId: row.childId || undefined,
      birthScheduledAt: row.birthScheduledAt || undefined,
    };
  }
}

export const reproductionManager = new ReproductionManager();
