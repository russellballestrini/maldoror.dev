/**
 * Lifecycle Manager
 *
 * Manages NPC aging, lifecycle stage transitions, and natural death.
 * Handles the progression from baby → child → adult → elder → deceased.
 */

import { db, schema } from '@maldoror/db';
import { eq, and, isNull, ne } from 'drizzle-orm';
import type { LifecycleStage, LineageInfo, LifecycleConfig } from './types.js';
import { DEFAULT_LIFECYCLE_CONFIG, getStageBoundaries, calculateLifespan } from './lifecycle-config.js';

export interface LifecycleTransition {
  npcId: string;
  npcName: string;
  oldStage: LifecycleStage;
  newStage: LifecycleStage;
  ageHours: number;
}

export interface DeathEvent {
  npcId: string;
  npcName: string;
  causeOfDeath: 'natural' | 'grief' | 'accident';
  ageHours: number;
  generation: number;
  familyMemberIds: string[];
}

export class LifecycleManager {
  private config: LifecycleConfig;

  constructor(config: LifecycleConfig = DEFAULT_LIFECYCLE_CONFIG) {
    this.config = config;
  }

  /**
   * Get the current lifecycle stage for an NPC based on age
   */
  calculateStage(ageHours: number, lifespanHours: number): LifecycleStage {
    const boundaries = getStageBoundaries(lifespanHours, this.config);

    if (ageHours < boundaries.babyEnd) return 'baby';
    if (ageHours < boundaries.childEnd) return 'child';
    if (ageHours < boundaries.elderStart) return 'adult';
    if (ageHours < boundaries.deathAt) return 'elder';
    return 'deceased';
  }

  /**
   * Get age in hours for an NPC
   */
  getAgeHours(birthAt: Date): number {
    return (Date.now() - birthAt.getTime()) / (1000 * 60 * 60);
  }

  /**
   * Get lineage info for an NPC
   */
  async getLineageInfo(npcId: string): Promise<LineageInfo | null> {
    const [lineage] = await db
      .select()
      .from(schema.npcLineage)
      .where(eq(schema.npcLineage.npcId, npcId))
      .limit(1);

    if (!lineage) return null;

    // Get parent names
    let parent1Name: string | undefined;
    let parent2Name: string | undefined;

    if (lineage.parent1Id) {
      const [p1] = await db.select({ username: schema.users.username })
        .from(schema.users).where(eq(schema.users.id, lineage.parent1Id)).limit(1);
      parent1Name = p1?.username;
    }
    if (lineage.parent2Id) {
      const [p2] = await db.select({ username: schema.users.username })
        .from(schema.users).where(eq(schema.users.id, lineage.parent2Id)).limit(1);
      parent2Name = p2?.username;
    }

    // Get siblings (same parents)
    const siblings: string[] = [];
    if (lineage.parent1Id || lineage.parent2Id) {
      const siblingRows = await db
        .select({ npcId: schema.npcLineage.npcId })
        .from(schema.npcLineage)
        .where(
          and(
            ne(schema.npcLineage.npcId, npcId),
            lineage.parent1Id ? eq(schema.npcLineage.parent1Id, lineage.parent1Id) : undefined,
            lineage.parent2Id ? eq(schema.npcLineage.parent2Id, lineage.parent2Id) : undefined
          )
        );
      siblings.push(...siblingRows.map((s: { npcId: string }) => s.npcId));
    }

    // Get children (where this NPC is a parent)
    const childRows = await db
      .select({ npcId: schema.npcLineage.npcId })
      .from(schema.npcLineage)
      .where(
        eq(schema.npcLineage.parent1Id, npcId)
      );
    const childRows2 = await db
      .select({ npcId: schema.npcLineage.npcId })
      .from(schema.npcLineage)
      .where(
        eq(schema.npcLineage.parent2Id, npcId)
      );
    const children = [...new Set([
      ...childRows.map((c: { npcId: string }) => c.npcId),
      ...childRows2.map((c: { npcId: string }) => c.npcId)
    ])];

    const ageHours = this.getAgeHours(lineage.birthAt);

    return {
      npcId: lineage.npcId,
      parent1Id: lineage.parent1Id || undefined,
      parent2Id: lineage.parent2Id || undefined,
      parent1Name,
      parent2Name,
      generation: lineage.generation,
      familyName: lineage.familyName || undefined,
      stage: lineage.lifecycleStage as LifecycleStage,
      birthAt: lineage.birthAt,
      deathAt: lineage.deathAt || undefined,
      expectedLifespanHours: lineage.expectedLifespanHours,
      ageHours,
      siblings,
      children,
      geneticTraits: lineage.geneticTraits as LineageInfo['geneticTraits'],
    };
  }

