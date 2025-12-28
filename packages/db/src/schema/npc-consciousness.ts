/**
 * NPC Consciousness Schema
 *
 * Advanced AI state management for creating living, breathing NPCs
 * with memory, emotions, relationships, and emergent social behavior.
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
 * NPC Memories - Episodic memory of events and experiences
 *
 * NPCs remember specific events, conversations, and experiences.
 * Memories have emotional weight and fade over time.
 */
export const npcMemories = pgTable('npc_memories', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Memory content
  memoryType: varchar('memory_type', { length: 32 }).notNull(), // 'event', 'conversation', 'observation', 'reflection', 'plan'
  summary: text('summary').notNull(), // Brief summary of what happened
  details: text('details'), // Full details for context

  // Context
  location: jsonb('location').$type<{ x: number; y: number }>(),
  participants: jsonb('participants').$type<string[]>().default([]), // User IDs involved

  // Emotional impact (how this memory made the NPC feel)
  emotionalValence: real('emotional_valence').default(0), // -1 (negative) to 1 (positive)
  emotionalIntensity: real('emotional_intensity').default(0.5), // 0 to 1
  primaryEmotion: varchar('primary_emotion', { length: 32 }), // joy, sadness, anger, fear, surprise, love, etc.

  // Memory strength (for forgetting)
  importance: real('importance').default(0.5), // 0 to 1, affects retention
  accessCount: integer('access_count').default(0), // How often this memory is recalled
  lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),

  // Tags for retrieval
  tags: jsonb('tags').$type<string[]>().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  npcIdIdx: index('idx_npc_memories_npc_id').on(table.npcId),
  createdAtIdx: index('idx_npc_memories_created_at').on(table.createdAt),
  importanceIdx: index('idx_npc_memories_importance').on(table.importance),
  memoryTypeIdx: index('idx_npc_memories_type').on(table.memoryType),
}));

/**
 * NPC Relationships - How NPCs feel about and relate to others
 *
 * Tracks the relationship between an NPC and another entity (player or NPC).
 * Relationships evolve based on interactions.
 */
export const npcRelationships = pgTable('npc_relationships', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  targetId: uuid('target_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Core relationship dimensions (all -1 to 1)
  familiarity: real('familiarity').default(0), // How well do I know them?
  affection: real('affection').default(0), // Do I like them? (-1 = hate, 1 = love)
  trust: real('trust').default(0), // Can I rely on them?
  respect: real('respect').default(0), // Do I admire them?
  attraction: real('attraction').default(0), // Romantic/aesthetic attraction
  rivalry: real('rivalry').default(0), // Competitive feelings

  // Relationship status
  relationshipType: varchar('relationship_type', { length: 32 }).default('stranger'), // stranger, acquaintance, friend, close_friend, rival, enemy, lover, family

  // Interaction history
  interactionCount: integer('interaction_count').default(0),
  lastInteractionAt: timestamp('last_interaction_at', { withTimezone: true }),
  firstMetAt: timestamp('first_met_at', { withTimezone: true }).notNull().defaultNow(),

  // Opinions and impressions
  impressions: jsonb('impressions').$type<string[]>().default([]), // "They seem kind", "I don't trust their motives"
  sharedExperiences: jsonb('shared_experiences').$type<string[]>().default([]), // Memorable moments together

  // Current feelings about this person
  currentFeeling: varchar('current_feeling', { length: 64 }), // "I miss them", "I'm angry at them"

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  npcIdIdx: index('idx_npc_relationships_npc_id').on(table.npcId),
  targetIdIdx: index('idx_npc_relationships_target_id').on(table.targetId),
  uniqueRelationship: unique('unique_npc_relationship').on(table.npcId, table.targetId),
}));

/**
 * NPC Emotional State - Current emotional state of an NPC
 *
 * Tracks mood, current emotions, and emotional needs.
 * Emotions affect decision-making and behavior.
 */
