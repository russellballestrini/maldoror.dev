import {
  pgTable,
  uuid,
  varchar,
  timestamp,
  index,
  jsonb,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * Agent API tokens - authentication for programmatic agents
 *
 * Tokens are stored as SHA-256 hashes. The actual token is only shown once
 * when created and cannot be retrieved later.
 *
 * Token format: mat_ + 32 hex chars (e.g., mat_a7b3c9d1e5f2...)
 */
export const agentTokens = pgTable('agent_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(), // SHA-256 of token
  name: varchar('name', { length: 64 }), // Optional friendly name
  permissions: jsonb('permissions'), // Future: granular permissions
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (table) => ({
  tokenHashIdx: index('idx_agent_tokens_hash').on(table.tokenHash),
  userIdIdx: index('idx_agent_tokens_user').on(table.userId),
}));

/**
 * Agent token relations
 */
export const agentTokensRelations = relations(agentTokens, ({ one }) => ({
  user: one(users, {
    fields: [agentTokens.userId],
    references: [users.id],
  }),
}));
