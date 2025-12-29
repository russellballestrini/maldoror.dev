/**
 * NPC Bot Manager
 *
 * Manages all NPC bots running in-process with LLM-powered decision making.
 * NPCs are users with is_npc = true, using the same infrastructure as players.
 */

import { eq } from 'drizzle-orm';
import { db, schema } from '@maldoror/db';
import {
  CharacterDecisionEngine,
  tokenTracker,
  type CharacterObservation,
  type CharacterAction,
} from '@maldoror/ai-character';
import type { WorkerManager } from '../server/worker-manager.js';
import type { Direction } from '@maldoror/protocol';
import { addBotActivity, addChatMessage } from '../server/stats-server.js';

interface NPCBot {
  userId: string;
  username: string;
  engine: CharacterDecisionEngine;
  position: { x: number; y: number };
  direction: Direction;
  lastDecisionAt: number;
  decisionIntervalMs: number;
  spawnX: number;
  spawnY: number;
  roamRadius: number;
}

export interface NPCBotManagerConfig {
  workerManager: WorkerManager;
  apiKey: string;
  defaultProvider?: 'openai' | 'anthropic';
  defaultModel?: string;
  defaultDecisionIntervalMs?: number;
}

/**
 * NPCBotManager - Manages LLM-powered NPC bots
 *
 * Loads NPCs from the users table (where is_npc = true) and runs
 * their AI decision loops in-process. Each NPC is registered as
 * a player with the WorkerManager.
 */
export class NPCBotManager {
  private bots: Map<string, NPCBot> = new Map();
  private workerManager: WorkerManager;
  private apiKey: string;
  private defaultProvider: 'openai' | 'anthropic';
  private defaultModel: string;
  private defaultDecisionIntervalMs: number;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor(config: NPCBotManagerConfig) {
    this.workerManager = config.workerManager;
    this.apiKey = config.apiKey;
    this.defaultProvider = config.defaultProvider || 'openai';
    this.defaultModel = config.defaultModel || 'gpt-4o-mini';
    this.defaultDecisionIntervalMs = config.defaultDecisionIntervalMs || 7200000; // 2 hours
  }

  /**
   * Load all NPCs from database and start their bots
   */
  async loadFromDB(): Promise<void> {
    console.log('[NPCBotManager] Loading NPCs from database...');

    const npcs = await db
      .select()
      .from(schema.users)
      .where(eq(schema.users.isNpc, true));

    console.log(`[NPCBotManager] Found ${npcs.length} NPCs`);

    for (const npc of npcs) {
      await this.addNPC(npc);
    }

    console.log(`[NPCBotManager] Loaded ${this.bots.size} NPC bots`);
  }

  /**
   * Add an NPC to the manager
   */
  private async addNPC(npc: typeof schema.users.$inferSelect): Promise<void> {
    // Skip NPCs without personality (not yet migrated or configured)
    if (!npc.personality) {
      console.log(`[NPCBotManager] Skipping ${npc.username} - no personality configured`);
      return;
    }

    // Parse goals from JSONB
    const goals = Array.isArray(npc.goals) ? npc.goals as string[] : [];

    // Create decision engine
    const engine = new CharacterDecisionEngine({
      provider: (npc.aiProvider as 'openai' | 'anthropic') || this.defaultProvider,
      model: npc.aiModel || this.defaultModel,
      apiKey: this.apiKey,
      personality: npc.personality,
      goals,
    });

    const bot: NPCBot = {
      userId: npc.id,
      username: npc.username,
      engine,
      position: {
        x: npc.spawnX || 0,
        y: npc.spawnY || 0,
      },
      direction: 'down',
      lastDecisionAt: 0, // Will trigger immediate first decision
      decisionIntervalMs: npc.decisionIntervalMs || this.defaultDecisionIntervalMs,
      spawnX: npc.spawnX || 0,
      spawnY: npc.spawnY || 0,
      roamRadius: npc.roamRadius || 15,
    };

    this.bots.set(npc.id, bot);

    // Register with game server as a player
    await this.workerManager.playerConnect(
      npc.id,
      `npc-${npc.id}`,
      npc.username
    );

    // Set initial position
    this.workerManager.updatePlayerPosition(
      npc.id,
      bot.position.x,
      bot.position.y
    );

    console.log(`[NPCBotManager] Added NPC "${npc.username}" at (${bot.position.x}, ${bot.position.y})`);
  }

  /**
   * Start the decision loop
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    // Check for decisions every 10 seconds
    this.tickInterval = setInterval(() => {
      this.tick();
    }, 10000);

    console.log('[NPCBotManager] Started decision loop');
  }

  /**
   * Stop the decision loop
   */
  stop(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }
    this.started = false;

    // Disconnect all NPCs
    for (const bot of this.bots.values()) {
      this.workerManager.playerDisconnect(bot.userId);
    }

