/**
 * NPC Lineage & Lifecycle Schema
 *
 * Tracks biological relationships, reproduction, aging, and death
 * for creating a thriving NPC ecosystem with generational continuity.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  real,
  index,
  unique,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * NPC Lineage - Biological relationships and lifecycle tracking
 *
 * Every NPC (and player, optionally) has a lineage record that tracks:
 * - Parents and ancestry
 * - Current lifecycle stage (baby → child → adult → elder → deceased)
 * - Genetic traits for inheritance
 */
export const npcLineage = pgTable('npc_lineage', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),

  // Parents (null for first-generation NPCs created by users)
  parent1Id: uuid('parent1_id').references(() => users.id, { onDelete: 'set null' }),
  parent2Id: uuid('parent2_id').references(() => users.id, { onDelete: 'set null' }),

  // Generation tracking (0 = original NPCs, 1 = their children, etc.)
  generation: integer('generation').notNull().default(0),

  // Family name (inherited from parents or assigned)
  familyName: varchar('family_name', { length: 64 }),

  // Birth info
  birthAt: timestamp('birth_at', { withTimezone: true }).notNull().defaultNow(),
  birthLocationX: integer('birth_location_x'),
  birthLocationY: integer('birth_location_y'),

  // Lifecycle stage
  lifecycleStage: varchar('lifecycle_stage', { length: 32 }).notNull().default('adult'),
  // 'baby' | 'child' | 'adult' | 'elder' | 'deceased'

  // Lifespan (in real-world hours)
  expectedLifespanHours: integer('expected_lifespan_hours').notNull().default(168), // 1 week default

  // Death info (null if alive)
  deathAt: timestamp('death_at', { withTimezone: true }),
  causeOfDeath: varchar('cause_of_death', { length: 64 }), // 'natural', 'grief', 'accident'

  // Genetic traits for inheritance
  geneticTraits: jsonb('genetic_traits').$type<{
    dominantColors?: string[];     // Hair, eye colors that dominate
    recessiveColors?: string[];    // Colors that may appear in offspring
    physicalFeatures?: string[];   // Body type, height, etc.
    personalityTendencies?: string[]; // Inherited personality traits
  }>(),

  // Visual prompt components (blended from parents)
  inheritedVisualPrompt: text('inherited_visual_prompt'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  npcIdIdx: index('idx_npc_lineage_npc_id').on(table.npcId),
  parent1Idx: index('idx_npc_lineage_parent1').on(table.parent1Id),
  parent2Idx: index('idx_npc_lineage_parent2').on(table.parent2Id),
  lifecycleIdx: index('idx_npc_lineage_lifecycle').on(table.lifecycleStage),
  generationIdx: index('idx_npc_lineage_generation').on(table.generation),
  familyNameIdx: index('idx_npc_lineage_family').on(table.familyName),
}));

/**
 * NPC Reproduction Proposals - Courtship and family planning
 *
 * When an NPC decides to propose having children with a partner,
 * a proposal is created. The partner can accept or reject.
 */
export const npcReproductionProposals = pgTable('npc_reproduction_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),

  // The NPC making the proposal
  proposerId: uuid('proposer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // The intended partner
  partnerId: uuid('partner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Status
  status: varchar('status', { length: 32 }).notNull().default('pending'),
  // 'pending' | 'accepted' | 'rejected' | 'completed' | 'cancelled' | 'expired'

  // Timestamps
  proposedAt: timestamp('proposed_at', { withTimezone: true }).notNull().defaultNow(),
  respondedAt: timestamp('responded_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }), // Proposals expire if not responded to

  // Relationship metrics at time of proposal (for analytics)
  affectionLevel: real('affection_level'),
  attractionLevel: real('attraction_level'),
  trustLevel: real('trust_level'),

  // Proposal context
  proposalMessage: text('proposal_message'), // What the NPC said when proposing

  // Outcome
  childId: uuid('child_id').references(() => users.id, { onDelete: 'set null' }),
  birthScheduledAt: timestamp('birth_scheduled_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  proposerIdx: index('idx_npc_repro_proposer').on(table.proposerId),
  partnerIdx: index('idx_npc_repro_partner').on(table.partnerId),
  statusIdx: index('idx_npc_repro_status').on(table.status),
  // Prevent duplicate active proposals between same pair
  uniquePendingProposal: unique('unique_pending_proposal').on(table.proposerId, table.partnerId),
}));

// Relations
export const npcLineageRelations = relations(npcLineage, ({ one }) => ({
  npc: one(users, {
    fields: [npcLineage.npcId],
    references: [users.id],
    relationName: 'npcLineage',
  }),
  parent1: one(users, {
    fields: [npcLineage.parent1Id],
    references: [users.id],
    relationName: 'lineageParent1',
  }),
  parent2: one(users, {
    fields: [npcLineage.parent2Id],
    references: [users.id],
    relationName: 'lineageParent2',
  }),
}));

export const npcReproductionProposalsRelations = relations(npcReproductionProposals, ({ one }) => ({
  proposer: one(users, {
    fields: [npcReproductionProposals.proposerId],
    references: [users.id],
    relationName: 'reproductionProposer',
  }),
  partner: one(users, {
    fields: [npcReproductionProposals.partnerId],
    references: [users.id],
    relationName: 'reproductionPartner',
  }),
  child: one(users, {
    fields: [npcReproductionProposals.childId],
    references: [users.id],
    relationName: 'reproductionChild',
  }),
}));