  /**
   * Create lineage record for a new NPC
   */
  async createLineage(
    npcId: string,
    options: {
      parent1Id?: string;
      parent2Id?: string;
      generation?: number;
      familyName?: string;
      birthLocation?: { x: number; y: number };
      geneticTraits?: LineageInfo['geneticTraits'];
      inheritedVisualPrompt?: string;
      startingStage?: LifecycleStage;
    } = {}
  ): Promise<LineageInfo> {
    const lifespan = calculateLifespan(this.config);
    const stage = options.startingStage || 'adult';

    const [lineage] = await db
      .insert(schema.npcLineage)
      .values({
        npcId,
        parent1Id: options.parent1Id,
        parent2Id: options.parent2Id,
        generation: options.generation || 0,
        familyName: options.familyName,
        birthLocationX: options.birthLocation?.x,
        birthLocationY: options.birthLocation?.y,
        lifecycleStage: stage,
        expectedLifespanHours: Math.round(lifespan),
        geneticTraits: options.geneticTraits,
        inheritedVisualPrompt: options.inheritedVisualPrompt,
      })
      .returning();

    return {
      npcId: lineage!.npcId,
      parent1Id: lineage!.parent1Id || undefined,
      parent2Id: lineage!.parent2Id || undefined,
      generation: lineage!.generation,
      familyName: lineage!.familyName || undefined,
      stage: lineage!.lifecycleStage as LifecycleStage,
      birthAt: lineage!.birthAt,
      expectedLifespanHours: lineage!.expectedLifespanHours,
      ageHours: 0,
      siblings: [],
      children: [],
      geneticTraits: lineage!.geneticTraits as LineageInfo['geneticTraits'],
    };
  }

  /**
   * Process age transitions for all living NPCs
   * Returns list of NPCs that transitioned to a new stage
   */
  async processAgeTransitions(): Promise<LifecycleTransition[]> {
    const transitions: LifecycleTransition[] = [];

    // Get all living NPCs with lineage
    const livingNpcs = await db
      .select({
        npcId: schema.npcLineage.npcId,
        birthAt: schema.npcLineage.birthAt,
        lifecycleStage: schema.npcLineage.lifecycleStage,
        expectedLifespanHours: schema.npcLineage.expectedLifespanHours,
        username: schema.users.username,
      })
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(
        and(
          isNull(schema.npcLineage.deathAt),
          ne(schema.npcLineage.lifecycleStage, 'deceased')
        )
      );

    for (const npc of livingNpcs) {
      const ageHours = this.getAgeHours(npc.birthAt);
      const currentStage = npc.lifecycleStage as LifecycleStage;
      const newStage = this.calculateStage(ageHours, npc.expectedLifespanHours);

      // Check if stage changed
      if (currentStage !== newStage && newStage !== 'deceased') {
        await db
          .update(schema.npcLineage)
          .set({
            lifecycleStage: newStage,
            updatedAt: new Date(),
          })
          .where(eq(schema.npcLineage.npcId, npc.npcId));

        transitions.push({
          npcId: npc.npcId,
          npcName: npc.username,
          oldStage: currentStage,
          newStage,
          ageHours,
        });
      }
    }

    return transitions;
  }

  /**
   * Process natural deaths for all NPCs that have exceeded lifespan
   * Returns list of NPCs that died
   */
  async processNaturalDeaths(): Promise<DeathEvent[]> {
    const deaths: DeathEvent[] = [];

    // Get all elders to check for death
    const elders = await db
      .select({
        npcId: schema.npcLineage.npcId,
        birthAt: schema.npcLineage.birthAt,
        expectedLifespanHours: schema.npcLineage.expectedLifespanHours,
        generation: schema.npcLineage.generation,
        username: schema.users.username,
      })
      .from(schema.npcLineage)
      .innerJoin(schema.users, eq(schema.npcLineage.npcId, schema.users.id))
      .where(
        and(
          eq(schema.npcLineage.lifecycleStage, 'elder'),
          isNull(schema.npcLineage.deathAt)
        )
      );

    for (const elder of elders) {
      const ageHours = this.getAgeHours(elder.birthAt);

      if (ageHours >= elder.expectedLifespanHours) {
        // This NPC has died of natural causes
        await this.recordDeath(elder.npcId, 'natural');

        // Get family members for notification
        const lineage = await this.getLineageInfo(elder.npcId);
        const familyMemberIds = lineage
          ? [
              lineage.parent1Id,
              lineage.parent2Id,
              ...lineage.siblings,
              ...lineage.children,
            ].filter((id): id is string => !!id)
          : [];

        deaths.push({
          npcId: elder.npcId,
          npcName: elder.username,
          causeOfDeath: 'natural',
          ageHours,
          generation: elder.generation,
          familyMemberIds,
        });
      }
    }

    return deaths;
  }

  /**
   * Record death of an NPC
   */
  async recordDeath(npcId: string, causeOfDeath: 'natural' | 'grief' | 'accident'): Promise<void> {
    await db
      .update(schema.npcLineage)
      .set({
        lifecycleStage: 'deceased',
        deathAt: new Date(),
        causeOfDeath,
        updatedAt: new Date(),
      })
      .where(eq(schema.npcLineage.npcId, npcId));
  }

  /**
   * Check if an NPC can reproduce (is adult, alive)
   */
  async canReproduce(npcId: string): Promise<boolean> {
    const lineage = await this.getLineageInfo(npcId);
    if (!lineage) return false;
    return lineage.stage === 'adult' && !lineage.deathAt;
  }

  /**
   * Get count of living NPCs
   */
  async getLivingCount(): Promise<number> {
    // Get all living NPCs and count them
    const all = await db
      .select({ id: schema.npcLineage.id })
      .from(schema.npcLineage)
      .where(
        and(
          isNull(schema.npcLineage.deathAt),
          ne(schema.npcLineage.lifecycleStage, 'deceased')
        )
      );
    return all.length;
  }
}

export const lifecycleManager = new LifecycleManager();
