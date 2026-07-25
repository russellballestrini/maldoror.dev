/**
 * Agent Session
 *
 * Handles a single agent WebSocket connection.
 * Manages authentication, action processing, and observation streaming.
 */

import { EventEmitter } from 'events';
import type { WebSocket } from 'ws';
import { createHash } from 'crypto';
import { db, schema } from '@maldoror/db';
import { eq, and, isNull } from 'drizzle-orm';
import type { WorkerManager } from './worker-manager.js';
import { addChatMessage, addBotActivity } from './stats-server.js';
import { LOGIN_ORIGIN } from '../game/login-origin.js';
import type {
  ClientMessage,
  ServerMessage,
  AuthenticatePayload,
  AuthenticatedPayload,
  SubscribePayload,
  ActionPayload,
  ActionResponsePayload,
  ObservationPayload,
  PlayerInfo,
  NPCInfo,
  TileInfo,
  Direction,
} from '@maldoror/agent';

export interface AgentSessionConfig {
  ws: WebSocket;
  workerManager: WorkerManager;
  observationIntervalMs: number;
}

interface RateLimitState {
  moveCount: number;
  moveResetAt: number;
  chatCount: number;
  chatResetAt: number;
}

export interface AgentSessionEvents {
  authenticated: [userId: string];
  disconnected: [userId: string | null];
  error: [error: Error];
}

export class AgentSession extends EventEmitter {
  private ws: WebSocket;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private workerManager: WorkerManager; // Will be used for full integration with game server
  private observationIntervalMs: number;
  private authenticated = false;
  private userId: string | null = null;
  private username: string | null = null;
  private observationTimer: ReturnType<typeof setInterval> | null = null;
  private subscriptions = {
    observations: false,
    terrain: false,
    terrainRadius: 15,
    chat: false,
  };
  private rateLimit: RateLimitState = {
    moveCount: 0,
    moveResetAt: Date.now() + 1000,
    chatCount: 0,
    chatResetAt: Date.now() + 5000,
  };
  private position = { x: 0, y: 0 };
  private direction: Direction = 'down';
  private tick = 0;

  constructor(config: AgentSessionConfig) {
    super();
    this.ws = config.ws;
    this.workerManager = config.workerManager;
    this.observationIntervalMs = config.observationIntervalMs;

    this.setupHandlers();

    // Keep reference for future use (e.g., sending actions to game server)
    void this.workerManager;
  }

