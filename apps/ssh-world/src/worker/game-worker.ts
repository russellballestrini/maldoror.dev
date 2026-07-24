/**
 * Game Worker - Child process that runs game logic
 *
 * This process can be killed and respawned during hot reload
 * while the main process maintains SSH connections.
 */

import { GameServer } from '../game/game-server.js';
import type { PlayerInput, NPCVisualState, Sprite, WorldLifeState } from '@maldoror/protocol';
import type { NPCCreateData } from '../utils/npc-storage.js';
import type { ProviderConfig } from '@maldoror/ai';
import { WorkerSession } from './worker-session.js';
import { loadAllTerrainTilesFromDisk } from '../utils/terrain-storage.js';
import { setTerrainTiles, type RegionalPreparedViewportPayload } from '@maldoror/world';
import {
  loadCanalTownDefaultAvatar,
  loadCanalTownKit,
  type LoadedCanalTownKit,
} from '../game/canal-town-assets.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
  type LoadedRegionalWorldKit,
} from '../game/regional-world-provider.js';
import { RegionalPrewarmService } from '../game/regional-prewarm-service.js';
import { getHeapStatistics } from 'node:v8';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

// Message types for IPC
export interface WorkerInitMessage {
  type: 'init';
  worldSeed: string; // BigInt serialized as string
  tickRate: number;
  chunkCacheSize: number;
  providerConfig: ProviderConfig;
}

export interface PlayerConnectMessage {
  type: 'player_connect';
  userId: string;
  sessionId: string;
  username: string;
}

export interface PlayerDisconnectMessage {
  type: 'player_disconnect';
  userId: string;
}

export interface PlayerInputMessage {
  type: 'player_input';
  input: PlayerInput;
}

export interface UpdatePositionMessage {
  type: 'update_position';
  userId: string;
  x: number;
  y: number;
}

export interface GetVisiblePlayersMessage {
  type: 'get_visible_players';
  requestId: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
  excludeId: string;
}

export interface GetAllPlayersMessage {
  type: 'get_all_players';
  requestId: string;
}

export interface BroadcastSpriteReloadMessage {
  type: 'broadcast_sprite_reload';
  userId: string;
}

export interface ShutdownMessage {
  type: 'shutdown';
}

// NPC Messages
export interface GetVisibleNPCsMessage {
  type: 'get_visible_npcs';
  requestId: string;
  x: number;
  y: number;
  cols: number;
  rows: number;
}

export interface GetWorldLifeStateMessage {
  type: 'get_world_life_state';
  requestId: string;
}

export interface GetNPCSpriteMessage {
  type: 'get_npc_sprite';
  requestId: string;
  npcId: string;
}

export interface CreateNPCMessage {
  type: 'create_npc';
  requestId: string;
  data: NPCCreateData;
}

export interface MoveNPCMessage {
  type: 'move_npc';
  requestId: string;
  npcId: string;
  direction: 'up' | 'down' | 'left' | 'right';
}

export interface FlushNPCStateMessage {
  type: 'flush_npc_state';
  requestId: string;
}

export interface AddBuildingCollisionMessage {
  type: 'add_building_collision';
  anchorX: number;
  anchorY: number;
}

// Session state for hot-reload preservation
export interface SessionState {
  sessionId: string;
  playerX: number;
  playerY: number;
  zoomLevel: number;
  renderMode: string;
  cameraMode: string;
}

// Session messages for hot-reload architecture
export interface CreateSessionMessage {
  type: 'create_session';
  sessionId: string;
  fingerprint: string;
  username: string;
  userId: string | null;
  cols: number;
  rows: number;
  term?: string;
  restoredState?: SessionState;
}

export interface GetAllSessionStatesMessage {
  type: 'get_all_session_states';
  requestId: string;
}

export interface GetWorkerRuntimeMessage {
  type: 'get_worker_runtime';
  requestId: string;
}

export interface DestroySessionMessage {
  type: 'destroy_session';
  sessionId: string;
}

export interface SessionInputMessage {
  type: 'session_input';
  sessionId: string;
  data: number[]; // Buffer as array
}

export interface SessionResizeMessage {
  type: 'session_resize';
  sessionId: string;
  cols: number;
  rows: number;
}

export interface SessionKeyframeMessage {
  type: 'session_keyframe';
  sessionId: string;
}

