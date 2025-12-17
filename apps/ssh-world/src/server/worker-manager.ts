/**
 * Worker Manager - Manages the game worker child process
 *
 * Handles hot reload by:
 * 1. Killing current worker
 * 2. Spawning fresh worker
 * 3. Re-registering all connected sessions
 *
 * State is NOT serialized - sessions have their own positions
 * and the database is the source of truth.
 */

import { fork, ChildProcess } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { PlayerInput } from '@maldoror/protocol';
import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from '../worker/game-worker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type ReloadState = 'running' | 'reloading';
export type ReloadCallback = (state: ReloadState) => void;
export type SpriteReloadCallback = (userId: string) => void;

interface WorkerManagerConfig {
  worldSeed: bigint;
  tickRate: number;
  chunkCacheSize: number;
}

interface PendingRequest {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

// Track connected sessions for re-registration after hot reload
interface ConnectedSession {
  userId: string;
  sessionId: string;
  username: string;
}

export class WorkerManager {
  private config: WorkerManagerConfig;
  private worker: ChildProcess | null = null;
  private workerReady: boolean = false;
  private reloadState: ReloadState = 'running';
  private reloadCallbacks: Set<ReloadCallback> = new Set();
  private spriteReloadCallbacks: Map<string, SpriteReloadCallback> = new Map();
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestIdCounter: number = 0;
  // Track connected sessions so we can re-register after hot reload
  private connectedSessions: Map<string, ConnectedSession> = new Map();

  constructor(config: WorkerManagerConfig) {
    this.config = config;
  }

  /**
   * Start the worker process
   */
  async start(): Promise<void> {
    await this.spawnWorker();
  }

  /**
   * Stop the worker process
   */
  stop(): void {
    if (this.worker) {
      this.sendToWorker({ type: 'shutdown' });
      this.worker = null;
      this.workerReady = false;
    }
  }

  /**
   * Hot reload - spawn fresh worker and re-register sessions
   * No state serialization needed - sessions have their own positions
   * and the database is the source of truth.
   */
  async hotReload(): Promise<void> {
    console.log('[WorkerManager] Hot reload initiated...');
    console.log(`[WorkerManager] ${this.connectedSessions.size} sessions to re-register`);

    // Notify all sessions that we're reloading
    this.reloadState = 'reloading';
    this.notifyReloadState();

    try {
      // Kill current worker
      if (this.worker) {
        this.worker.kill('SIGTERM');
        this.worker = null;
        this.workerReady = false;
      }

      // Small delay to ensure process is fully terminated
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Spawn fresh worker (no state to transfer)
      await this.spawnWorker();

      // Re-register all connected sessions with the new worker
      for (const session of this.connectedSessions.values()) {
        this.sendToWorker({
          type: 'player_connect',
          userId: session.userId,
          sessionId: session.sessionId,
          username: session.username,
        });
      }

      console.log('[WorkerManager] Hot reload complete');
    } catch (error) {
      console.error('[WorkerManager] Hot reload failed:', error);
      // Try to recover by spawning fresh worker
      await this.spawnWorker();
    }

    // Notify all sessions that reload is complete
    this.reloadState = 'running';
    this.notifyReloadState();
  }

  /**
   * Subscribe to reload state changes
   */
  onReloadState(callback: ReloadCallback): () => void {
    this.reloadCallbacks.add(callback);
    return () => this.reloadCallbacks.delete(callback);
  }

  /**
   * Subscribe to sprite reload broadcasts
   */
  onSpriteReload(userId: string, callback: SpriteReloadCallback): void {
    this.spriteReloadCallbacks.set(userId, callback);
  }

  /**
   * Unsubscribe from sprite reload broadcasts
   */
  offSpriteReload(userId: string): void {
    this.spriteReloadCallbacks.delete(userId);
  }

  /**
   * Check if worker is ready
   */
  isReady(): boolean {
    return this.workerReady && this.reloadState === 'running';
  }

  /**
   * Get current reload state
   */
  getReloadState(): ReloadState {
    return this.reloadState;
  }

  // === Game Server Interface ===
  // These methods match the GameServer interface for easy migration

  async playerConnect(userId: string, sessionId: string, username: string): Promise<void> {
    // Track session for hot reload re-registration
    this.connectedSessions.set(userId, { userId, sessionId, username });

    if (!this.isReady()) return;
    this.sendToWorker({
      type: 'player_connect',
      userId,
      sessionId,
      username,
    });
  }

  async playerDisconnect(userId: string): Promise<void> {
    // Remove from tracked sessions
    this.connectedSessions.delete(userId);

    if (!this.worker) return;
    this.sendToWorker({
      type: 'player_disconnect',
      userId,
    });
    this.spriteReloadCallbacks.delete(userId);
  }

  queueInput(input: PlayerInput): void {
    if (!this.isReady()) return;
    this.sendToWorker({
      type: 'player_input',
      input,
    });
  }