    console.log('[NPCBotManager] Stopped');
  }

  /**
   * Check all bots and make decisions for those whose interval has elapsed
   */
  private tick(): void {
    const now = Date.now();

    for (const bot of this.bots.values()) {
      const elapsed = now - bot.lastDecisionAt;
      if (elapsed >= bot.decisionIntervalMs) {
        // Run decision asynchronously
        this.makeDecision(bot).catch((error) => {
          console.error(`[NPCBotManager] Decision error for ${bot.username}:`, error);
        });
      }
    }
  }

  /**
   * Make a decision for a single NPC bot
   */
  private async makeDecision(bot: NPCBot): Promise<void> {
    bot.lastDecisionAt = Date.now();

    try {
      // Build observation from current game state
      const observation = await this.buildObservation(bot);

      // Log observation
      addBotActivity({
        type: 'observation',
        agentName: bot.username,
        data: {
          position: { x: bot.position.x, y: bot.position.y },
          nearbyPlayers: observation.players.map(p => `${p.username} (${p.x},${p.y})`),
          nearbyNpcs: observation.npcs.map(n => `${n.name} (${n.x},${n.y})`),
        },
      });

      // Get decision from LLM
      const result = await bot.engine.decide(observation);

      // Log token usage
      await tokenTracker.log(bot.userId, result.tokenUsage);

      // Log decision
      addBotActivity({
        type: 'decision',
        agentName: bot.username,
        data: {
          position: { x: bot.position.x, y: bot.position.y },
          llmPrompt: result.prompt,
          llmResponse: result.response,
          actions: result.actions,
          tokens: {
            input: result.tokenUsage.inputTokens,
            output: result.tokenUsage.outputTokens,
          },
        },
      });

      console.log(
        `[NPCBotManager] ${bot.username} decided: ${JSON.stringify(result.actions)} ` +
        `(${result.tokenUsage.inputTokens}/${result.tokenUsage.outputTokens} tokens)`
      );

      // Execute actions
      for (const action of result.actions.slice(0, 3)) {
        await this.executeAction(bot, action);
        // Small delay between actions
        await this.sleep(100);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[NPCBotManager] Error making decision for ${bot.username}:`, error);

      addBotActivity({
        type: 'error',
        agentName: bot.username,
        data: {
          position: { x: bot.position.x, y: bot.position.y },
          error: errorMsg,
        },
      });
    }
  }

  /**
   * Build observation data for a bot
   */
  private async buildObservation(bot: NPCBot): Promise<CharacterObservation> {
    // Get nearby players from the worker
    const players = await this.workerManager.getVisiblePlayers(
      bot.position.x,
      bot.position.y,
      60, // viewport width
      40, // viewport height
      bot.userId // exclude self
    );

    // Get nearby NPCs (other bots)
    const npcs = await this.workerManager.getVisibleNPCs(
      bot.position.x,
      bot.position.y,
      60,
      40
    );

    // Filter out self from NPCs
    const otherNpcs = npcs.filter(npc => npc.npcId !== bot.userId);

    return {
      tick: Date.now(),
      self: {
        x: bot.position.x,
        y: bot.position.y,
        direction: bot.direction,
      },
      players: players.map(p => ({
        userId: p.userId,
        username: p.username,
        x: p.x,
        y: p.y,
        distance: Math.sqrt(
          Math.pow(p.x - bot.position.x, 2) +
          Math.pow(p.y - bot.position.y, 2)
        ),
      })),
      npcs: otherNpcs.map(n => ({
        id: n.npcId,
        name: n.name,
        x: n.x,
        y: n.y,
        distance: Math.sqrt(
          Math.pow(n.x - bot.position.x, 2) +
          Math.pow(n.y - bot.position.y, 2)
        ),
      })),
      terrain: undefined, // TODO: Get terrain info from worker
      recentChat: [], // TODO: Track recent chat messages
    };
  }

  /**
   * Execute a single action for a bot
   */
  private async executeAction(bot: NPCBot, action: CharacterAction): Promise<void> {
    switch (action.type) {
      case 'move':
        if (action.direction) {
          this.moveBot(bot, action.direction);

          addBotActivity({
            type: 'action',
            agentName: bot.username,
            data: {
              position: { x: bot.position.x, y: bot.position.y },
              message: `Moved ${action.direction}`,
            },
          });
        }
        break;

      case 'chat':
        if (action.message) {
          console.log(`[NPCBotManager] ${bot.username} says: ${action.message}`);

          // Log to global chat
          addChatMessage({
            senderId: bot.userId,
            senderName: bot.username,
            senderType: 'auton',
            message: action.message,
            position: { x: bot.position.x, y: bot.position.y },
          });

          // Log as bot activity
          addBotActivity({
            type: 'action',
            agentName: bot.username,
            data: {
              position: { x: bot.position.x, y: bot.position.y },
              message: `Said: "${action.message}"`,
            },
          });

          // TODO: Broadcast chat to nearby players via worker
          // this.workerManager.broadcastChat(bot.userId, bot.username, action.message);
        }
        break;

      case 'wait':
        // Do nothing
        break;
    }
  }

  /**
   * Move a bot in a direction, respecting roam radius
   */
  private moveBot(bot: NPCBot, direction: Direction): void {
    let newX = bot.position.x;
    let newY = bot.position.y;

    switch (direction) {
      case 'up':
        newY--;
        break;
      case 'down':
        newY++;
        break;
      case 'left':
        newX--;
        break;
      case 'right':
        newX++;
        break;
    }

    // Check roam radius
    const dx = newX - bot.spawnX;
    const dy = newY - bot.spawnY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= bot.roamRadius) {
      bot.position.x = newX;
      bot.position.y = newY;
      bot.direction = direction;

      // Update position in game server
      this.workerManager.updatePlayerPosition(bot.userId, newX, newY);
    }
  }

  /**
   * Get number of active bots
   */
  getBotCount(): number {
    return this.bots.size;
  }

  /**
   * Get bot by user ID
   */
  getBot(userId: string): NPCBot | undefined {
    return this.bots.get(userId);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