export const npcEmotionalState = pgTable('npc_emotional_state', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),

  // Core mood (slow-changing baseline, -1 to 1)
  moodValence: real('mood_valence').default(0.3), // Positive = happy baseline
  moodEnergy: real('mood_energy').default(0.5), // High = energetic, low = lethargic

  // Current emotions (can have multiple, intensity 0-1)
  emotions: jsonb('emotions').$type<{
    joy?: number;
    sadness?: number;
    anger?: number;
    fear?: number;
    surprise?: number;
    disgust?: number;
    love?: number;
    curiosity?: number;
    boredom?: number;
    loneliness?: number;
    excitement?: number;
    contentment?: number;
    anxiety?: number;
    pride?: number;
    shame?: number;
    jealousy?: number;
    gratitude?: number;
    hope?: number;
  }>().default({}),

  // Emotional needs (0 = fully satisfied, 1 = desperate need)
  needs: jsonb('needs').$type<{
    social?: number;        // Need for interaction
    exploration?: number;   // Need for novelty
    rest?: number;          // Need for calm/recovery
    expression?: number;    // Need to express self
    belonging?: number;     // Need to be part of group
    recognition?: number;   // Need to be noticed/appreciated
    safety?: number;        // Need to feel secure
    intimacy?: number;      // Need for close connection
  }>().default({ social: 0.5, exploration: 0.5 }),

  // What's on their mind right now
  currentFocus: text('current_focus'), // "Thinking about the party", "Wondering where omega went"
  innerMonologue: text('inner_monologue'), // Recent internal thoughts

  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  npcIdIdx: index('idx_npc_emotional_state_npc_id').on(table.npcId),
}));

/**
 * NPC Goals - Active goals and desires
 *
 * NPCs have short-term and long-term goals that drive behavior.
 * Goals can be innate, emergent, or assigned.
 */
export const npcGoals = pgTable('npc_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Goal definition
  goalType: varchar('goal_type', { length: 32 }).notNull(), // 'innate', 'emergent', 'social', 'exploration', 'relationship', 'event'
  description: text('description').notNull(), // What the goal is
  motivation: text('motivation'), // Why they want this

  // Goal parameters
  priority: real('priority').default(0.5), // 0 to 1
  timeframe: varchar('timeframe', { length: 32 }).default('short'), // 'immediate', 'short', 'medium', 'long'

  // Progress tracking
  status: varchar('status', { length: 32 }).default('active'), // 'active', 'completed', 'abandoned', 'blocked'
  progress: real('progress').default(0), // 0 to 1
  steps: jsonb('steps').$type<string[]>().default([]), // Sub-steps to achieve goal

  // Target (optional)
  targetLocation: jsonb('target_location').$type<{ x: number; y: number }>(),
  targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'set null' }),

  // Expiry
  expiresAt: timestamp('expires_at', { withTimezone: true }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
}, (table) => ({
  npcIdIdx: index('idx_npc_goals_npc_id').on(table.npcId),
  statusIdx: index('idx_npc_goals_status').on(table.status),
  priorityIdx: index('idx_npc_goals_priority').on(table.priority),
}));

/**
 * World Events - Significant events in the world
 *
 * Events that multiple NPCs can be aware of and react to.
 * Creates shared experiences and emergent narratives.
 */
export const worldEvents = pgTable('world_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Event definition
  eventType: varchar('event_type', { length: 32 }).notNull(), // 'gathering', 'conflict', 'discovery', 'celebration', 'arrival', 'departure'
  title: text('title').notNull(), // "The Great Party by the Tree"
  description: text('description').notNull(),

  // Location and time
  location: jsonb('location').$type<{ x: number; y: number }>(),
  locationName: varchar('location_name', { length: 128 }), // "The Old Oak Tree"

  // Participants
  initiatorId: uuid('initiator_id').references(() => users.id, { onDelete: 'set null' }),
  participants: jsonb('participants').$type<string[]>().default([]),

  // Event state
  status: varchar('status', { length: 32 }).default('active'), // 'planned', 'active', 'completed', 'cancelled'

  // Timing
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  endedAt: timestamp('ended_at', { withTimezone: true }),

  // Significance
  significance: real('significance').default(0.5), // How noteworthy is this?

  // Outcomes
  outcomes: jsonb('outcomes').$type<string[]>().default([]), // What happened as a result

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  eventTypeIdx: index('idx_world_events_type').on(table.eventType),
  statusIdx: index('idx_world_events_status').on(table.status),
  createdAtIdx: index('idx_world_events_created_at').on(table.createdAt),
}));

/**
 * Social Gatherings - Parties, meetings, and group activities
 *
 * NPCs can propose, join, and participate in social gatherings.
 */
export const socialGatherings = pgTable('social_gatherings', {
  id: uuid('id').primaryKey().defaultRandom(),

  // Gathering details
  name: varchar('name', { length: 128 }).notNull(), // "Tree Party", "Dawn Watchers Club"
  description: text('description'),
  gatheringType: varchar('gathering_type', { length: 32 }).notNull(), // 'party', 'meeting', 'hangout', 'adventure', 'ritual'

  // Location
  location: jsonb('location').$type<{ x: number; y: number }>().notNull(),
  locationName: varchar('location_name', { length: 128 }),

  // Organizer
  organizerId: uuid('organizer_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Attendees
  invitedIds: jsonb('invited_ids').$type<string[]>().default([]),
  attendeeIds: jsonb('attendee_ids').$type<string[]>().default([]),
  maxAttendees: integer('max_attendees'),

  // Schedule
  scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
  duration: integer('duration'), // Minutes
  status: varchar('status', { length: 32 }).default('planned'), // 'planned', 'active', 'completed', 'cancelled'

  // Activity
  currentActivity: varchar('current_activity', { length: 128 }), // "Dancing", "Telling stories"
  mood: varchar('mood', { length: 64 }), // "joyful", "mysterious", "romantic"

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  organizerIdx: index('idx_social_gatherings_organizer').on(table.organizerId),
  statusIdx: index('idx_social_gatherings_status').on(table.status),
  scheduledIdx: index('idx_social_gatherings_scheduled').on(table.scheduledFor),
}));

