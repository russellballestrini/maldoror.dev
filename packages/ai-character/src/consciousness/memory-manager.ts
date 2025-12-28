/**
 * Memory Manager
 *
 * Handles storage, retrieval, and consolidation of NPC memories.
 * Memories fade over time unless they're important or frequently accessed.
 */

import { db, schema } from '@maldoror/db';
import { eq, desc, and, gte, sql, ilike, or } from 'drizzle-orm';
import type { Memory, MemoryQuery } from './types.js';

type NpcMemoryRow = typeof schema.npcMemories.$inferSelect;

export class MemoryManager {
  /**
   * Store a new memory
   */
  async storeMemory(npcId: string, memory: Omit<Memory, 'id' | 'createdAt'>): Promise<Memory> {
    const [result] = await db.insert(schema.npcMemories).values({
      npcId,
      memoryType: memory.type,
      summary: memory.summary,
      details: memory.details,
      location: memory.location,
      participants: memory.participants,
      emotionalValence: memory.emotionalValence,
      emotionalIntensity: memory.emotionalIntensity,
      primaryEmotion: memory.primaryEmotion,
      importance: memory.importance,
      tags: memory.tags,
    }).returning();

    return this.dbToMemory(result!);
  }

  /**
   * Retrieve memories based on query
   */
  async retrieveMemories(query: MemoryQuery): Promise<Memory[]> {
    const conditions = [eq(schema.npcMemories.npcId, query.npcId)];

    if (query.types && query.types.length > 0) {
      conditions.push(
        or(...query.types.map(t => eq(schema.npcMemories.memoryType, t)))!
      );
    }

    if (query.minImportance !== undefined) {
      conditions.push(gte(schema.npcMemories.importance, query.minImportance));
    }

    if (query.searchTerm) {
      conditions.push(
        or(
          ilike(schema.npcMemories.summary, `%${query.searchTerm}%`),
          ilike(schema.npcMemories.details, `%${query.searchTerm}%`)
        )!
      );
    }

    const results = await db
      .select()
      .from(schema.npcMemories)
      .where(and(...conditions))
      .orderBy(query.recentFirst !== false ? desc(schema.npcMemories.createdAt) : schema.npcMemories.createdAt)
      .limit(query.limit || 20);

    // Update access count for retrieved memories
    if (results.length > 0) {
      const ids = results.map((r: NpcMemoryRow) => r.id);
      await db
        .update(schema.npcMemories)
        .set({
          accessCount: sql`${schema.npcMemories.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(sql`${schema.npcMemories.id} IN ${ids}`);
    }

    return results.map(this.dbToMemory);
  }

  /**
   * Get memories about a specific person
   */
  async getMemoriesAbout(npcId: string, targetId: string, limit = 10): Promise<Memory[]> {
    const results = await db
      .select()
      .from(schema.npcMemories)
      .where(
        and(
          eq(schema.npcMemories.npcId, npcId),
          sql`${schema.npcMemories.participants} @> ${JSON.stringify([targetId])}`
        )
      )
      .orderBy(desc(schema.npcMemories.importance), desc(schema.npcMemories.createdAt))
      .limit(limit);

    return results.map(this.dbToMemory);
  }

  /**
   * Get most important recent memories
   */
  async getSignificantMemories(npcId: string, limit = 15): Promise<Memory[]> {
    const results = await db
      .select()
      .from(schema.npcMemories)
      .where(eq(schema.npcMemories.npcId, npcId))
      .orderBy(desc(schema.npcMemories.importance), desc(schema.npcMemories.createdAt))
      .limit(limit);

    return results.map(this.dbToMemory);
  }

  /**
   * Get emotionally significant memories
   */
  async getEmotionalMemories(npcId: string, emotion?: string, limit = 10): Promise<Memory[]> {
    const conditions = [
      eq(schema.npcMemories.npcId, npcId),
      gte(schema.npcMemories.emotionalIntensity, 0.5),
    ];

    if (emotion) {
      conditions.push(eq(schema.npcMemories.primaryEmotion, emotion));
    }

    const results = await db
      .select()
      .from(schema.npcMemories)
      .where(and(...conditions))
      .orderBy(desc(schema.npcMemories.emotionalIntensity), desc(schema.npcMemories.createdAt))
      .limit(limit);

    return results.map(this.dbToMemory);
  }

  /**
   * Consolidate and summarize old memories (run periodically)
   * This prevents memory bloat while preserving important information
   */
  async consolidateMemories(npcId: string): Promise<string | null> {
    // Get memories older than 1 hour that are low importance
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    const oldMemories = await db
      .select()
      .from(schema.npcMemories)
      .where(
        and(
          eq(schema.npcMemories.npcId, npcId),
          sql`${schema.npcMemories.createdAt} < ${oneHourAgo}`,
          sql`${schema.npcMemories.importance} < 0.6`
        )
      )
      .orderBy(schema.npcMemories.createdAt)
      .limit(50);

    if (oldMemories.length < 10) {
      return null; // Not enough to consolidate
    }

    // Group memories by type and create summaries
    const grouped = new Map<string, typeof oldMemories>();
    for (const mem of oldMemories) {
      const type = mem.memoryType;
      if (!grouped.has(type)) grouped.set(type, []);
      grouped.get(type)!.push(mem);
    }

    const summaries: string[] = [];
    const idsToDelete: string[] = [];

    for (const [type, memories] of grouped) {
      if (memories.length >= 3) {
        const summary = `[${type}] ${memories.map((m: NpcMemoryRow) => m.summary).join('; ')}`;
        summaries.push(summary);
        idsToDelete.push(...memories.map((m: NpcMemoryRow) => m.id));
      }
    }

    if (idsToDelete.length > 0 && summaries.length > 0) {
      // Create consolidated memory
      await this.storeMemory(npcId, {
        type: 'reflection',
        summary: `Consolidated memories: ${summaries.join(' | ')}`,
        participants: [],
        emotionalValence: 0,
        emotionalIntensity: 0.3,
        importance: 0.4,
        tags: ['consolidated', 'auto-summary'],
      });

      // Delete old memories
      await db
        .delete(schema.npcMemories)
        .where(sql`${schema.npcMemories.id} IN ${idsToDelete}`);

      return `Consolidated ${idsToDelete.length} memories into summary`;
    }

    return null;
  }

  /**
   * Format memories for LLM context
   */
  formatMemoriesForContext(memories: Memory[]): string {
    if (memories.length === 0) return 'No relevant memories.';

    return memories.map(m => {
      const emotion = m.primaryEmotion ? ` [felt ${m.primaryEmotion}]` : '';
      const participants = m.participants.length > 0
        ? ` (involving: ${m.participants.join(', ')})`
        : '';
      const importance = m.importance > 0.7 ? ' [SIGNIFICANT]' : '';

      return `- ${m.summary}${emotion}${participants}${importance}`;
    }).join('\n');
  }

  private dbToMemory(row: typeof schema.npcMemories.$inferSelect): Memory {
    return {
      id: row.id,
      type: row.memoryType as Memory['type'],
      summary: row.summary,
      details: row.details || undefined,
      location: row.location as { x: number; y: number } | undefined,
      participants: (row.participants as string[]) || [],
      emotionalValence: row.emotionalValence || 0,
      emotionalIntensity: row.emotionalIntensity || 0.5,
      primaryEmotion: row.primaryEmotion || undefined,
      importance: row.importance || 0.5,
      tags: (row.tags as string[]) || [],
      createdAt: row.createdAt,
    };
  }
}

export const memoryManager = new MemoryManager();
