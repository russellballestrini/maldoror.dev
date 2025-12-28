import {
  pgTable,
  uuid,
  integer,
  varchar,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * AI Token Usage table - tracks LLM API costs per user/NPC
 * Used for cost monitoring and billing analytics
 */
export const aiTokenUsage = pgTable('ai_token_usage', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Token counts
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),

  // Cost estimation in microdollars (1 USD = 1,000,000 microdollars)
  // This avoids floating point issues and allows precise aggregation
  estimatedCostMicros: integer('estimated_cost_micros'),

  // Provider info
  provider: varchar('provider', { length: 32 }).notNull(),
  model: varchar('model', { length: 64 }).notNull(),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userIdIdx: index('idx_ai_token_usage_user_id').on(table.userId),
  createdAtIdx: index('idx_ai_token_usage_created_at').on(table.createdAt),
}));

/**
 * AI Token Usage relations
 */
export const aiTokenUsageRelations = relations(aiTokenUsage, ({ one }) => ({
  user: one(users, {
    fields: [aiTokenUsage.userId],
    references: [users.id],
  }),
}));
