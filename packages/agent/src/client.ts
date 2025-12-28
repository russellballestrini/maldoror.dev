/**
 * Maldoror Agent Client
 *
 * WebSocket client for controlling a character in the Maldoror world.
 */

import WebSocket from 'ws';
import { EventEmitter } from 'events';
import type {
  Direction,
  Position,
  ClientMessage,
  ServerMessage,
  AuthenticatePayload,
  SubscribePayload,
  ActionPayload,
  ObservationPayload,
  AuthenticatedPayload,
  ActionResponsePayload,
  EventPayload,
} from './types.js';

// =============================================================================
// Client Configuration
// =============================================================================

export interface AgentClientConfig {
  serverUrl: string; // e.g., 'ws://localhost:3000/agent'
  token: string;
  agentName?: string;
  agentVersion?: string;
  autoReconnect?: boolean;
  reconnectDelayMs?: number;
  maxReconnectAttempts?: number;
}

// =============================================================================
// Event Types
// =============================================================================

export interface AgentClientEvents {
  connected: [];
  authenticated: [userId: string, username: string];
  observation: [observation: ObservationPayload];
  event: [event: EventPayload];
  actionResult: [id: string, success: boolean, error?: string];
  error: [error: Error];
  disconnected: [code: number, reason: string];
  reconnecting: [attempt: number];
}

// =============================================================================
// Client Implementation
// =============================================================================

