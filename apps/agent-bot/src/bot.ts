/**
 * Maldoror Agent Bot
 *
 * LLM-powered bot using the full consciousness system.
 * Has memory, emotions, relationships, and rich inner life.
 */

import {
  MaldororAgentClient,
  type ObservationPayload,
  type EventPayload,
  type Direction,
} from '@maldoror/agent';
import {
  CognitiveEngine,
  memoryManager,
  emotionProcessor,
  relationshipManager,
  createSocialAnalyzer,
  tokenTracker,
  type CognitiveContext,
  type CognitiveAction,
  type VisibleEntity,
} from '@maldoror/ai-character';
import type { BotConfig } from './config.js';

// Bot activity log entry type (matches server's BotLogEntry)
interface BotLogEntry {
  type: 'observation' | 'decision' | 'action' | 'error' | 'info';
  agentName: string;
  data: {
    position?: { x: number; y: number };
    nearbyPlayers?: string[];
    nearbyNpcs?: string[];
    llmPrompt?: string;
    llmResponse?: string;
    actions?: Array<{ type: string; direction?: string; message?: string }>;
    tokens?: { input: number; output: number };
    error?: string;
    message?: string;
  };
}

export class MaldororBot {
  private client: MaldororAgentClient;
  private cognitiveEngine: CognitiveEngine;
  private socialAnalyzer: ReturnType<typeof createSocialAnalyzer>;
  private config: BotConfig;
  private running = false;
  private lastObservation: ObservationPayload | null = null;
  private decisionTimer: ReturnType<typeof setTimeout> | null = null;
  private logUrl: string | null = null;
  private userId: string = '';
  private username: string = '';

  constructor(config: BotConfig) {
    this.config = config;

    this.client = new MaldororAgentClient({
      serverUrl: config.serverUrl,
      token: config.token,
      agentName: config.agentName,
      autoReconnect: true,
      reconnectDelayMs: 5000,
    });

    // Create the full consciousness cognitive engine
    this.cognitiveEngine = new CognitiveEngine({
      npcId: '', // Will be set on authentication
      personality: config.personality,
      goals: config.goals,
      provider: config.aiProvider,
      model: config.aiModel,
      apiKey: config.aiApiKey,
      enableReflection: true,
      enableEventProposal: true,
      enableDeepReasoning: true,
    });

    this.socialAnalyzer = createSocialAnalyzer(config.aiApiKey);

    // Derive log URL from server URL (convert ws:// to http://)
    try {
      const serverUrl = new URL(config.serverUrl);
      const protocol = serverUrl.protocol === 'wss:' ? 'https:' : 'http:';
      this.logUrl = `${protocol}//${serverUrl.host}/bot-logs`;
    } catch {
      this.logUrl = null;
    }

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('connected', () => {
      this.log('info', 'Connected to server');
    });

    this.client.on('authenticated', (userId, username) => {
      this.userId = userId;
      this.username = username;

      // Reinitialize cognitive engine with proper user ID
      this.cognitiveEngine = new CognitiveEngine({
        npcId: userId,
        personality: this.config.personality,
        goals: this.config.goals,
        provider: this.config.aiProvider,
        model: this.config.aiModel,
        apiKey: this.config.aiApiKey,
        enableReflection: true,
        enableEventProposal: true,
        enableDeepReasoning: true,
      });

      // Initialize emotional state
      emotionProcessor.getEmotionalState(userId).catch(() => {
        // If no state exists, initialize it
        emotionProcessor.initializeEmotionalState(userId).catch(console.error);
      });

      this.log('info', `Authenticated as ${username} (${userId})`);
    });

    this.client.on('observation', (obs) => {
      this.lastObservation = obs;
      this.log('debug', `Observation tick ${obs.tick}: pos (${obs.self.x}, ${obs.self.y})`);
    });

    this.client.on('event', (event) => {
      this.handleEvent(event);
    });

    this.client.on('disconnected', (code, reason) => {
      this.log('warn', `Disconnected: ${code} - ${reason}`);
    });

    this.client.on('reconnecting', (attempt) => {
      this.log('info', `Reconnecting (attempt ${attempt})...`);
    });

    this.client.on('error', (err) => {
      this.log('error', `Client error: ${err.message}`);
    });
  }

  private handleEvent(event: EventPayload): void {
    switch (event.event) {
      case 'player_entered':
        this.log('info', `Player entered view: ${event.player.username}`);
        break;
      case 'player_left':
        this.log('info', `Player left view: ${event.player.username}`);
        break;
      case 'chat':
        this.log('info', `Chat: ${event.message.senderName}: ${event.message.text}`);
        // Store chat for context
        this.storeChatMessage(event.message).catch(() => {});
        break;
      case 'rate_limited':
        this.log('warn', `Rate limited: ${event.message}`);
        break;
    }
  }

