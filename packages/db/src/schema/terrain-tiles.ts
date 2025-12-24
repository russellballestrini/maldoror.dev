import {
  pgTable,
  varchar,
  text,
  boolean,
  timestamp,
  integer,
} from 'drizzle-orm/pg-core';

/**
 * Terrain tiles table - AI-generated terrain textures
 *
 * Stores:
 * - Base terrain tiles (grass, dirt, sand, water, stone)
 * - Transition tiles (grass_to_water_n, grass_to_sand_ne, etc.)
 *
 * Pixel data is stored as JSON strings for flexibility
 */
export const terrainTiles = pgTable('terrain_tiles', {
  // Tile ID (e.g., 'grass', 'grass_to_water_n', 'dirt_to_stone_se')
  id: varchar('id', { length: 64 }).primaryKey(),

  // Human-readable name
  name: varchar('name', { length: 128 }).notNull(),

  // Base resolution pixels (256x256) as JSON
  pixels: text('pixels').notNull(),

  // Whether player can walk on this terrain
  walkable: boolean('walkable').notNull().default(true),

  // Pre-computed resolutions as JSON (keys: "26", "51", "77", etc.)
  resolutions: text('resolutions'),

  // Animation support (for water)
  animated: boolean('animated').notNull().default(false),
  animationFrames: text('animation_frames'), // JSON array of PixelGrids
  animationResolutions: text('animation_resolutions'), // JSON Record<size, PixelGrid[]>

  // Metadata
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});

/**
 * Terrain transition metadata table
 * Tracks which terrain pairs have generated transitions
 */
export const terrainTransitions = pgTable('terrain_transitions', {
  id: varchar('id', { length: 64 }).primaryKey(), // e.g., 'grass_to_water'
  fromTerrain: varchar('from_terrain', { length: 32 }).notNull(),
  toTerrain: varchar('to_terrain', { length: 32 }).notNull(),
  tilesGenerated: integer('tiles_generated').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
