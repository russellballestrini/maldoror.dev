/**
 * NPC Consciousness Manager
 *
 * Advanced NPC management using the full consciousness system.
 * NPCs have memory, emotions, relationships, and can propose social events.
 *
 * This is the v2 replacement for npc-bot-manager.ts
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@maldoror/db';
import {
  CognitiveEngine,
  memoryManager,
  emotionProcessor,
  relationshipManager,
  createSocialAnalyzer,
  tokenTracker,
  lifecycleManager,
  reproductionManager,
  childSpawner,
  type CognitiveContext,
  type CognitiveAction,
  type VisibleEntity,
  type Goal,
  type DeathEvent,
} from '@maldoror/ai-character';
import type { WorkerManager } from '../server/worker-manager.js';
import type { Direction } from '@maldoror/protocol';
import { addBotActivity, addChatMessage } from '../server/stats-server.js';

type NpcGoalRow = typeof schema.npcGoals.$inferSelect;

interface ConsciousNPC {
  userId: string;
  username: string;
  personality: string;
  visualAppearance?: string;
  engine: CognitiveEngine;
  position: { x: number; y: number };
  direction: Direction;
  lastDecisionAt: number;
  decisionIntervalMs: number;
  spawnX: number;
  spawnY: number;
  roamRadius: number;
}

export interface ConsciousnessManagerConfig {
  workerManager: WorkerManager;
  apiKey: string;
  defaultProvider?: 'openai' | 'anthropic';
  defaultModel?: string;
  defaultDecisionIntervalMs?: number;
}

/**
 * NPC Consciousness Manager
 *
 * Manages NPCs with full consciousness: memory, emotions, relationships, social dynamics.
 */
export class NPCConsciousnessManager {
  private npcs: Map<string, ConsciousNPC> = new Map();
  private workerManager: WorkerManager;
  private apiKey: string;
  private defaultProvider: 'openai' | 'anthropic';
  private defaultModel: string;
  private defaultDecisionIntervalMs: number;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private socialAnalyzer: ReturnType<typeof createSocialAnalyzer>;
  private started = false;
  private lifecycleTickCount = 0;
  private readonly LIFECYCLE_TICK_INTERVAL = 6; // Every 60 seconds (6 ticks * 10s)

  constructor(config: ConsciousnessManagerConfig) {
    this.workerManager = config.workerManager;
    this.apiKey = config.apiKey;
    this.defaultProvider = config.defaultProvider || 'openai';
    this.defaultModel = config.defaultModel || 'gpt-4o-mini';
    // Default 2 hours per NPC (randomized per NPC in addNPC)
    this.defaultDecisionIntervalMs = config.defaultDecisionIntervalMs || 7200000;
    this.socialAnalyzer = createSocialAnalyzer(config.apiKey);
  }