export type MainToWorkerMessage =
  | WorkerInitMessage
  | PlayerConnectMessage
  | PlayerDisconnectMessage
  | PlayerInputMessage
  | UpdatePositionMessage
  | GetVisiblePlayersMessage
  | GetAllPlayersMessage
  | BroadcastSpriteReloadMessage
  | GetVisibleNPCsMessage
  | GetWorldLifeStateMessage
  | GetNPCSpriteMessage
  | CreateNPCMessage
  | MoveNPCMessage
  | FlushNPCStateMessage
  | AddBuildingCollisionMessage
  | CreateSessionMessage
  | DestroySessionMessage
  | SessionInputMessage
  | SessionResizeMessage
  | SessionKeyframeMessage
  | GetAllSessionStatesMessage
  | GetWorkerRuntimeMessage
  | ShutdownMessage;

// Response types
export interface WorkerReadyMessage {
  type: 'ready';
}

export interface VisiblePlayersResponse {
  type: 'visible_players';
  requestId: string;
  players: Array<{
    userId: string;
    username: string;
    x: number;
    y: number;
    direction: string;
    animationFrame: number;
  }>;
}

export interface AllPlayersResponse {
  type: 'all_players';
  requestId: string;
  players: Array<{
    userId: string;
    username: string;
    x: number;
    y: number;
    isOnline: boolean;
  }>;
}

export interface SpriteReloadBroadcast {
  type: 'sprite_reload';
  userId: string;
}

export interface WorkerErrorMessage {
  type: 'error';
  message: string;
}

// NPC Response types
export interface VisibleNPCsResponse {
  type: 'visible_npcs';
  requestId: string;
  npcs: NPCVisualState[];
}

export interface WorldLifeStateResponse {
  type: 'world_life_state';
  requestId: string;
  state: WorldLifeState;
}

export interface NPCSpriteResponse {
  type: 'npc_sprite';
  requestId: string;
  npcId: string;
  sprite: Sprite | null;
}

export interface CreateNPCResponse {
  type: 'npc_created';
  requestId: string;
  npc: NPCVisualState;
}

export interface NPCCreatedBroadcast {
  type: 'npc_created_broadcast';
  npc: NPCVisualState;
}

export interface NPCMovedResponse {
  type: 'npc_moved';
  requestId: string;
  npc: NPCVisualState | null;
}

export interface NPCStateFlushedResponse {
  type: 'npc_state_flushed';
  requestId: string;
}

// Session output (worker → main)
export interface SessionOutputMessage {
  type: 'session_output';
  sessionId: string;
  output: string;
  keyframe: boolean;
  immediate: boolean;
}

export interface SessionUserIdMessage {
  type: 'session_user_id';
  sessionId: string;
  userId: string;
}

export interface SessionEndedMessage {
  type: 'session_ended';
  sessionId: string;
}

export interface AllSessionStatesResponse {
  type: 'all_session_states';
  requestId: string;
  states: SessionState[];
}

export interface WorkerRuntimeSnapshot {
  pid: number;
  sessions: number;
  memory: {
    rss_mib: number;
    heap_used_mib: number;
    heap_total_mib: number;
    heap_limit_mib: number;
    external_mib: number;
    array_buffers_mib: number;
  };
  event_loop: {
    utilization: number;
    delay_p50_ms: number;
    delay_p95_ms: number;
    delay_p99_ms: number;
    delay_max_ms: number;
  };
  prewarm: ReturnType<RegionalPrewarmService['getStats']> | null;
  session_stats: ReturnType<WorkerSession['getRuntimeStats']>[];
}

export interface WorkerRuntimeResponse {
  type: 'worker_runtime';
  requestId: string;
  runtime: WorkerRuntimeSnapshot;
}

export type WorkerToMainMessage =
  | WorkerReadyMessage
  | VisiblePlayersResponse
  | AllPlayersResponse
  | SpriteReloadBroadcast
  | VisibleNPCsResponse
  | WorldLifeStateResponse
  | NPCSpriteResponse
  | CreateNPCResponse
  | NPCCreatedBroadcast
  | NPCMovedResponse
  | NPCStateFlushedResponse
  | SessionOutputMessage
  | SessionUserIdMessage
  | SessionEndedMessage
  | AllSessionStatesResponse
  | WorkerRuntimeResponse
  | WorkerErrorMessage;

let gameServer: GameServer | null = null;
let worldSeed: bigint = 0n;
let providerConfig: ProviderConfig = { provider: 'openai', model: 'gpt-image-1-mini' };
let canalTownKit: LoadedCanalTownKit | null = null;
let regionalWorldKit: LoadedRegionalWorldKit | null = null;
let regionalPrewarmService: RegionalPrewarmService | null = null;
let regionalOriginViewport: RegionalPreparedViewportPayload | null = null;
let regionalDefaultAvatar: Sprite | null = null;
const workerSessions: Map<string, WorkerSession> = new Map();
let shuttingDown = false;
const workerEventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
workerEventLoopDelay.enable();
let lastWorkerEventLoopUtilization = performance.eventLoopUtilization();

