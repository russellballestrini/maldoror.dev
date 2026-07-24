/**
 * NPC (Non-Player Character) types
 * NPCs are AI-controlled entities that roam the world
 */

/**
 * NPC behavior state
 */
export type NPCBehaviorState = 'idle' | 'wandering' | 'following_player' | 'fleeing';

/** Closed environmental states used by the deterministic world-life clock. */
export type WorldWeatherKind = 'clear' | 'mist' | 'rain' | 'storm' | 'cold_snap' | 'heat_haze';

export type WorldSeason = 'spring' | 'summer' | 'autumn' | 'winter';

/**
 * Activities are a deliberately small simulation vocabulary, not a mapping
 * from NPC names or prompt keywords. Utility scores choose between them from
 * schedules, needs, weather, place, and nearby people.
 */
export type NPCLifeActivity =
  | 'sleep'
  | 'eat'
  | 'work'
  | 'socialize'
  | 'explore'
  | 'shelter'
  | 'rest';

export type NPCLifeRole = 'steward' | 'maker' | 'forager' | 'trader' | 'watcher' | 'scholar';

export interface NPCLifeNeeds {
  /** Pressure from 0 (satisfied) to 1 (urgent). */
  rest: number;
  nourishment: number;
  social: number;
  purpose: number;
  curiosity: number;
  safety: number;
}

export interface NPCLifeScheduleEntry {
  startMinute: number;
  endMinute: number;
  activity: NPCLifeActivity;
  destinationX: number;
  destinationY: number;
}

/** Restart-safe inner and spatial intent for one inhabitant. */
export interface NPCLifeState {
  npcId: string;
  homeX: number;
  homeY: number;
  role: NPCLifeRole;
  schedule: NPCLifeScheduleEntry[];
  needs: NPCLifeNeeds;
  currentActivity: NPCLifeActivity;
  activityStartedWorldMinute: number;
  destinationX: number;
  destinationY: number;
  lastWorldMinute: number;
  lastEncounterWorldMinute: number | null;
  lastSocialTargetId: string | null;
  stateVersion: number;
}

/** One canonical environmental clock shared by every session and NPC. */
export interface WorldLifeState {
  worldId: string;
  worldSeed: string;
  worldMinute: number;
  weather: WorldWeatherKind;
  weatherIntensity: number;
  weatherUntilWorldMinute: number;
  season: WorldSeason;
  rngState: number;
}

export type NPCLifeEventType =
  | 'activity_changed'
  | 'social_encounter'
  | 'need_became_urgent'
  | 'weather_changed';

/** Append-only fact emitted by the life simulation and de-duplicated on replay. */
export interface NPCLifeEvent {
  dedupeKey: string;
  eventType: NPCLifeEventType;
  worldMinute: number;
  npcId: string | null;
  targetId: string | null;
  x: number | null;
  y: number | null;
  cause: Record<string, unknown>;
  consequence: Record<string, unknown>;
}

/**
 * Restart-safe motor state persisted alongside an NPC's current position.
 *
 * This deliberately contains only simulation mechanics. Identity, memories,
 * goals, and relationships remain in their domain tables, while x/y/direction
 * remain first-class player_state columns for spatial queries.
 */
export interface NPCMotorState {
  targetX: number | null;
  targetY: number | null;
  ticksUntilNextDecision: number;
  behaviorState: NPCBehaviorState;
  rngState: number;
  isMoving: boolean;
  movementTicksRemaining: number;
}

/**
 * NPC configuration for behavior
 */
export interface NPCConfig {
  roamRadius: number;      // Max distance from spawn (default: 15 for 30x30 area)
  playerAffinity: number;  // 0-100: 0=flees players, 50=neutral, 100=seeks players
  detectionRadius: number; // Radius to detect nearby players (default: 10)
  idleChance: number;      // Probability of idling each decision (0-1, default: 0.3)
}

/**
 * NPC visual state for rendering (similar to PlayerVisualState)
 * Used for broadcasting to clients
 */
export interface NPCVisualState {
  npcId: string;
  name: string;
  x: number;
  y: number;
  direction: 'up' | 'down' | 'left' | 'right';
  animationFrame: 0 | 1 | 2 | 3;
  isMoving: boolean;
  role?: NPCLifeRole;
  activity?: NPCLifeActivity;
  primaryNeed?: keyof NPCLifeNeeds;
}

/**
 * Full NPC state (server-side authoritative state)
 * Extends visual state with AI behavior data
 */
export interface NPCState extends NPCVisualState {
  // Spawn point (center of roaming area)
  spawnX: number;
  spawnY: number;

  // Current AI target
  targetX: number | null;
  targetY: number | null;

  // AI timing
  ticksUntilNextDecision: number;

  // Behavior state
  behaviorState: NPCBehaviorState;

  // Deterministic PRNG state, persisted with the motor state
  rngState: number;

  // Short animation tail for discrete externally-requested steps
  movementTicksRemaining: number;

  // Configuration
  config: NPCConfig;

  // Persistent schedule, needs, and current world-facing intent
  lifeState: NPCLifeState;
}

/**
 * NPC database record (as stored in DB)
 */
export interface NPCRecord {
  id: string;
  creatorId: string;
  name: string;
  prompt: string;
  spawnX: number;
  spawnY: number;
  roamRadius: number;
  playerAffinity: number;
  modelUsed: string | null;
  createdAt: Date;
}

/**
 * Default NPC configuration
 */
export const DEFAULT_NPC_CONFIG: NPCConfig = {
  roamRadius: 15,        // 30x30 area
  playerAffinity: 50,    // Neutral
  detectionRadius: 10,   // 10 tile detection range
  idleChance: 0.3,       // 30% chance to idle
};
