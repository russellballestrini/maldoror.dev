/** Persistent deterministic world clock, inhabitant utilities, and audit facts. */
import {
  bigint,
  index,
  integer,
  jsonb,
  pgTable,
  real,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import type {
  NPCLifeActivity,
  NPCLifeEventType,
  NPCLifeNeeds,
  NPCLifeRole,
  NPCLifeScheduleEntry,
  WorldSeason,
  WorldWeatherKind,
} from '@maldoror/protocol';
import { users } from './users';

export const worldLifeState = pgTable('world_life_state', {
  worldId: varchar('world_id', { length: 64 }).primaryKey(),
  worldSeed: varchar('world_seed', { length: 192 }).notNull(),
  worldMinute: integer('world_minute').notNull(),
  weather: varchar('weather', { length: 32 }).$type<WorldWeatherKind>().notNull(),
  weatherIntensity: real('weather_intensity').notNull(),
  weatherUntilWorldMinute: integer('weather_until_world_minute').notNull(),
  season: varchar('season', { length: 16 }).$type<WorldSeason>().notNull(),
  rngState: bigint('rng_state', { mode: 'number' }).notNull(),
  surfaceWetness: real('surface_wetness').notNull().default(0.12),
  waterTurbulence: real('water_turbulence').notNull().default(0.08),
  vegetationVitality: real('vegetation_vitality').notNull().default(0.72),
  decayPressure: real('decay_pressure').notNull().default(0.1),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const npcLifeState = pgTable('npc_life_state', {
  npcId: uuid('npc_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
  homeX: integer('home_x').notNull(),
  homeY: integer('home_y').notNull(),
  role: varchar('role', { length: 32 }).$type<NPCLifeRole>().notNull(),
  schedule: jsonb('schedule').$type<NPCLifeScheduleEntry[]>().notNull(),
  needs: jsonb('needs').$type<NPCLifeNeeds>().notNull(),
  currentActivity: varchar('current_activity', { length: 32 }).$type<NPCLifeActivity>().notNull(),
  activityStartedWorldMinute: integer('activity_started_world_minute').notNull(),
  destinationX: integer('destination_x').notNull(),
  destinationY: integer('destination_y').notNull(),
  lastWorldMinute: integer('last_world_minute').notNull(),
  lastEncounterWorldMinute: integer('last_encounter_world_minute'),
  lastSocialTargetId: uuid('last_social_target_id').references(() => users.id, { onDelete: 'set null' }),
  stateVersion: integer('state_version').notNull().default(2),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  activityIdx: index('idx_npc_life_state_activity').on(table.currentActivity),
  destinationIdx: index('idx_npc_life_state_destination').on(table.destinationX, table.destinationY),
}));

/**
 * Append-only consequences. dedupe_key makes a replayed checkpoint idempotent
 * while preserving every distinct fact and its valid world time.
 */
export const npcLifeEvents = pgTable('npc_life_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  dedupeKey: varchar('dedupe_key', { length: 192 }).notNull(),
  eventType: varchar('event_type', { length: 32 }).$type<NPCLifeEventType>().notNull(),
  worldMinute: integer('world_minute').notNull(),
  npcId: uuid('npc_id').references(() => users.id, { onDelete: 'set null' }),
  targetId: uuid('target_id').references(() => users.id, { onDelete: 'set null' }),
  x: integer('x'),
  y: integer('y'),
  cause: jsonb('cause').$type<Record<string, unknown>>().notNull(),
  consequence: jsonb('consequence').$type<Record<string, unknown>>().notNull(),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dedupeIdx: uniqueIndex('idx_npc_life_events_dedupe').on(table.dedupeKey),
  worldMinuteIdx: index('idx_npc_life_events_world_minute').on(table.worldMinute),
  npcIdx: index('idx_npc_life_events_npc').on(table.npcId),
  typeIdx: index('idx_npc_life_events_type').on(table.eventType),
}));