/**
 * Chat History - Persistent chat for AI context
 *
 * Stores recent chat messages so NPCs can reference conversations.
 */
export const chatHistory = pgTable('chat_history', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderId: uuid('sender_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  senderName: varchar('sender_name', { length: 64 }).notNull(),

  message: text('message').notNull(),

  // Location when message was sent
  location: jsonb('location').$type<{ x: number; y: number }>(),

  // Message metadata
  messageType: varchar('message_type', { length: 32 }).default('chat'), // 'chat', 'emote', 'whisper', 'shout'

  // AI-generated analysis of the message
  sentiment: real('sentiment'), // -1 to 1
  topics: jsonb('topics').$type<string[]>().default([]),
  mentionedUserIds: jsonb('mentioned_user_ids').$type<string[]>().default([]),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  senderIdIdx: index('idx_chat_history_sender').on(table.senderId),
  createdAtIdx: index('idx_chat_history_created_at').on(table.createdAt),
  locationIdx: index('idx_chat_history_location').on(table.location),
}));

/**
 * NPC Reflections - Periodic deep thoughts
 *
 * NPCs periodically reflect on their experiences and update their worldview.
 */
export const npcReflections = pgTable('npc_reflections', {
  id: uuid('id').primaryKey().defaultRandom(),
  npcId: uuid('npc_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Reflection content
  reflectionType: varchar('reflection_type', { length: 32 }).notNull(), // 'daily', 'about_person', 'about_event', 'life_meaning', 'future_plans'
  content: text('content').notNull(), // The actual reflection

  // What triggered this reflection
  trigger: text('trigger'), // "Met omega for the third time", "The party was amazing"

  // Insights gained
  insights: jsonb('insights').$type<string[]>().default([]),

  // Impact on worldview
  worldviewChanges: jsonb('worldview_changes').$type<{
    newBeliefs?: string[];
    changedOpinions?: string[];
    newGoals?: string[];
  }>(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  npcIdIdx: index('idx_npc_reflections_npc_id').on(table.npcId),
  createdAtIdx: index('idx_npc_reflections_created_at').on(table.createdAt),
}));

// Relations
export const npcMemoriesRelations = relations(npcMemories, ({ one }) => ({
  npc: one(users, {
    fields: [npcMemories.npcId],
    references: [users.id],
  }),
}));

export const npcRelationshipsRelations = relations(npcRelationships, ({ one }) => ({
  npc: one(users, {
    fields: [npcRelationships.npcId],
    references: [users.id],
    relationName: 'npcRelationships',
  }),
  target: one(users, {
    fields: [npcRelationships.targetId],
    references: [users.id],
    relationName: 'relationshipTargets',
  }),
}));

export const npcEmotionalStateRelations = relations(npcEmotionalState, ({ one }) => ({
  npc: one(users, {
    fields: [npcEmotionalState.npcId],
    references: [users.id],
  }),
}));

export const npcGoalsRelations = relations(npcGoals, ({ one }) => ({
  npc: one(users, {
    fields: [npcGoals.npcId],
    references: [users.id],
  }),
  targetUser: one(users, {
    fields: [npcGoals.targetUserId],
    references: [users.id],
    relationName: 'goalTargets',
  }),
}));

export const worldEventsRelations = relations(worldEvents, ({ one }) => ({
  initiator: one(users, {
    fields: [worldEvents.initiatorId],
    references: [users.id],
  }),
}));

export const socialGatheringsRelations = relations(socialGatherings, ({ one }) => ({
  organizer: one(users, {
    fields: [socialGatherings.organizerId],
    references: [users.id],
  }),
}));

export const chatHistoryRelations = relations(chatHistory, ({ one }) => ({
  sender: one(users, {
    fields: [chatHistory.senderId],
    references: [users.id],
  }),
}));

export const npcReflectionsRelations = relations(npcReflections, ({ one }) => ({
  npc: one(users, {
    fields: [npcReflections.npcId],
    references: [users.id],
  }),
}));