  /**
   * Load all NPCs from database
   */
  async loadFromDB(): Promise<void> {
    console.log('[NPCConsciousness] Loading NPCs from database...');

    const npcs = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.isNpc, true));

    console.log(`[NPCConsciousness] Found ${npcs.length} NPCs`);

    for (const npc of npcs) {
      await this.addNPC(npc);
    }

    console.log(`[NPCConsciousness] Loaded ${this.npcs.size} conscious NPCs`);
  }

  /** Load a newly-created canonical NPC without restarting the service. */
  async loadNPC(npcId: string): Promise<void> {
    if (this.npcs.has(npcId)) return;

    const [npc] = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.id, npcId))
      .limit(1);

    if (npc?.isNpc) await this.addNPC(npc);
  }

  /**
   * Add an NPC to the manager
   */
  private async addNPC(npc: typeof schema.users.$inferSelect): Promise<void> {
    if (!npc.personality) {
      console.log(`[NPCConsciousness] Skipping ${npc.username} - no personality`);
      return;
    }

    // Parse goals from JSONB
    const goals = Array.isArray(npc.goals) ? npc.goals as string[] : [];

    // Create cognitive engine with full consciousness
    const engine = new CognitiveEngine({
      npcId: npc.id,
      personality: npc.personality,
      goals,
      visualAppearance: npc.visualPrompt || undefined,
      provider: (npc.aiProvider as 'openai' | 'anthropic') || this.defaultProvider,
      model: npc.aiModel || this.defaultModel,
      apiKey: this.apiKey,
      enableReflection: true,
      enableEventProposal: true,
      enableDeepReasoning: true,
    });

    // Initialize emotional state if needed
    await emotionProcessor.getEmotionalState(npc.id);

    const persistedState = await db.query.playerState.findFirst({
      where: eq(schema.playerState.userId, npc.id),
    });

    // Stable per-identity staggering avoids synchronized calls without
    // re-rolling an inhabitant's schedule on every process restart.
    const baseInterval = npc.decisionIntervalMs || this.defaultDecisionIntervalMs;
    const randomOffset = Math.floor(this.stableFraction(npc.id, 'decision-interval') * 600000);
    const decisionInterval = baseInterval + randomOffset;

    const initialOffset = Math.floor(this.stableFraction(npc.id, 'initial-decision') * decisionInterval);
    const lastDecisionAt = npc.npcLastDecisionAt?.getTime() ?? Date.now() - initialOffset;

    const consciousNpc: ConsciousNPC = {
      userId: npc.id,
      username: npc.username,
      personality: npc.personality,
      visualAppearance: npc.visualPrompt || undefined,
      engine,
      position: {
        x: persistedState?.x ?? npc.spawnX ?? 0,
        y: persistedState?.y ?? npc.spawnY ?? 0,
      },
      direction: this.isDirection(persistedState?.direction) ? persistedState.direction : 'down',
      lastDecisionAt,
      decisionIntervalMs: decisionInterval,
      spawnX: npc.spawnX ?? 0,
      spawnY: npc.spawnY ?? 0,
      roamRadius: npc.roamRadius ?? 15,
    };

    console.log(`[NPCConsciousness] ${npc.username} will think every ${Math.round(decisionInterval / 60000)} minutes`);

    this.npcs.set(npc.id, consciousNpc);

    console.log(`[NPCConsciousness] Added "${npc.username}" at (${consciousNpc.position.x}, ${consciousNpc.position.y})`);
  }

  /**
   * Start the consciousness loop
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Tick every 10 seconds to check for decisions
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 10000);

    console.log('[NPCConsciousness] Started consciousness loop');
  }

  /**
   * Stop the consciousness loop
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.started = false;

    console.log('[NPCConsciousness] Stopped');
  }

  /**
   * Check all NPCs and run cognitive processes
   */
  private tick(): void {
    const now = Date.now();

    for (const npc of this.npcs.values()) {
      const elapsed = now - npc.lastDecisionAt;
      if (elapsed >= npc.decisionIntervalMs) {
        this.processConsciousness(npc).catch(error => {
          console.error(`[NPCConsciousness] Error for ${npc.username}:`, error);
        });
      }
    }

    // Periodically increase needs (every ~5 minutes per NPC)
    if (Math.random() < 0.1) {
      for (const npc of this.npcs.values()) {
        emotionProcessor.increaseNeeds(npc.userId).catch(() => {});
      }
    }

    // Process lifecycle events periodically (every 60 seconds)
    this.lifecycleTickCount++;
    if (this.lifecycleTickCount >= this.LIFECYCLE_TICK_INTERVAL) {
      this.lifecycleTickCount = 0;
      this.processLifecycleEvents().catch(error => {
        console.error('[NPCConsciousness] Lifecycle processing error:', error);
      });
    }
  }

  /**
   * Process lifecycle events: age transitions, births, and deaths
   */
  private async processLifecycleEvents(): Promise<void> {
    // 1. Process age transitions (baby → child → adult → elder)
    const transitions = await lifecycleManager.processAgeTransitions();
    for (const transition of transitions) {
      console.log(`[NPCConsciousness] ${transition.npcName} became a ${transition.newStage}!`);

      // Log to chat
      addChatMessage({
        senderId: transition.npcId,
        senderName: transition.npcName,
        senderType: 'auton',
        message: `*has grown from a ${transition.oldStage} to a ${transition.newStage}*`,
        position: { x: 0, y: 0 },
      });

      // Update decision interval based on lifecycle stage
      await this.updateNpcDecisionInterval(transition.npcId, transition.newStage);
    }

    // 2. Process natural deaths
    const deaths = await lifecycleManager.processNaturalDeaths();
    for (const death of deaths) {
      console.log(`[NPCConsciousness] ${death.npcName} has passed away (${death.causeOfDeath})`);

      // Log to chat
      addChatMessage({
        senderId: death.npcId,
        senderName: death.npcName,
        senderType: 'auton',
        message: `*has passed away peacefully of ${death.causeOfDeath} causes*`,
        position: { x: 0, y: 0 },
      });

      // Remove from active NPCs
      this.npcs.delete(death.npcId);

      // Notify family members and trigger grief
      await this.processGriefForFamily(death);
    }

    // 3. Process pending births (accepted reproduction proposals past gestation)
    const readyBirths = await reproductionManager.getReadyForBirth();
    for (const proposal of readyBirths) {
      await this.processBirth(proposal);
    }

    // 4. Expire old proposals
    await reproductionManager.expireOldProposals();
  }

  /**
   * Process grief for family members of deceased NPC
   */
  private async processGriefForFamily(death: DeathEvent): Promise<void> {
    for (const familyMemberId of death.familyMemberIds) {
      // Determine relationship type
      const lineage = await lifecycleManager.getLineageInfo(familyMemberId);
      let relationship: 'parent' | 'child' | 'sibling' = 'sibling';

      if (lineage) {
        if (lineage.parent1Id === death.npcId || lineage.parent2Id === death.npcId) {
          relationship = 'parent'; // Deceased was their parent
        } else if (lineage.children.includes(death.npcId)) {
          relationship = 'child'; // Deceased was their child
        }
      }

      // Process grief emotion
      await emotionProcessor.processGrief(familyMemberId, death.npcId, death.npcName, relationship);

      // Get family member's NPC data for chat
      const familyNpc = this.npcs.get(familyMemberId);
      if (familyNpc) {
        addChatMessage({
          senderId: familyMemberId,
          senderName: familyNpc.username,
          senderType: 'auton',
          message: `*mourns the loss of ${death.npcName}*`,
          position: familyNpc.position,
        });
      }
    }
  }

  /**
   * Process a birth from accepted reproduction proposal
   */
  private async processBirth(proposal: { id: string; proposerId: string; partnerId: string }): Promise<void> {
    // Get parent positions to determine birth location
    const parent1Npc = this.npcs.get(proposal.proposerId);
    const parent2Npc = this.npcs.get(proposal.partnerId);

    const birthPosition = parent1Npc?.position || parent2Npc?.position || { x: 0, y: 0 };

    // Spawn the child
    const child = await childSpawner.spawnChild(proposal.proposerId, proposal.partnerId, birthPosition);

    if (child) {
      // Mark proposal as completed
      await reproductionManager.markCompleted(proposal.id, child.id);

      // Announce birth
      addChatMessage({
        senderId: child.id,
        senderName: child.name,
        senderType: 'auton',
        message: `*has been born!*`,
        position: birthPosition,
      });

      console.log(`[NPCConsciousness] ${child.name} was born to parents ${child.lineageInfo.parent1Name} and ${child.lineageInfo.parent2Name}!`);

      // Add the new NPC to the manager
      const [newNpc] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.id, child.id))
        .limit(1);

      if (newNpc) {
        await this.addNPC(newNpc);
      }

      // Trigger joy for parents
      if (parent1Npc) {
        await emotionProcessor.processBirthJoy(parent1Npc.userId, child.name, 'child');
      }
      if (parent2Npc) {
        await emotionProcessor.processBirthJoy(parent2Npc.userId, child.name, 'child');
      }
    }
  }

  /**
   * Update NPC decision interval based on lifecycle stage
   */
  private async updateNpcDecisionInterval(npcId: string, stage: string): Promise<void> {
    const npc = this.npcs.get(npcId);
    if (!npc) return;

    npc.decisionIntervalMs = 7200000
      + Math.floor(this.stableFraction(npc.userId, `lifecycle-${stage}`) * 60000);

    console.log(`[NPCConsciousness] ${npc.username} now thinks every ${Math.round(npc.decisionIntervalMs / 60000)} minutes (${stage})`);
  }

  /**
   * Run full cognitive process for an NPC
   */
  private async processConsciousness(npc: ConsciousNPC): Promise<void> {
    const timeSinceLastDecision = Date.now() - npc.lastDecisionAt;
    npc.lastDecisionAt = Date.now();

    try {
      await db
        .update(schema.users)
        .set({
          npcLastDecisionAt: new Date(npc.lastDecisionAt),
          updatedAt: new Date(),
        })
        .where(eq(schema.users.id, npc.userId));

      // Build cognitive context
      const context = await this.buildContext(npc, timeSinceLastDecision);

      // Log observation
      addBotActivity({
        type: 'observation',
        agentName: npc.username,
        data: {
          position: npc.position,
          nearbyPlayers: context.visibleEntities
            .filter(e => e.type === 'player')
            .map(e => `${e.name} (${e.x},${e.y})`),
          nearbyNpcs: context.visibleEntities
            .filter(e => e.type === 'auton')
            .map(e => `${e.name} (${e.x},${e.y})`),
        },
      });

      // Run cognitive engine
      const result = await npc.engine.decide(context);

      // Log token usage
      await tokenTracker.log(npc.userId, result.tokenUsage);

      // Log decision with full cognitive detail
      addBotActivity({
        type: 'decision',
        agentName: npc.username,
        data: {
          position: npc.position,
          llmPrompt: `[Perception] ${result.perception.summary}\n[Emotion] ${result.emotionalProcessing.innerThoughts}\n[Reasoning] ${result.reasoning.situationAssessment}`,
          llmResponse: result.planning.innerMonologue,
          actions: result.actions.map(a => ({
            type: a.type,
            direction: a.direction,
            message: a.message,
          })),
          tokens: {
            input: result.tokenUsage.inputTokens,
            output: result.tokenUsage.outputTokens,
          },
        },
      });

      console.log(
        `[NPCConsciousness] ${npc.username}: "${result.planning.innerMonologue.slice(0, 100)}..." ` +
        `(${result.tokenUsage.inputTokens}/${result.tokenUsage.outputTokens} tokens)`
      );

      // Execute actions
      for (const action of result.actions.slice(0, 3)) {
        await this.executeAction(npc, action, context);
        await this.sleep(200);
      }

      // Store memory of this experience
      if (result.newMemory) {
        await memoryManager.storeMemory(npc.userId, result.newMemory);
      }

      // Update emotional state
      await emotionProcessor.updateMentalFocus(
        npc.userId,
        result.perception.summary.slice(0, 100),
        result.planning.innerMonologue
      );

      // Update relationships based on interactions
      for (const entity of context.visibleEntities.slice(0, 5)) {
        await relationshipManager.recordInteraction(npc.userId, entity.id, {
          type: 'chat',
          wasPositive: true,
          details: `Encountered ${entity.name} while ${result.perception.summary.slice(0, 50)}`,
        });
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[NPCConsciousness] Error for ${npc.username}:`, error);

      addBotActivity({
        type: 'error',
        agentName: npc.username,
        data: {
          position: npc.position,
          error: errorMsg,
        },
      });
    }
  }

  /**
   * Build cognitive context for an NPC
   */
  private async buildContext(
    npc: ConsciousNPC,
    timeSinceLastDecision: number
  ): Promise<CognitiveContext> {
    // The worker owns the one physical body. Synchronize cognition to it before
    // calculating perception so autonomous motor movement and thought cannot drift.
    const npcs = await this.workerManager.getVisibleNPCs(
      npc.position.x,
      npc.position.y,
      Math.max(60, npc.roamRadius * 2 + 4),
      Math.max(40, npc.roamRadius * 2 + 4)
    );
    const physicalBody = npcs.find((visible) => visible.npcId === npc.userId);
    if (physicalBody) {
      npc.position = { x: physicalBody.x, y: physicalBody.y };
      npc.direction = physicalBody.direction;
    }

    const players = await this.workerManager.getVisiblePlayers(
      npc.position.x,
      npc.position.y,
      60,
      40,
      npc.userId
    );

    const visibleEntities: VisibleEntity[] = [
      ...players.map(p => ({
        id: p.userId,
        name: p.username,
        type: 'player' as const,
        x: p.x,
        y: p.y,
        distance: Math.sqrt(Math.pow(p.x - npc.position.x, 2) + Math.pow(p.y - npc.position.y, 2)),
      })),
      ...npcs
        .filter(n => n.npcId !== npc.userId)
        .map(n => ({
          id: n.npcId,
          name: n.name,
          type: 'auton' as const,
          x: n.x,
          y: n.y,
          distance: Math.sqrt(Math.pow(n.x - npc.position.x, 2) + Math.pow(n.y - npc.position.y, 2)),
          isAuton: true,
        })),
    ];

    // Get emotional state
    const emotionalState = await emotionProcessor.getEmotionalState(npc.userId);

    // Get relationships
    const relationships = await relationshipManager.getRelationships(npc.userId);

    // Add names to relationships
    for (const entity of visibleEntities) {
      const rel = relationships.get(entity.id);
      if (rel) {
        rel.targetName = entity.name;
      }
    }

    // Get recent memories
    const recentMemories = await memoryManager.getSignificantMemories(npc.userId, 10);

    // Get active goals
    const activeGoals = await this.getActiveGoals(npc.userId);

    // Get nearby events and chat
    const [nearbyEvents, nearbyGatherings, recentChat] = await Promise.all([
      this.socialAnalyzer.getNearbyEvents(npc.position.x, npc.position.y),
      this.socialAnalyzer.getNearbyGatherings(npc.position.x, npc.position.y),
      this.socialAnalyzer.getRecentChat(npc.position.x, npc.position.y),
    ]);

    return {
      self: {
        id: npc.userId,
        name: npc.username,
        personality: npc.personality,
        visualAppearance: npc.visualAppearance,
      },
      position: npc.position,
      direction: npc.direction,
      emotionalState,
      visibleEntities,
      relationships,
      recentMemories,
      activeGoals,
      activeEvents: nearbyEvents,
      nearbyGatherings,
      recentChat,
      currentTime: new Date(),
      timeSinceLastDecision,
    };
  }

  /**
   * Execute a cognitive action
   */
  private async executeAction(
    npc: ConsciousNPC,
    action: CognitiveAction,
    context: CognitiveContext
  ): Promise<void> {
    switch (action.type) {
      case 'move':
      case 'approach':
      case 'avoid':
        if (action.direction) {
          await this.moveNPC(npc, action.direction);
          addBotActivity({
            type: 'action',
            agentName: npc.username,
            data: {
              position: npc.position,
              message: `${action.type === 'approach' ? 'Approaching' : action.type === 'avoid' ? 'Avoiding' : 'Moving'} ${action.direction}`,
            },
          });
        }
        break;

      case 'chat':
        if (action.message) {
          console.log(`[NPCConsciousness] ${npc.username} says: "${action.message}"`);

          // Store in global chat
          addChatMessage({
            senderId: npc.userId,
            senderName: npc.username,
            senderType: 'auton',
            message: action.message,
            position: npc.position,
          });

          // Store in database for other NPCs to see
          await this.socialAnalyzer.storeChatMessage(
            npc.userId,
            npc.username,
            action.message,
            npc.position
          );

          // Log action
          addBotActivity({
            type: 'action',
            agentName: npc.username,
            data: {
              position: npc.position,
              message: `Said: "${action.message}"`,
            },
          });

          // Process emotional impact of speaking
          await emotionProcessor.processEvent(npc.userId, {
            type: 'social_interaction',
            intensity: 0.3,
            wasPositive: true,
          });
        }
        break;

      case 'propose_event':
        if (action.eventDetails) {
          const gathering = await this.socialAnalyzer.createGathering(
            npc.userId,
            npc.username,
            action.eventDetails
          );

          console.log(`[NPCConsciousness] ${npc.username} proposed: "${gathering.name}"`);

          // Announce the event
          addChatMessage({
            senderId: npc.userId,
            senderName: npc.username,
            senderType: 'auton',
            message: `Hey everyone! I'm organizing ${gathering.name}! ${action.eventDetails.description || 'Come join us!'}`,
            position: npc.position,
          });

          addBotActivity({
            type: 'action',
            agentName: npc.username,
            data: {
              position: npc.position,
              message: `Proposed event: ${gathering.name}`,
            },
          });

          // Store as significant memory
          await memoryManager.storeMemory(npc.userId, {
            type: 'event',
            summary: `Organized ${gathering.name}`,
            details: action.eventDetails.description,
            location: action.eventDetails.location,
            participants: [],
            emotionalValence: 0.7,
            emotionalIntensity: 0.6,
            primaryEmotion: 'excitement',
            importance: 0.8,
            tags: ['organized', 'event', gathering.type],
          });

          // Emotional boost
          await emotionProcessor.processEvent(npc.userId, {
            type: 'success',
            intensity: 0.5,
            wasPositive: true,
          });
        }
        break;

      case 'join_event':
        if (action.targetId) {
          await this.socialAnalyzer.joinGathering(action.targetId, npc.userId);

          addBotActivity({
            type: 'action',
            agentName: npc.username,
            data: {
              position: npc.position,
              message: `Joined gathering ${action.targetId}`,
            },
          });
        }
        break;

      case 'emote':
        if (action.emote) {
          addChatMessage({
            senderId: npc.userId,
            senderName: npc.username,
            senderType: 'auton',
            message: `*${action.emote}*`,
            position: npc.position,
          });

          addBotActivity({
            type: 'action',
            agentName: npc.username,
            data: {
              position: npc.position,
              message: `Emote: *${action.emote}*`,
            },
          });
        }
        break;

      case 'wait':
        // Do nothing, but maybe process loneliness if alone
        if (context.visibleEntities.length === 0) {
          await emotionProcessor.processEvent(npc.userId, {
            type: 'loneliness',
            intensity: 0.2,
            wasPositive: false,
          });
        }
        break;
    }
  }

  /**
   * Move an NPC, respecting roam radius
   */
  private async moveNPC(npc: ConsciousNPC, direction: Direction): Promise<void> {
    const physicalBody = await this.workerManager.moveNPC(npc.userId, direction);
    if (!physicalBody) return;

    npc.position = { x: physicalBody.x, y: physicalBody.y };
    npc.direction = physicalBody.direction;
  }

  private stableFraction(id: string, salt: string): number {
    let hash = 2166136261;
    const input = `${id}:${salt}`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0) / 0x100000000;
  }

  private isDirection(value: unknown): value is Direction {
    return value === 'up' || value === 'down' || value === 'left' || value === 'right';
  }

  /**
   * Get active goals for an NPC
   */
  private async getActiveGoals(npcId: string): Promise<Goal[]> {
    const results = await db
      .select()
      .from(schema.npcGoals)
      .where(eq(schema.npcGoals.npcId, npcId));

    return results.map((row: NpcGoalRow) => ({
      id: row.id,
      type: row.goalType as Goal['type'],
      description: row.description,
      motivation: row.motivation || undefined,
      priority: row.priority || 0.5,
      timeframe: row.timeframe as Goal['timeframe'],
      status: row.status as Goal['status'],
      progress: row.progress || 0,
      steps: (row.steps as string[]) || [],
      targetLocation: row.targetLocation as { x: number; y: number } | undefined,
      targetUserId: row.targetUserId || undefined,
      expiresAt: row.expiresAt || undefined,
      createdAt: row.createdAt,
    }));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get number of conscious NPCs
   */
  getNPCCount(): number {
    return this.npcs.size;
  }
}