  private setupHandlers(): void {
    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as ClientMessage;
        this.handleMessage(message);
      } catch (err) {
        this.sendError('Invalid message format');
      }
    });

    this.ws.on('close', () => {
      this.cleanup();
      this.emit('disconnected', this.userId);
    });

    this.ws.on('error', (err) => {
      this.emit('error', err);
    });
  }

  private async handleMessage(message: ClientMessage): Promise<void> {
    try {
      switch (message.type) {
        case 'authenticate':
          await this.handleAuthenticate(message.payload as AuthenticatePayload, message.id);
          break;

        case 'subscribe':
          this.handleSubscribe(message.payload as SubscribePayload, message.id);
          break;

        case 'unsubscribe':
          this.handleUnsubscribe(message.payload as { observations?: boolean; chat?: boolean }, message.id);
          break;

        case 'action':
          await this.handleAction(message.payload as ActionPayload, message.id);
          break;

        default:
          this.sendError(`Unknown message type: ${(message as { type: string }).type}`);
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.sendError(error, message.id);
    }
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  private async handleAuthenticate(payload: AuthenticatePayload, requestId?: string): Promise<void> {
    if (this.authenticated) {
      this.sendResponse<AuthenticatedPayload>('authenticated', {
        success: false,
        error: 'Already authenticated',
      }, requestId);
      return;
    }

    const { token, agentName } = payload;

    // Validate token format
    if (!token || !token.startsWith('mat_') || token.length < 36) {
      this.sendResponse<AuthenticatedPayload>('authenticated', {
        success: false,
        error: 'Invalid token format',
      }, requestId);
      return;
    }

    // Hash the token
    const tokenHash = createHash('sha256').update(token).digest('hex');

    // Look up token in database
    const tokenRecord = await db
      .select({
        id: schema.agentTokens.id,
        userId: schema.agentTokens.userId,
        expiresAt: schema.agentTokens.expiresAt,
        revokedAt: schema.agentTokens.revokedAt,
      })
      .from(schema.agentTokens)
      .where(
        and(
          eq(schema.agentTokens.tokenHash, tokenHash),
          isNull(schema.agentTokens.revokedAt)
        )
      )
      .limit(1);

    if (tokenRecord.length === 0) {
      this.sendResponse<AuthenticatedPayload>('authenticated', {
        success: false,
        error: 'Invalid or revoked token',
      }, requestId);
      return;
    }

    const record = tokenRecord[0]!;

    // Check expiration
    if (record.expiresAt && record.expiresAt < new Date()) {
      this.sendResponse<AuthenticatedPayload>('authenticated', {
        success: false,
        error: 'Token expired',
      }, requestId);
      return;
    }

    // Get user info
    const userRecord = await db
      .select({
        id: schema.users.id,
        username: schema.users.username,
      })
      .from(schema.users)
      .where(eq(schema.users.id, record.userId))
      .limit(1);

    if (userRecord.length === 0) {
      this.sendResponse<AuthenticatedPayload>('authenticated', {
        success: false,
        error: 'User not found',
      }, requestId);
      return;
    }

    const user = userRecord[0]!;

    // Update last used timestamp
    await db
      .update(schema.agentTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(schema.agentTokens.id, record.id));

    // Preserve facing, but never restore a persisted position on a fresh agent
    // login. Agent and SSH admission share the same canonical-origin contract.
    const playerState = await db
      .select({
        direction: schema.playerState.direction,
      })
      .from(schema.playerState)
      .where(eq(schema.playerState.userId, user.id))
      .limit(1);

    if (playerState.length > 0) {
      const state = playerState[0]!;
      this.direction = (state.direction as Direction) || 'down';
    }
    this.position = { x: LOGIN_ORIGIN.x, y: LOGIN_ORIGIN.y };

    // Mark as authenticated
    this.authenticated = true;
    this.userId = user.id;
    this.username = agentName || user.username;

    // Persist the reset before exposing the player to the game worker.
    if (playerState.length > 0) {
      await db
        .update(schema.playerState)
        .set({
          x: LOGIN_ORIGIN.x,
          y: LOGIN_ORIGIN.y,
          animationFrame: 0,
          isOnline: true,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.playerState.userId, this.userId!));
    } else {
      await db.insert(schema.playerState).values({
        userId: this.userId!,
        x: LOGIN_ORIGIN.x,
        y: LOGIN_ORIGIN.y,
        direction: this.direction,
        isOnline: true,
      });
    }

    // Register with game worker so agent is visible to other players
    await this.workerManager.playerConnect(this.userId!, `agent-${this.userId}`, this.username!);

    // Also set the initial position in the game worker
    this.workerManager.updatePlayerPosition(this.userId!, this.position.x, this.position.y);

    console.log(`[AgentSession] Authenticated: ${this.username} (${this.userId}) at (${this.position.x}, ${this.position.y})`);

    this.emit('authenticated', this.userId!);

    this.sendResponse<AuthenticatedPayload>('authenticated', {
      success: true,
      userId: this.userId!,
      username: this.username!,
      serverVersion: '1.0.0',
      tickRate: 20,
    }, requestId);
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  private handleSubscribe(payload: SubscribePayload, requestId?: string): void {
    if (!this.authenticated) {
      this.sendError('Not authenticated', requestId);
      return;
    }

    if (payload.observations !== undefined) {
      this.subscriptions.observations = payload.observations;
    }
    if (payload.terrain !== undefined) {
      this.subscriptions.terrain = payload.terrain;
    }
    if (payload.terrainRadius !== undefined) {
      this.subscriptions.terrainRadius = Math.min(30, Math.max(5, payload.terrainRadius));
    }
    if (payload.chat !== undefined) {
      this.subscriptions.chat = payload.chat;
    }

    // Start or stop observation timer
    if (this.subscriptions.observations && !this.observationTimer) {
      const interval = Math.max(100, payload.observationInterval ?? this.observationIntervalMs);
      this.observationTimer = setInterval(() => this.sendObservation(), interval);
      // Send initial observation immediately
      this.sendObservation();
    } else if (!this.subscriptions.observations && this.observationTimer) {
      clearInterval(this.observationTimer);
      this.observationTimer = null;
    }
  }

  private handleUnsubscribe(payload: { observations?: boolean; chat?: boolean }, requestId?: string): void {
    if (!this.authenticated) {
      this.sendError('Not authenticated', requestId);
      return;
    }

    if (payload.observations) {
      this.subscriptions.observations = false;
      if (this.observationTimer) {
        clearInterval(this.observationTimer);
        this.observationTimer = null;
      }
    }
    if (payload.chat) {
      this.subscriptions.chat = false;
    }
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  private async handleAction(payload: ActionPayload, requestId?: string): Promise<void> {
    if (!this.authenticated) {
      this.sendResponse<ActionResponsePayload>('action_response', {
        success: false,
        error: 'Not authenticated',
      }, requestId);
      return;
    }

    switch (payload.action) {
      case 'move':
        await this.handleMove(payload.direction, requestId);
        break;

      case 'chat':
        await this.handleChat(payload.message, requestId);
        break;

      case 'place_road':
        await this.handlePlaceRoad(requestId);
        break;

      case 'wait':
        this.sendResponse<ActionResponsePayload>('action_response', {
          success: true,
        }, requestId);
        break;

      default:
        this.sendResponse<ActionResponsePayload>('action_response', {
          success: false,
          error: 'Unknown action',
        }, requestId);
    }
  }

  private async handleMove(direction: Direction, requestId?: string): Promise<void> {
    // Rate limit: 10 moves per second
    const now = Date.now();
    if (now >= this.rateLimit.moveResetAt) {
      this.rateLimit.moveCount = 0;
      this.rateLimit.moveResetAt = now + 1000;
    }

    if (this.rateLimit.moveCount >= 10) {
      this.sendResponse<ActionResponsePayload>('action_response', {
        success: false,
        error: 'Rate limited (max 10 moves/second)',
      }, requestId);
      return;
    }

    this.rateLimit.moveCount++;

    // Calculate new position
    const dx = direction === 'left' ? -1 : direction === 'right' ? 1 : 0;
    const dy = direction === 'up' ? -1 : direction === 'down' ? 1 : 0;
    const newX = this.position.x + dx;
    const newY = this.position.y + dy;

    // TODO: Check walkability via TileProvider
    // For now, just update position

    this.position = { x: newX, y: newY };
    this.direction = direction;

    // Update player state in database
    await db
      .update(schema.playerState)
      .set({
        x: newX,
        y: newY,
        direction,
        updatedAt: new Date(),
      })
      .where(eq(schema.playerState.userId, this.userId!));

    // Update position in game worker so other players see movement
    this.workerManager.updatePlayerPosition(this.userId!, newX, newY);

    this.sendResponse<ActionResponsePayload>('action_response', {
      success: true,
      newPosition: { x: newX, y: newY },
    }, requestId);
  }

  private async handleChat(message: string, requestId?: string): Promise<void> {
    // Rate limit: 1 message per 5 seconds
    const now = Date.now();
    if (now >= this.rateLimit.chatResetAt) {
      this.rateLimit.chatCount = 0;
      this.rateLimit.chatResetAt = now + 5000;
    }

    if (this.rateLimit.chatCount >= 1) {
      this.sendResponse<ActionResponsePayload>('action_response', {
        success: false,
        error: 'Rate limited (max 1 chat/5 seconds)',
      }, requestId);
      return;
    }

    this.rateLimit.chatCount++;

    // Truncate message
    const truncatedMessage = message.slice(0, 256);

    // Log to global chat (only if authenticated)
    if (this.userId && this.username) {
      addChatMessage({
        senderId: this.userId,
        senderName: this.username,
        senderType: 'auton',
        message: truncatedMessage,
        position: { x: this.position.x, y: this.position.y },
      });

      // Log as bot activity
      addBotActivity({
        type: 'action',
        agentName: this.username,
        data: {
          position: { x: this.position.x, y: this.position.y },
          message: `Said: "${truncatedMessage}"`,
        },
      });
    }

    console.log(`[AgentSession] Chat from ${this.username}: ${truncatedMessage}`);

    this.sendResponse<ActionResponsePayload>('action_response', {
      success: true,
    }, requestId);
  }

  private async handlePlaceRoad(requestId?: string): Promise<void> {
    // Check if road already exists at this position
    const existing = await db
      .select({ id: schema.roads.id })
      .from(schema.roads)
      .where(
        and(
          eq(schema.roads.x, this.position.x),
          eq(schema.roads.y, this.position.y)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      this.sendResponse<ActionResponsePayload>('action_response', {
        success: false,
        error: 'Road already exists here',
      }, requestId);
      return;
    }

    // Place road
    await db.insert(schema.roads).values({
      x: this.position.x,
      y: this.position.y,
      placedBy: this.userId!,
    });

    this.sendResponse<ActionResponsePayload>('action_response', {
      success: true,
    }, requestId);
  }

  // ===========================================================================
  // Observations
  // ===========================================================================

  private async sendObservation(): Promise<void> {
    if (!this.authenticated || !this.subscriptions.observations) return;

    this.tick++;

    try {
      // Get visible players
      const players = await this.getVisiblePlayers();

      // Get visible NPCs
      const npcs = await this.getVisibleNPCs();

      // Get terrain if subscribed
      let terrain: ObservationPayload['terrain'] | undefined;
      if (this.subscriptions.terrain) {
        terrain = await this.getTerrain();
      }

      const observation: ObservationPayload = {
        tick: this.tick,
        self: {
          userId: this.userId!,
          x: this.position.x,
          y: this.position.y,
          direction: this.direction,
        },
        players,
        npcs,
        terrain,
        recentChat: [], // TODO: Implement chat history
      };

      this.sendMessage<ObservationPayload>('observation', observation);
    } catch (err) {
      console.error('[AgentSession] Error sending observation:', err);
    }
  }

  private async getVisiblePlayers(): Promise<PlayerInfo[]> {
    const viewRadius = 20;

    // Query player states within view radius
    const players = await db
      .select({
        userId: schema.playerState.userId,
        username: schema.users.username,
        x: schema.playerState.x,
        y: schema.playerState.y,
        direction: schema.playerState.direction,
      })
      .from(schema.playerState)
      .innerJoin(schema.users, eq(schema.playerState.userId, schema.users.id));

    type PlayerRow = typeof players[number];

    // Filter and calculate distances
    return players
      .filter((p: PlayerRow) => {
        if (p.userId === this.userId) return false;
        const dx = Math.abs(p.x - this.position.x);
        const dy = Math.abs(p.y - this.position.y);
        return dx <= viewRadius && dy <= viewRadius;
      })
      .map((p: PlayerRow) => ({
        userId: p.userId,
        username: p.username || 'Unknown',
        x: p.x,
        y: p.y,
        direction: (p.direction as Direction) || 'down',
        distance: Math.abs(p.x - this.position.x) + Math.abs(p.y - this.position.y),
      }));
  }

  private async getVisibleNPCs(): Promise<NPCInfo[]> {
    const viewRadius = 20;

    // Query NPCs within view radius
    const npcs = await db
      .select({
        id: schema.npcs.id,
        name: schema.npcs.name,
        spawnX: schema.npcs.spawnX,
        spawnY: schema.npcs.spawnY,
      })
      .from(schema.npcs);

    type NPCRow = typeof npcs[number];

    // Filter and calculate distances
    return npcs
      .filter((n: NPCRow) => {
        const dx = Math.abs(n.spawnX - this.position.x);
        const dy = Math.abs(n.spawnY - this.position.y);
        return dx <= viewRadius && dy <= viewRadius;
      })
      .map((n: NPCRow) => ({
        npcId: n.id,
        name: n.name,
        x: n.spawnX,
        y: n.spawnY,
        direction: 'down' as Direction,
        distance: Math.abs(n.spawnX - this.position.x) + Math.abs(n.spawnY - this.position.y),
      }));
  }

  private async getTerrain(): Promise<ObservationPayload['terrain']> {
    const radius = this.subscriptions.terrainRadius;
    const tiles: TileInfo[] = [];

    // For now, return empty terrain - full implementation would use TileProvider
    // TODO: Integrate with TileProvider for actual terrain data

    return {
      centerX: this.position.x,
      centerY: this.position.y,
      radius,
      tiles,
    };
  }

  // ===========================================================================
  // Messaging
  // ===========================================================================

  private sendMessage<T>(type: string, payload: T, id?: string): void {
    const message: ServerMessage = {
      type,
      payload,
      timestamp: Date.now(),
    } as ServerMessage;

    if (id) {
      (message as { id?: string }).id = id;
    }

    this.send(JSON.stringify(message));
  }

  private sendResponse<T>(type: string, payload: T, requestId?: string): void {
    this.sendMessage(type, payload, requestId);
  }

  private sendError(error: string, requestId?: string): void {
    this.sendMessage('error', { error }, requestId);
  }

  send(data: string): void {
    if (this.ws.readyState === 1) { // OPEN
      this.ws.send(data);
    }
  }

  close(): void {
    this.cleanup();
    this.ws.close();
  }

  private cleanup(): void {
    if (this.observationTimer) {
      clearInterval(this.observationTimer);
      this.observationTimer = null;
    }

    // Set player offline and unregister from game worker
    if (this.userId) {
      // Unregister from game worker
      this.workerManager.playerDisconnect(this.userId)
        .catch((err: Error) => {
          console.error(`[AgentSession] Failed to unregister from worker:`, err);
        });

      // Update database
      db.update(schema.playerState)
        .set({
          isOnline: false,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.playerState.userId, this.userId))
        .then(() => {
          console.log(`[AgentSession] ${this.username} set offline`);
        })
        .catch((err: Error) => {
          console.error(`[AgentSession] Failed to set offline:`, err);
        });
    }
  }

  // ===========================================================================
  // Event Emitter Type Safety
  // ===========================================================================

  on<E extends keyof AgentSessionEvents>(
    event: E,
    listener: (...args: AgentSessionEvents[E]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof AgentSessionEvents>(event: E, ...args: AgentSessionEvents[E]): boolean {
    return super.emit(event, ...args);
  }
}
