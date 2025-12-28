import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  integer,
  boolean,
  jsonb,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

/**
 * Users table - core identity
 */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  username: varchar('username', { length: 32 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),

  // NPC fields (null for regular users)
  isNpc: boolean('is_npc').notNull().default(false),
  personality: text('personality'),
  goals: jsonb('goals').$type<string[]>().default([]),
  visualPrompt: text('visual_prompt'), // Original prompt used to generate NPC appearance
  aiProvider: varchar('ai_provider', { length: 32 }).default('openai'),
  aiModel: varchar('ai_model', { length: 64 }).default('gpt-4o-mini'),
  decisionIntervalMs: integer('decision_interval_ms').default(300000), // 5 minutes
  spawnX: integer('spawn_x'),
  spawnY: integer('spawn_y'),
  roamRadius: integer('roam_radius').default(15),
  npcCreatorId: uuid('npc_creator_id'), // FK to users.id added via migration
}, (table) => ({
  usernameIdx: index('idx_users_username').on(table.username),
  isNpcIdx: index('idx_users_is_npc').on(table.isNpc),
}));

/**
 * User SSH keys - authentication via SSH key pairs
 */
export const userKeys = pgTable('user_keys', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  fingerprintSha256: varchar('fingerprint_sha256', { length: 64 }).notNull().unique(),
  publicKey: text('public_key').notNull(),
  keyType: varchar('key_type', { length: 32 }).notNull().default('ssh-ed25519'),
  label: varchar('label', { length: 128 }),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_user_keys_user_id').on(table.userId),
  fingerprintIdx: index('idx_user_keys_fingerprint').on(table.fingerprintSha256),
}));

/**
 * User relations
 */
export const usersRelations = relations(users, ({ many, one }) => ({
  keys: many(userKeys),
  avatar: one(avatars, {
    fields: [users.id],
    references: [avatars.userId],
  }),
  playerState: one(playerState, {
    fields: [users.id],
    references: [playerState.userId],
  }),
  sessions: many(sessions),
  agentTokens: many(agentTokens),
  aiTokenUsage: many(aiTokenUsage),
  // Self-reference for NPC creator
  createdNpcs: many(users, { relationName: 'npcCreator' }),
  npcCreator: one(users, {
    fields: [users.npcCreatorId],
    references: [users.id],
    relationName: 'npcCreator',
  }),
}));

export const userKeysRelations = relations(userKeys, ({ one }) => ({
  user: one(users, {
    fields: [userKeys.userId],
    references: [users.id],
  }),
}));

// Import for relations (will be defined in other files)
import { avatars } from './avatars';
import { playerState, sessions } from './sessions';
import { agentTokens } from './agent-tokens';
import { aiTokenUsage } from './ai-token-usage';
