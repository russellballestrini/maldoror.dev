/**
 * Lifecycle Configuration
 *
 * Default values for the NPC lifecycle system.
 * These can be overridden via environment variables or runtime config.
 */

import type { LifecycleConfig } from './types.js';

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig = {
  // Lifecycle stage durations (in real-world hours)
  babyDurationHours: 0.5,      // 30 minutes as baby
  childDurationHours: 2,        // 2 hours as child
  elderDurationHours: 4,        // 4 hours as elder before death

  // Base lifespan (in hours)
  baseLifespanHours: 168,       // 1 week total lifespan
  lifespanVariancePercent: 20,  // +/- 20% randomness

  // Reproduction timing
  reproductionCooldownHours: 24, // 1 day between births per NPC
  gestationPeriodMinutes: 30,    // Time between acceptance and birth

  // Population limits
  softPopulationCap: 50,  // Start reducing birth success rate
  hardPopulationCap: 75,  // Block new births entirely
  minPopulation: 10,      // Spawn immigrants if below this

  // Decision intervals by lifecycle stage (in milliseconds)
  decisionIntervalByStage: {
    baby: 60000,     // 1 minute (simple, frequent decisions)
    child: 180000,   // 3 minutes
    adult: 600000,   // 10 minutes (default consciousness cycle)
    elder: 900000,   // 15 minutes (slower, more reflective)
  },
};

/**
 * Calculate expected lifespan with variance
 */
export function calculateLifespan(config: LifecycleConfig): number {
  const variance = config.baseLifespanHours * (config.lifespanVariancePercent / 100);
  const randomOffset = (Math.random() * 2 - 1) * variance;
  return Math.max(1, config.baseLifespanHours + randomOffset);
}

/**
 * Get lifecycle stage boundaries for a given lifespan
 */
export function getStageBoundaries(lifespanHours: number, config: LifecycleConfig): {
  babyEnd: number;
  childEnd: number;
  elderStart: number;
  deathAt: number;
} {
  return {
    babyEnd: config.babyDurationHours,
    childEnd: config.babyDurationHours + config.childDurationHours,
    elderStart: lifespanHours - config.elderDurationHours,
    deathAt: lifespanHours,
  };
}

/**
 * Get decision interval for a lifecycle stage
 */
export function getDecisionInterval(
  stage: 'baby' | 'child' | 'adult' | 'elder',
  config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG
): number {
  return config.decisionIntervalByStage[stage];
}
