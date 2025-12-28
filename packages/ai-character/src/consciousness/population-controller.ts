/**
 * Population Controller
 *
 * Manages NPC population dynamics through birth/death rate modulation.
 * Implements soft and hard caps to prevent overpopulation while
 * maintaining a thriving ecosystem.
 */

import { db, schema } from '@maldoror/db';
import { eq, and, isNull } from 'drizzle-orm';
import type { LifecycleConfig } from './types.js';
import { DEFAULT_LIFECYCLE_CONFIG } from './lifecycle-config.js';

export interface PopulationStats {
  totalLiving: number;
  byStage: {
    baby: number;
    child: number;
    adult: number;
    elder: number;
  };
  totalDeceased: number;
  birthsLast24h: number;
  deathsLast24h: number;
  avgGeneration: number;
  oldestGeneration: number;
  populationHealth: 'thriving' | 'stable' | 'declining' | 'critical';
}

export interface ReproductionModifiers {
  canReproduce: boolean;
  successRateModifier: number; // 0-1, multiplied against base success rate
  reason?: string;
}

export class PopulationController {
  private config: LifecycleConfig;

  constructor(config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG) {
    this.config = config;
  }

  /**
   * Get current population statistics
   */
  async getPopulationStats(): Promise<PopulationStats> {
    // Get all NPCs with lineage
    const allNpcs = await db
      .select({
        lifecycleStage: schema.npcLineage.lifecycleStage,
        deathAt: schema.npcLineage.deathAt,
        birthAt: schema.npcLineage.birthAt,
        generation: schema.npcLineage.generation,
      })
      .from(schema.npcLineage);

    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const stats: PopulationStats = {
      totalLiving: 0,
      byStage: { baby: 0, child: 0, adult: 0, elder: 0 },
      totalDeceased: 0,
      birthsLast24h: 0,
      deathsLast24h: 0,
      avgGeneration: 0,
      oldestGeneration: 0,
      populationHealth: 'stable',
    };

    let totalGeneration = 0;
    let livingCount = 0;

    for (const npc of allNpcs) {
      if (npc.deathAt || npc.lifecycleStage === 'deceased') {
        stats.totalDeceased++;
        if (npc.deathAt && npc.deathAt >= oneDayAgo) {
          stats.deathsLast24h++;
        }
      } else {
        stats.totalLiving++;
        const stage = npc.lifecycleStage as keyof typeof stats.byStage;
        if (stage in stats.byStage) {
          stats.byStage[stage]++;
        }
        totalGeneration += npc.generation;
        livingCount++;
        stats.oldestGeneration = Math.max(stats.oldestGeneration, npc.generation);
      }

      if (npc.birthAt >= oneDayAgo) {
        stats.birthsLast24h++;
      }
    }

    stats.avgGeneration = livingCount > 0 ? totalGeneration / livingCount : 0;

    // Determine population health
    if (stats.totalLiving < this.config.minPopulation) {
      stats.populationHealth = 'critical';
    } else if (stats.totalLiving < this.config.minPopulation * 1.5) {
      stats.populationHealth = 'declining';
    } else if (stats.totalLiving > this.config.softPopulationCap) {
      stats.populationHealth = 'thriving';
    } else {
      stats.populationHealth = 'stable';
    }

    return stats;
  }

  /**
   * Get reproduction modifiers based on current population
   * Returns whether reproduction is allowed and any success rate modifiers
   */
  async getReproductionModifiers(): Promise<ReproductionModifiers> {
    const stats = await this.getPopulationStats();

    // Hard cap - no reproduction allowed
    if (stats.totalLiving >= this.config.hardPopulationCap) {
      return {
        canReproduce: false,
        successRateModifier: 0,
        reason: 'Population at maximum capacity',
      };
    }

    // Soft cap - reduced reproduction rate
    if (stats.totalLiving >= this.config.softPopulationCap) {
      const overage = stats.totalLiving - this.config.softPopulationCap;
      const range = this.config.hardPopulationCap - this.config.softPopulationCap;
      const reduction = overage / range; // 0 to 1 as we approach hard cap

      return {
        canReproduce: true,
        successRateModifier: 1 - reduction * 0.8, // Reduce by up to 80%
        reason: 'Population high - reduced birth rate',
      };
    }

    // Below soft cap - normal or boosted reproduction
    if (stats.totalLiving < this.config.minPopulation) {
      return {
        canReproduce: true,
        successRateModifier: 1.5, // 50% boost when population low
        reason: 'Population low - boosted birth rate',
      };
    }

    // Normal reproduction
    return {
      canReproduce: true,
      successRateModifier: 1,
    };
  }