  private async storeChatMessage(msg: { senderId: string; senderName: string; text: string }): Promise<void> {
    if (!this.lastObservation) return;

    try {
      await this.socialAnalyzer.storeChatMessage(
        msg.senderId,
        msg.senderName,
        msg.text,
        { x: this.lastObservation.self.x, y: this.lastObservation.self.y }
      );
    } catch (error) {
      // Silently fail - chat storage is optional
    }
  }

  async start(): Promise<void> {
    this.log('info', `Starting ${this.config.agentName} with CONSCIOUSNESS SYSTEM...`);
    this.log('info', `Server: ${this.config.serverUrl}`);
    this.log('info', `AI: ${this.config.aiProvider} / ${this.config.aiModel}`);

    try {
      await this.client.connect();

      this.log('info', 'Subscribing to observations...');
      await this.client.subscribe({
        observations: true,
        observationInterval: 500,
        terrain: true,
        terrainRadius: 10,
        chat: true,
      });

      this.running = true;
      this.scheduleNextDecision();

      this.log('info', 'Bot is now running with full consciousness. Press Ctrl+C to stop.');
    } catch (err) {
      this.log('error', `Failed to start: ${err}`);
      throw err;
    }
  }

  private scheduleNextDecision(): void {
    if (!this.running) return;

    // Use configured interval (default 10 min for consciousness system)
    this.decisionTimer = setTimeout(async () => {
      await this.makeDecision();
      this.scheduleNextDecision();
    }, this.config.decisionIntervalMs);
  }