export class MaldororAgentClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: Required<AgentClientConfig>;
  private authenticated = false;
  private userId: string | null = null;
  private username: string | null = null;
  private lastObservation: ObservationPayload | null = null;
  private pendingRequests = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestIdCounter = 0;
  private observationInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: AgentClientConfig) {
    super();
    this.config = {
      agentName: 'MaldororAgent',
      agentVersion: '1.0.0',
      autoReconnect: true,
      reconnectDelayMs: 5000,
      maxReconnectAttempts: 10,
      ...config,
    };
  }

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.serverUrl);

        this.ws.on('open', () => {
          this.reconnectAttempts = 0;
          this.emit('connected');
          this.authenticate()
            .then(() => resolve())
            .catch(reject);
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as ServerMessage;
            this.handleMessage(message);
          } catch (err) {
            this.emit('error', new Error(`Failed to parse message: ${err}`));
          }
        });

        this.ws.on('close', (code, reason) => {
          this.handleDisconnect(code, reason.toString());
        });

        this.ws.on('error', (err) => {
          this.emit('error', err);
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.observationInterval) {
      clearInterval(this.observationInterval);
      this.observationInterval = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.authenticated = false;
    this.pendingRequests.forEach(({ reject }) => {
      reject(new Error('Client disconnected'));
    });
    this.pendingRequests.clear();
  }

  private handleDisconnect(code: number, reason: string): void {
    this.authenticated = false;
    this.emit('disconnected', code, reason);

    if (this.config.autoReconnect && this.reconnectAttempts < this.config.maxReconnectAttempts) {
      this.reconnectAttempts++;
      this.emit('reconnecting', this.reconnectAttempts);
      this.reconnectTimer = setTimeout(() => {
        this.connect().catch((err) => {
          this.emit('error', err);
        });
      }, this.config.reconnectDelayMs);
    }
  }

  // ===========================================================================
  // Authentication
  // ===========================================================================

  private async authenticate(): Promise<void> {
    const payload: AuthenticatePayload = {
      token: this.config.token,
      agentName: this.config.agentName,
      agentVersion: this.config.agentVersion,
    };

    const response = (await this.sendRequest('authenticate', payload)) as AuthenticatedPayload;

    if (!response.success) {
      throw new Error(response.error || 'Authentication failed');
    }

    this.authenticated = true;
    this.userId = response.userId || null;
    this.username = response.username || null;
    this.emit('authenticated', this.userId!, this.username!);
  }

  // ===========================================================================
  // Subscriptions
  // ===========================================================================

  async subscribe(options: SubscribePayload): Promise<void> {
    if (!this.authenticated) {
      throw new Error('Not authenticated');
    }
    await this.send({
      type: 'subscribe',
      payload: options,
    });
  }

  async unsubscribe(options: { observations?: boolean; chat?: boolean }): Promise<void> {
    if (!this.authenticated) {
      throw new Error('Not authenticated');
    }
    await this.send({
      type: 'unsubscribe',
      payload: options,
    });
  }

  // ===========================================================================
  // Actions
  // ===========================================================================

  async move(direction: Direction): Promise<ActionResponsePayload> {
    return this.sendAction({ action: 'move', direction });
  }

  async chat(message: string): Promise<ActionResponsePayload> {
    if (message.length > 256) {
      throw new Error('Message too long (max 256 characters)');
    }
    return this.sendAction({ action: 'chat', message });
  }

  async placeRoad(): Promise<ActionResponsePayload> {
    return this.sendAction({ action: 'place_road' });
  }

  async wait(): Promise<ActionResponsePayload> {
    return this.sendAction({ action: 'wait' });
  }

  private async sendAction(payload: ActionPayload): Promise<ActionResponsePayload> {
    if (!this.authenticated) {
      throw new Error('Not authenticated');
    }
    return (await this.sendRequest('action', payload)) as ActionResponsePayload;
  }

  // ===========================================================================
  // State Accessors
  // ===========================================================================

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  get isAuthenticated(): boolean {
    return this.authenticated;
  }

  get currentUserId(): string | null {
    return this.userId;
  }

  get currentUsername(): string | null {
    return this.username;
  }

  get observation(): ObservationPayload | null {
    return this.lastObservation;
  }

  getPosition(): Position | null {
    if (!this.lastObservation) return null;
    return {
      x: this.lastObservation.self.x,
      y: this.lastObservation.self.y,
    };
  }

  getDirection(): Direction | null {
    return this.lastObservation?.self.direction || null;
  }

  // ===========================================================================
  // Message Handling
  // ===========================================================================

  private handleMessage(message: ServerMessage): void {
    // Handle responses to pending requests
    if (message.id && this.pendingRequests.has(message.id)) {
      const { resolve } = this.pendingRequests.get(message.id)!;
      this.pendingRequests.delete(message.id);
      resolve(message.payload);
      return;
    }

    // Handle pushed messages
    switch (message.type) {
      case 'observation':
        this.lastObservation = message.payload as ObservationPayload;
        this.emit('observation', this.lastObservation);
        break;

      case 'event':
        this.emit('event', message.payload as EventPayload);
        break;

      case 'action_response':
        // Action responses without ID are fire-and-forget
        break;

      default:
        // Unknown message type
        break;
    }
  }

  // ===========================================================================
  // Low-Level Send
  // ===========================================================================

  private async send(message: Omit<ClientMessage, 'timestamp'>): Promise<void> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected');
    }

    const fullMessage = {
      ...message,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      this.ws!.send(JSON.stringify(fullMessage), (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async sendRequest(type: string, payload: unknown): Promise<unknown> {
    const id = `${++this.requestIdCounter}`;

    const message = {
      type,
      id,
      payload,
      timestamp: Date.now(),
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Request ${id} timed out`));
        }
      }, 10000);

      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.pendingRequests.delete(id);
        reject(new Error('Not connected'));
        return;
      }

      this.ws.send(JSON.stringify(message), (err) => {
        if (err) {
          this.pendingRequests.delete(id);
          reject(err);
        }
      });
    });
  }

  // ===========================================================================
  // Event Emitter Type Safety
  // ===========================================================================

  on<E extends keyof AgentClientEvents>(
    event: E,
    listener: (...args: AgentClientEvents[E]) => void
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  once<E extends keyof AgentClientEvents>(
    event: E,
    listener: (...args: AgentClientEvents[E]) => void
  ): this {
    return super.once(event, listener as (...args: unknown[]) => void);
  }

  emit<E extends keyof AgentClientEvents>(event: E, ...args: AgentClientEvents[E]): boolean {
    return super.emit(event, ...args);
  }
}