function runtimeMetric(value: number): number {
  return Number(value.toFixed(3));
}

function delayMilliseconds(value: number): number {
  return Number.isFinite(value) ? runtimeMetric(value / 1_000_000) : 0;
}

const REGIONAL_ORIGIN_PREWARM = {
  bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
  resolution: 12,
} as const;

function send(message: WorkerToMainMessage): void {
  if (process.send) {
    process.send(message);
  }
}

function sendSessionOutput(
  sessionId: string,
  output: string,
  keyframe = false,
  immediate = false,
): void {
  send({ type: 'session_output', sessionId, output, keyframe, immediate });
}

function sendSessionUserId(sessionId: string, userId: string): void {
  send({ type: 'session_user_id', sessionId, userId });
}

function sendSessionEnded(sessionId: string): void {
  send({ type: 'session_ended', sessionId });
}

async function shutdownWorker(reason: 'ipc' | 'SIGTERM'): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[Worker] Shutdown requested (${reason})`);

  for (const session of workerSessions.values()) {
    await session.destroy();
  }
  workerSessions.clear();

  if (regionalPrewarmService) {
    await regionalPrewarmService.stop();
    regionalPrewarmService = null;
  }
  regionalWorldKit?.clearSharedCaches();
  regionalWorldKit = null;
  regionalOriginViewport = null;
  regionalDefaultAvatar = null;

  if (gameServer) {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await gameServer.stop();
        lastError = undefined;
        break;
      } catch (error) {
        lastError = error;
        console.error(`[Worker] NPC checkpoint attempt ${attempt}/3 failed:`, error);
        await new Promise((resolve) => setTimeout(resolve, attempt * 250));
      }
    }
    if (lastError) throw lastError;
  }

  process.exit(0);
}

process.on('message', async (msg: MainToWorkerMessage) => {
  try {
    switch (msg.type) {
      case 'init': {
        // Store config for session creation
        worldSeed = BigInt(msg.worldSeed);
        providerConfig = msg.providerConfig;

        gameServer = new GameServer({
          worldSeed,
          tickRate: msg.tickRate,
          chunkCacheSize: msg.chunkCacheSize,
        });

        // Set up sprite reload callback to forward to main process
        gameServer.setGlobalSpriteReloadCallback((userId: string) => {
          send({ type: 'sprite_reload', userId });
        });

        // Set up NPC created callback to forward to main process
        gameServer.setGlobalNPCCreatedCallback((npc: NPCVisualState) => {
          send({ type: 'npc_created_broadcast', npc });
        });

        if (process.env.MALDOROR_REGIONAL_WORLD !== '0') {
          const assets = defaultRegionalWorldAssetPaths(process.env.MALDOROR_ASSET_ROOT);
          const loadedAt = performance.now();
          [regionalWorldKit, regionalDefaultAvatar] = await Promise.all([
            loadRegionalWorldKit({ worldSeed, assets }),
            loadCanalTownDefaultAvatar(),
          ]);
          const started = await RegionalPrewarmService.start(
            { worldSeed: String(worldSeed), assets },
            Number(process.env.MALDOROR_REGIONAL_STARTUP_TIMEOUT_MS ?? 120_000),
          );
          regionalPrewarmService = started.service;
          const origin = await regionalPrewarmService.prepare(
            REGIONAL_ORIGIN_PREWARM.bounds,
            REGIONAL_ORIGIN_PREWARM.resolution,
          );
          regionalOriginViewport = origin.viewport;
          console.log(
            `[Worker] Regional world ready in ${Math.round(performance.now() - loadedAt)}ms; ` +
            `generator startup ${Math.round(started.startup.startupMs)}ms, origin ` +
            `${Math.round(origin.generationMs)}ms at ${origin.viewport.resolution}px, ` +
            `RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
          );
        } else {
          // Explicit rollback lane for the former provider. It is never a
          // silent fallback from a regional startup failure.
          const terrainTiles = await loadAllTerrainTilesFromDisk();
          if (terrainTiles.size > 0) {
            setTerrainTiles(Array.from(terrainTiles.values()));
            console.log(`[Worker] Loaded ${terrainTiles.size} AI terrain tiles from disk`);
          }
          if (process.env.MALDOROR_CANAL_TOWN !== '0') {
            canalTownKit = await loadCanalTownKit(undefined, worldSeed);
            setTerrainTiles(canalTownKit.terrainTiles);
            console.log(
              `[Worker] Loaded ${canalTownKit.assets.length} canal-town assets + ` +
              `${canalTownKit.terrainTiles.length} rasterized terrain tiles from ${canalTownKit.manifestPath} ` +
              `(RSS ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB)`,
            );
          }
        }

        // Load NPCs from database
        await gameServer.loadNPCs();

        gameServer.start();
        send({ type: 'ready' });
        console.log('[Worker] Game server initialized and ready');
        break;
      }

      case 'player_connect': {
        if (!gameServer) break;
        await gameServer.playerConnect(msg.userId, msg.sessionId, msg.username);
        break;
      }

      case 'player_disconnect': {
        if (!gameServer) break;
        await gameServer.playerDisconnect(msg.userId);
        break;
      }

      case 'player_input': {
        if (!gameServer) break;
        gameServer.queueInput(msg.input);
        break;
      }

      case 'update_position': {
        if (!gameServer) break;
        gameServer.updatePlayerPosition(msg.userId, msg.x, msg.y);
        break;
      }

      case 'get_visible_players': {
        if (!gameServer) {
          send({ type: 'visible_players', requestId: msg.requestId, players: [] });
          break;
        }
        const visible = gameServer.getVisiblePlayers(
          msg.x,
          msg.y,
          msg.cols,
          msg.rows,
          msg.excludeId
        );
        send({ type: 'visible_players', requestId: msg.requestId, players: visible });
        break;
      }

      case 'get_all_players': {
        if (!gameServer) {
          send({ type: 'all_players', requestId: msg.requestId, players: [] });
          break;
        }
        const all = gameServer.getAllPlayers();
        send({ type: 'all_players', requestId: msg.requestId, players: all });
        break;
      }

      case 'broadcast_sprite_reload': {
        if (!gameServer) break;
        await gameServer.broadcastSpriteReload(msg.userId);
        break;
      }

      // NPC message handlers
      case 'get_visible_npcs': {
        if (!gameServer) {
          send({ type: 'visible_npcs', requestId: msg.requestId, npcs: [] });
          break;
        }
        const visibleNpcs = gameServer.getVisibleNPCs(msg.x, msg.y, msg.cols, msg.rows);
        send({ type: 'visible_npcs', requestId: msg.requestId, npcs: visibleNpcs });
        break;
      }

      case 'get_world_life_state': {
        if (!gameServer) {
          send({ type: 'error', message: 'Game server not initialized' });
          break;
        }
        send({
          type: 'world_life_state',
          requestId: msg.requestId,
          state: gameServer.getWorldLifeState(),
        });
        break;
      }

      case 'get_npc_sprite': {
        if (!gameServer) {
          send({ type: 'npc_sprite', requestId: msg.requestId, npcId: msg.npcId, sprite: null });
          break;
        }
        const npcSprite = gameServer.getNPCSprite(msg.npcId);
        send({ type: 'npc_sprite', requestId: msg.requestId, npcId: msg.npcId, sprite: npcSprite });
        break;
      }

      case 'create_npc': {
        if (!gameServer) {
          send({ type: 'error', message: 'Game server not initialized' });
          break;
        }
        const createdNpc = await gameServer.createNPC(msg.data);
        send({ type: 'npc_created', requestId: msg.requestId, npc: createdNpc });
        break;
      }

      case 'move_npc': {
        const npc = gameServer?.moveNPC(msg.npcId, msg.direction) ?? null;
        send({ type: 'npc_moved', requestId: msg.requestId, npc });
        break;
      }

      case 'flush_npc_state': {
        if (gameServer) await gameServer.flushNPCState();
        send({ type: 'npc_state_flushed', requestId: msg.requestId });
        break;
      }

      case 'add_building_collision': {
        if (!gameServer) break;
        gameServer.addBuildingToCollisionCache(msg.anchorX, msg.anchorY);
        break;
      }

      // === Session management for hot-reload architecture ===

      case 'create_session': {
        if (!gameServer) {
          send({ type: 'error', message: 'Game server not initialized' });
          break;
        }

        // Check if session already exists (re-registration after hot reload)
        let session = workerSessions.get(msg.sessionId);
        if (session) {
          console.log(`[Worker] Session ${msg.sessionId.slice(0, 8)}... already exists, skipping creation`);
          break;
        }

        // Create new session
        session = new WorkerSession({
          sessionId: msg.sessionId,
          fingerprint: msg.fingerprint,
          username: msg.username,
          userId: msg.userId,
          cols: msg.cols,
          rows: msg.rows,
          term: (msg as { term?: string }).term,
          gameServer,
          worldSeed,
          providerConfig,
          canalTownKit,
          regionalWorldKit,
          regionalPrewarmService,
          regionalOriginViewport,
          regionalDefaultAvatar,
          sendOutput: sendSessionOutput,
          sendUserId: sendSessionUserId,
          sendEnded: sendSessionEnded,
          restoredState: msg.restoredState,
        });

        workerSessions.set(msg.sessionId, session);
        console.log(`[Worker] Created session ${msg.sessionId.slice(0, 8)}... (${workerSessions.size} total)`);

        // Start the session (async, don't block IPC)
        session.start().catch(async err => {
          console.error(`[Worker] Session ${msg.sessionId.slice(0, 8)}... start error:`, err);
          if (workerSessions.get(msg.sessionId) === session) {
            workerSessions.delete(msg.sessionId);
          }
          await session.destroy().catch(destroyError => {
            console.error(`[Worker] Session ${msg.sessionId.slice(0, 8)}... cleanup error:`, destroyError);
          });
        });
        break;
      }

      case 'destroy_session': {
        const session = workerSessions.get(msg.sessionId);
        if (session) {
          await session.destroy();
          workerSessions.delete(msg.sessionId);
          console.log(`[Worker] Destroyed session ${msg.sessionId.slice(0, 8)}... (${workerSessions.size} remaining)`);
        }
        break;
      }

      case 'session_input': {
        const session = workerSessions.get(msg.sessionId);
        if (session) {
          session.handleInput(Buffer.from(msg.data));
        }
        break;
      }

      case 'session_resize': {
        const session = workerSessions.get(msg.sessionId);
        if (session) {
          session.resize(msg.cols, msg.rows);
        }
        break;
      }

      case 'session_keyframe': {
        workerSessions.get(msg.sessionId)?.requestKeyframe();
        break;
      }

      case 'get_all_session_states': {
        const states: SessionState[] = [];
        for (const session of workerSessions.values()) {
          states.push(session.getState());
        }
        console.log(`[Worker] Reporting ${states.length} session states for hot reload`);
        send({ type: 'all_session_states', requestId: msg.requestId, states });
        break;
      }

      case 'get_worker_runtime': {
        const memory = process.memoryUsage();
        const heap = getHeapStatistics();
        const eventLoopUtilization = performance.eventLoopUtilization(
          lastWorkerEventLoopUtilization,
        );
        const mib = 1024 * 1024;
        send({
          type: 'worker_runtime',
          requestId: msg.requestId,
          runtime: {
            pid: process.pid,
            sessions: workerSessions.size,
            memory: {
              rss_mib: Number((memory.rss / mib).toFixed(3)),
              heap_used_mib: Number((memory.heapUsed / mib).toFixed(3)),
              heap_total_mib: Number((memory.heapTotal / mib).toFixed(3)),
              heap_limit_mib: Number((heap.heap_size_limit / mib).toFixed(3)),
              external_mib: Number((memory.external / mib).toFixed(3)),
              array_buffers_mib: Number((memory.arrayBuffers / mib).toFixed(3)),
            },
            event_loop: {
              utilization: runtimeMetric(eventLoopUtilization.utilization),
              delay_p50_ms: delayMilliseconds(workerEventLoopDelay.percentile(50)),
              delay_p95_ms: delayMilliseconds(workerEventLoopDelay.percentile(95)),
              delay_p99_ms: delayMilliseconds(workerEventLoopDelay.percentile(99)),
              delay_max_ms: delayMilliseconds(workerEventLoopDelay.max),
            },
            prewarm: regionalPrewarmService?.getStats() ?? null,
            session_stats: [...workerSessions.values()].map((session) => session.getRuntimeStats()),
          },
        });
        lastWorkerEventLoopUtilization = performance.eventLoopUtilization();
        workerEventLoopDelay.reset();
        break;
      }

      case 'shutdown': {
        await shutdownWorker('ipc');
        break;
      }
    }
  } catch (error) {
    console.error('[Worker] Error processing message:', error);
    send({
      type: 'error',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('[Worker] Uncaught exception:', error);
  send({ type: 'error', message: error.message });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[Worker] Unhandled rejection:', reason);
  send({
    type: 'error',
    message: reason instanceof Error ? reason.message : 'Unhandled rejection',
  });
});

// systemd's default KillMode signals the parent and worker together. The
// worker therefore owns its final durable checkpoint instead of depending on
// a parent IPC request that may never arrive.
process.on('SIGTERM', () => {
  void shutdownWorker('SIGTERM').catch((error) => {
    console.error('[Worker] Graceful SIGTERM checkpoint failed:', error);
    process.exit(1);
  });
});

console.log('[Worker] Game worker process started');
