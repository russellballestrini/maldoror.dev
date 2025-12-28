/**
 * Unified Activity Log Schema
 *
 * Merges chat messages and NPC actions into a single timeline.
 * Displayed on the /chat page as an interleaved activity feed.
 */

import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * Unified Activity Log - All actions and messages in one timeline
 *
 * Activity types:
 * - chat: Regular chat message
 * - emote: Emote action (*waves*)
 * - move: Movement action
 * - propose_event: Proposing a gathering
 * - join_event: Joining a gathering
 * - propose_family: Proposing to have children
 * - accept_family: Accepting a family proposal
 * - reject_family: Rejecting a family proposal
 * - birth: A new NPC was born
 * - death: An NPC passed away
 * - mourn: Grieving for a deceased family member
 * - stage_change: Lifecycle stage transition (baby → child, etc.)
 */
export const unifiedActivityLog = pgTable('unified_activity_log', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Actor info
  actorId: uuid('actor_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  actorName: varchar('actor_name', { length: 64 }).notNull(),
  actorType: varchar('actor_type', { length: 16 }).notNull(), // 'player' | 'npc' | 'bot'

  // Activity type
  activityType: varchar('activity_type', { length: 32 }).notNull(),

  // For chat/emotes/speech
  message: text('message'),

  // For actions - flexible details
  actionDetails: jsonb('action_details').$type<{
    // Movement
    direction?: string;
    fromX?: number;
    fromY?: number;
    toX?: number;
    toY?: number;

    // Events
    eventId?: string;
    eventName?: string;

    // Family/reproduction
    partnerId?: string;
    partnerName?: string;
    childId?: string;
    childName?: string;
    proposalId?: string;

    // Death
    causeOfDeath?: string;
    deceasedId?: string;
    deceasedName?: string;

    // Lifecycle
    oldStage?: string;
    newStage?: string;

    // Emotions
    emotion?: string;
    emotionIntensity?: number;
  }>(),

  // Location when activity occurred
  locationX: integer('location_x'),
  locationY: integer('location_y'),

  // Visibility (for future filtering)
  isPublic: varchar('is_public', { length: 8 }).default('true'), // 'true' | 'false'

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  actorIdx: index('idx_activity_log_actor').on(table.actorId),
  typeIdx: index('idx_activity_log_type').on(table.activityType),
  createdAtIdx: index('idx_activity_log_created_at').on(table.createdAt),
  // Composite index for timeline queries
  timelineIdx: index('idx_activity_log_timeline').on(table.createdAt, table.activityType),
}));

// Relations
export const unifiedActivityLogRelations = relations(unifiedActivityLog, ({ one }) => ({
  actor: one(users, {
    fields: [unifiedActivityLog.actorId],
    references: [users.id],
  }),
}));

// Type exports for use in application code
export type UnifiedActivity = typeof unifiedActivityLog.$inferSelect;
export type NewUnifiedActivity = typeof unifiedActivityLog.$inferInsert;

export type ActivityType =
  | 'chat'
  | 'emote'
  | 'move'
  | 'propose_event'
  | 'join_event'
  | 'propose_family'
  | 'accept_family'
  | 'reject_family'
  | 'birth'
  | 'death'
  | 'mourn'
  | 'stage_change';