  private async makeDecision(): Promise<void> {
    if (!this.lastObservation || !this.userId) {
      this.log('debug', 'No observation yet, waiting...');
      return;
    }

    const obs = this.lastObservation;

    try {
      this.log('info', 'Running cognitive decision process...');

      // Report observation before making decision
      await this.reportActivity({
        type: 'observation',
        data: {
          position: { x: obs.self.x, y: obs.self.y },
          nearbyPlayers: obs.players.map(p => p.username),
          nearbyNpcs: obs.npcs?.map(n => n.name) || [],
        },
      });

      // Build full cognitive context
      const context = await this.buildCognitiveContext(obs);

      // Run the full cognitive process (5 phases)
      const result = await this.cognitiveEngine.decide(context);

      // Track token usage
      await tokenTracker.log(this.userId, result.tokenUsage);

      // Report decision with full cognitive detail
      await this.reportActivity({
        type: 'decision',
        data: {
          position: { x: obs.self.x, y: obs.self.y },
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

      this.log('info',
        `Decision: "${result.planning.innerMonologue.slice(0, 100)}..." ` +
        `(${result.tokenUsage.inputTokens}/${result.tokenUsage.outputTokens} tokens)`
      );

      // Execute actions
      for (const action of result.actions.slice(0, this.config.maxActionsPerDecision)) {
        await this.executeAction(action, context);
        await this.sleep(200);
      }

      // Store memory of this experience
      if (result.newMemory) {
        await memoryManager.storeMemory(this.userId, result.newMemory);
      }

      // Update emotional state
      await emotionProcessor.updateMentalFocus(
        this.userId,
        result.perception.summary.slice(0, 100),
        result.planning.innerMonologue
      );

      // Update relationships based on interactions
      for (const entity of context.visibleEntities.slice(0, 5)) {
        await relationshipManager.recordInteraction(this.userId, entity.id, {
          type: 'approach',
          wasPositive: true,
          details: `Encountered ${entity.name}`,
        });
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.log('error', `Decision error: ${errorMsg}`);
      await this.reportActivity({
        type: 'error',
        data: {
          position: { x: obs.self.x, y: obs.self.y },
          error: errorMsg,
        },
      });
    }
  }

  /**
   * Build full cognitive context from WebSocket observation
   */
  private async buildCognitiveContext(obs: ObservationPayload): Promise<CognitiveContext> {
    // Convert players and NPCs to visible entities
    const visibleEntities: VisibleEntity[] = [
      ...obs.players.map(p => ({
        id: p.userId,
        name: p.username,
        type: 'player' as const,
        x: p.x,
        y: p.y,
        distance: p.distance,
      })),
      ...obs.npcs.map(n => ({
        id: n.npcId,
        name: n.name,
        type: 'npc' as const,
        x: n.x,
        y: n.y,
        distance: n.distance,
        isNpc: true,
      })),
    ];

    // Get emotional state
    const emotionalState = await emotionProcessor.getEmotionalState(this.userId);

    // Get relationships
    const relationships = await relationshipManager.getRelationships(this.userId);

    // Add names to relationships
    for (const entity of visibleEntities) {
      const rel = relationships.get(entity.id);
      if (rel) {
        rel.targetName = entity.name;
      }
    }

    // Get recent memories
    const recentMemories = await memoryManager.getSignificantMemories(this.userId, 10);

    // Get chat from both observation and database
    const [dbChat] = await Promise.all([
      this.socialAnalyzer.getRecentChat(obs.self.x, obs.self.y, 60),
    ]);

    // Merge observation chat with database chat
    const recentChat = [
      ...obs.recentChat.map(c => ({
        senderId: c.senderId,
        senderName: c.senderName,
        message: c.text,
        location: { x: obs.self.x, y: obs.self.y },
        timestamp: new Date(c.timestamp),
      })),
      ...dbChat,
    ].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, 20);

    // Get nearby events and gatherings
    const [nearbyEvents, nearbyGatherings] = await Promise.all([
      this.socialAnalyzer.getNearbyEvents(obs.self.x, obs.self.y),
      this.socialAnalyzer.getNearbyGatherings(obs.self.x, obs.self.y),
    ]);

    return {
      self: {
        id: this.userId,
        name: this.username,
        personality: this.config.personality,
      },
      position: { x: obs.self.x, y: obs.self.y },
      direction: obs.self.direction,
      emotionalState,
      visibleEntities,
      relationships,
      recentMemories,
      activeGoals: [], // External bot doesn't have persisted goals yet
      activeEvents: nearbyEvents,
      nearbyGatherings,
      recentChat,
      currentTime: new Date(),
      timeSinceLastDecision: this.config.decisionIntervalMs,
    };
  }

  private async executeAction(action: CognitiveAction, context: CognitiveContext): Promise<void> {
    try {
      switch (action.type) {
        case 'move':
        case 'approach':
        case 'avoid':
          if (action.direction) {
            this.log('info', `Moving ${action.direction}`);
            await this.client.move(action.direction as Direction);
          }
          break;

        case 'chat':
          if (action.message) {
            this.log('info', `Saying: ${action.message}`);
            await this.client.chat(action.message);

            // Store our own chat message
            await this.socialAnalyzer.storeChatMessage(
              this.userId,
              this.username,
              action.message,
              context.position
            );

            // Process emotional impact of speaking
            await emotionProcessor.processEvent(this.userId, {
              type: 'social_interaction',
              intensity: 0.3,
              wasPositive: true,
            });
          }
          break;

        case 'emote':
          if (action.emote) {
            this.log('info', `Emoting: *${action.emote}*`);
            await this.client.chat(`*${action.emote}*`);
          }
          break;

        case 'propose_event':
          if (action.eventDetails) {
            const gathering = await this.socialAnalyzer.createGathering(
              this.userId,
              this.username,
              action.eventDetails
            );
            this.log('info', `Proposed event: ${gathering.name}`);

            // Announce the event
            await this.client.chat(
              `Hey everyone! I'm organizing ${gathering.name}! ${action.eventDetails.description || 'Come join us!'}`
            );

            // Store as significant memory
            await memoryManager.storeMemory(this.userId, {
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
          }
          break;

        case 'wait':
          this.log('debug', 'Waiting...');
          // Process loneliness if alone
          if (context.visibleEntities.length === 0) {
            await emotionProcessor.processEvent(this.userId, {
              type: 'loneliness',
              intensity: 0.2,
              wasPositive: false,
            });
          }
          break;
      }
    } catch (err) {
      this.log('error', `Action error (${action.type}): ${err}`);
    }
  }

  async stop(): Promise<void> {
    this.log('info', 'Stopping bot...');
    this.running = false;

    if (this.decisionTimer) {
      clearTimeout(this.decisionTimer);
      this.decisionTimer = null;
    }

    this.client.disconnect();
    this.log('info', 'Bot stopped.');
  }

  private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    const levels = ['debug', 'info', 'warn', 'error'];
    const configLevel = levels.indexOf(this.config.logLevel);
    const msgLevel = levels.indexOf(level);

    if (msgLevel >= configLevel) {
      const timestamp = new Date().toISOString();
      const prefix = `[${timestamp}] [${level.toUpperCase()}]`;
      console.log(`${prefix} ${message}`);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Report activity to the server's bot-logs endpoint
   */
  private async reportActivity(entry: Omit<BotLogEntry, 'agentName'>): Promise<void> {
    if (!this.logUrl) return;

    try {
      const fullEntry: BotLogEntry = {
        ...entry,
        agentName: this.config.agentName,
      };

      await fetch(this.logUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fullEntry),
      });
    } catch (error) {
      // Silently fail - don't let logging errors affect bot operation
      this.log('debug', `Failed to report activity: ${error}`);
    }
  }
}