  updatePlayerPosition(userId: string, x: number, y: number): void {
    if (!this.isReady()) return;
    this.sendToWorker({
      type: 'update_position',
      userId,
      x,
      y,
    });
  }

  async getVisiblePlayers(
    x: number,
    y: number,
    cols: number,
    rows: number,
    excludeId: string
  ): Promise<
    Array<{
      userId: string;
      username: string;
      x: number;
      y: number;
      direction: string;
      animationFrame: number;
    }>
  > {
    if (!this.isReady()) return [];

    const requestId = this.nextRequestId();
    return this.sendRequest<
      Array<{
        userId: string;
        username: string;
        x: number;
        y: number;
        direction: string;
        animationFrame: number;
      }>
    >(
      {
        type: 'get_visible_players',
        requestId,
        x,
        y,
        cols,
        rows,
        excludeId,
      },
      requestId,
      'visible_players'
    );
  }

  async getAllPlayers(): Promise<
    Array<{
      userId: string;
      username: string;
      x: number;
      y: number;
      isOnline: boolean;
    }>
  > {
    if (!this.isReady()) return [];

    const requestId = this.nextRequestId();
    return this.sendRequest<
      Array<{
        userId: string;
        username: string;
        x: number;
        y: number;
        isOnline: boolean;
      }>
    >(
      {
        type: 'get_all_players',
        requestId,
      },
      requestId,
      'all_players'
    );
  }

  async broadcastSpriteReload(userId: string): Promise<void> {
    // Broadcast locally to all sessions
    for (const [_sessionUserId, callback] of this.spriteReloadCallbacks) {
      callback(userId);
    }

    // Also tell worker (in case it needs to track anything)
    if (this.isReady()) {
      this.sendToWorker({
        type: 'broadcast_sprite_reload',
        userId,
      });
    }
  }

  // === Private Methods ===

  private async spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const workerPath = join(__dirname, '../worker/game-worker.js');

      console.log(`[WorkerManager] Spawning worker: ${workerPath}`);

      this.worker = fork(workerPath, [], {
        stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
      });

      const timeout = setTimeout(() => {
        reject(new Error('Worker startup timeout'));
      }, 10000);

      const onReady = (msg: WorkerToMainMessage) => {
        if (msg.type === 'ready') {
          clearTimeout(timeout);
          this.workerReady = true;
          console.log('[WorkerManager] Worker is ready');
          resolve();
        }
      };

      this.worker.once('message', onReady);

      this.worker.on('message', (msg: WorkerToMainMessage) => {
        this.handleWorkerMessage(msg);
      });

      this.worker.on('error', (error) => {
        console.error('[WorkerManager] Worker error:', error);
        clearTimeout(timeout);
        reject(error);
      });

      this.worker.on('exit', (code) => {
        console.log(`[WorkerManager] Worker exited with code ${code}`);
        this.workerReady = false;

        // If unexpected exit during normal operation, try to restart
        if (this.reloadState === 'running' && code !== 0) {
          console.log('[WorkerManager] Unexpected worker exit, restarting...');
          setTimeout(() => this.spawnWorker(), 1000);
        }
      });

      // Initialize worker
      this.sendToWorker({
        type: 'init',
        worldSeed: this.config.worldSeed.toString(),
        tickRate: this.config.tickRate,
        chunkCacheSize: this.config.chunkCacheSize,
      });
    });
  }

  private handleWorkerMessage(msg: WorkerToMainMessage): void {
    switch (msg.type) {
      case 'visible_players':
      case 'all_players': {
        const pending = this.pendingRequests.get(msg.requestId);
        if (pending) {
          clearTimeout(pending.timeout);
          this.pendingRequests.delete(msg.requestId);
          pending.resolve(msg.players);
        }
        break;
      }

      case 'sprite_reload': {
        // Forward sprite reload to all sessions
        for (const [_userId, callback] of this.spriteReloadCallbacks) {
          callback(msg.userId);
        }
        break;
      }

      case 'error': {
        console.error('[WorkerManager] Worker reported error:', msg.message);
        break;
      }

      case 'ready': {
        // Already handled in spawnWorker
        break;
      }
    }
  }

  private sendToWorker(msg: MainToWorkerMessage): void {
    if (this.worker && this.worker.connected) {
      this.worker.send(msg);
    }
  }

  private sendRequest<T>(
    msg: MainToWorkerMessage,
    requestId: string,
    _responseType: string
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Request ${requestId} timed out`));
      }, 5000);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeout,
      });

      this.sendToWorker(msg);
    });
  }

  private notifyReloadState(): void {
    for (const callback of this.reloadCallbacks) {
      callback(this.reloadState);
    }
  }

  private nextRequestId(): string {
    return `req_${++this.requestIdCounter}`;
  }
}
