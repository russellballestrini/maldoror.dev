import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  varchar,
  index,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './users';

/**
 * Buildings table - Player-placed structures on the map
 * Each building is a 3x3 tile structure with an anchor position (bottom-center)
 */
export const buildings = pgTable('buildings', {
  id: uuid('id').primaryKey().defaultRandom(),
  ownerId: uuid('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),

  // Anchor position (bottom-center tile of the 3x3 building)
  anchorX: integer('anchor_x').notNull(),
  anchorY: integer('anchor_y').notNull(),

  // Building metadata
  prompt: text('prompt').notNull(),
  modelUsed: varchar('model_used', { length: 64 }),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  ownerIdx: index('idx_buildings_owner').on(table.ownerId),
  positionIdx: index('idx_buildings_position').on(table.anchorX, table.anchorY),
}));

/**
 * Building relations
 */
export const buildingsRelations = relations(buildings, ({ one }) => ({
  owner: one(users, {
    fields: [buildings.ownerId],
    references: [users.id],
  }),
}));
