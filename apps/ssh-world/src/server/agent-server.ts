/**
 * Agent WebSocket Server
 *
 * Handles WebSocket connections from programmatic agents.
 * Attaches to the existing stats-server HTTP server.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import type { Server as HttpServer, IncomingMessage } from 'http';
import type { Socket } from 'net';
import { AgentSession, type AgentSessionConfig } from './agent-session.js';
import type { WorkerManager } from './worker-manager.js';

export interface AgentServerConfig {
  workerManager: WorkerManager;
  maxConnections?: number;
  observationIntervalMs?: number;
}

export class AgentServer {
  private wss: WebSocketServer;
  private sessions = new Map<string, AgentSession>();
  private config: Required<AgentServerConfig>;

  constructor(config: AgentServerConfig) {
    this.config = {
      maxConnections: config.maxConnections ?? 100,
      observationIntervalMs: config.observationIntervalMs ?? 500,
      workerManager: config.workerManager,
    };

    // Create WebSocket server without HTTP server (we'll handle upgrades manually)
    this.wss = new WebSocketServer({ noServer: true });
    this.setupHandlers();
  }

  /**
   * Attach to an existing HTTP server
   * The agent endpoint will be available at /agent
   */
  attachToServer(httpServer: HttpServer): void {
    httpServer.on('upgrade', (request: IncomingMessage, socket: Socket, head: Buffer) => {
      const pathname = new URL(request.url || '/', `http://${request.headers.host}`).pathname;

      if (pathname === '/agent' || pathname === '/agent/') {
        // Check connection limit
        if (this.sessions.size >= this.config.maxConnections) {
          console.warn('[AgentServer] Connection limit reached, rejecting new connection');
          socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
          socket.destroy();
          return;
        }

        // Upgrade to WebSocket
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      }
      // Let other upgrade requests (if any) fall through
    });

    console.log('[AgentServer] WebSocket agent endpoint attached at /agent');
  }

  private setupHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
      const clientIp = request.headers['x-forwarded-for'] ||
        request.socket.remoteAddress || 'unknown';
      console.log(`[AgentServer] New connection from ${clientIp}`);

      const sessionConfig: AgentSessionConfig = {
        ws,
        workerManager: this.config.workerManager,
        observationIntervalMs: this.config.observationIntervalMs,
      };

      const session = new AgentSession(sessionConfig);

      session.on('authenticated', (userId: string) => {
        this.sessions.set(userId, session);
        console.log(`[AgentServer] Agent authenticated: ${userId} (${this.sessions.size} active)`);
      });

      session.on('disconnected', (userId: string | null) => {
        if (userId) {
          this.sessions.delete(userId);
        }
        console.log(`[AgentServer] Agent disconnected: ${userId || 'unauthenticated'} (${this.sessions.size} active)`);
      });

      session.on('error', (error: Error) => {
        console.error('[AgentServer] Session error:', error.message);
      });
    });

    this.wss.on('error', (error: Error) => {
      console.error('[AgentServer] WebSocket server error:', error);
    });
  }

  /**
   * Get the number of active agent connections
   */
  getActiveCount(): number {
    return this.sessions.size;
  }

  /**
   * Get all connected user IDs
   */
  getConnectedUserIds(): string[] {
    return Array.from(this.sessions.keys());
  }

  /**
   * Broadcast a message to all connected agents
   */
  broadcast(message: object): void {
    const json = JSON.stringify(message);
    for (const session of this.sessions.values()) {
      session.send(json);
    }
  }

  /**
   * Close all connections and shut down
   */
  close(): void {
    for (const session of this.sessions.values()) {
      session.close();
    }
    this.sessions.clear();
    this.wss.close();
  }
}