  /**
   * Get lifespan modifier based on population
   * When overpopulated, elders die sooner
   */
  getLifespanModifier(): number {
    // This is a synchronous approximation - for actual use,
    // call getPopulationStats first
    return 1.0; // Default no modification
  }

  /**
   * Calculate adjusted lifespan for a new NPC
   */
  async calculateAdjustedLifespan(baseLifespanHours: number): Promise<number> {
    const stats = await this.getPopulationStats();

    // When overpopulated, reduce elder lifespan
    if (stats.totalLiving > this.config.softPopulationCap) {
      const overage = stats.totalLiving - this.config.softPopulationCap;
      const range = this.config.hardPopulationCap - this.config.softPopulationCap;
      const reduction = Math.min(overage / range, 1) * 0.2; // Up to 20% reduction

      return baseLifespanHours * (1 - reduction);
    }

    // When underpopulated, extend lifespan
    if (stats.totalLiving < this.config.minPopulation) {
      return baseLifespanHours * 1.2; // 20% extension
    }

    return baseLifespanHours;
  }

  /**
   * Check if we should spawn immigrant NPCs (when population too low)
   */
  async shouldSpawnImmigrants(): Promise<{ should: boolean; count: number }> {
    const stats = await this.getPopulationStats();

    if (stats.totalLiving < this.config.minPopulation) {
      const deficit = this.config.minPopulation - stats.totalLiving;
      return {
        should: true,
        count: Math.min(deficit, 3), // Spawn up to 3 at a time
      };
    }

    return { should: false, count: 0 };
  }

  /**
   * Get priority for elder death (when we need to reduce population)
   * Returns elder NPCs sorted by priority for natural death
   */
  async getElderDeathPriority(): Promise<Array<{ npcId: string; priority: number }>> {
    const stats = await this.getPopulationStats();

    // Only accelerate deaths when over soft cap
    if (stats.totalLiving <= this.config.softPopulationCap) {
      return [];
    }

    // Get all living elders
    const elders = await db
      .select({
        npcId: schema.npcLineage.npcId,
        birthAt: schema.npcLineage.birthAt,
        generation: schema.npcLineage.generation,
      })
      .from(schema.npcLineage)
      .where(
        and(
          eq(schema.npcLineage.lifecycleStage, 'elder'),
          isNull(schema.npcLineage.deathAt)
        )
      );

    // Sort by age (oldest first) and generation (oldest generation first)
    type ElderRow = { npcId: string; birthAt: Date; generation: number };
    type PriorityItem = { npcId: string; priority: number };

    return elders
      .map((e: ElderRow): PriorityItem => ({
        npcId: e.npcId,
        priority: (Date.now() - e.birthAt.getTime()) / 1000 / 60 / 60 + e.generation * 100,
      }))
      .sort((a: PriorityItem, b: PriorityItem) => b.priority - a.priority);
  }

  /**
   * Format population stats for logging/display
   */
  formatStats(stats: PopulationStats): string {
    return [
      `Population: ${stats.totalLiving} living (${stats.totalDeceased} deceased)`,
      `By stage: ${stats.byStage.baby} babies, ${stats.byStage.child} children, ${stats.byStage.adult} adults, ${stats.byStage.elder} elders`,
      `Last 24h: ${stats.birthsLast24h} births, ${stats.deathsLast24h} deaths`,
      `Generations: avg ${stats.avgGeneration.toFixed(1)}, max ${stats.oldestGeneration}`,
      `Health: ${stats.populationHealth}`,
    ].join('\n');
  }
}

export const populationController = new PopulationController();
