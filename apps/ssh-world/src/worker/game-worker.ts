/**
 * Game Worker - Child process that runs game logic
 *
 * This process can be killed and respawned during hot reload
 * while the main process maintains SSH connections.
 */

import { GameServer } from '../game/game-server.js';
import type { PlayerInput } from '@maldoror/protocol';

// Message types for IPC
export interface WorkerInitMessage {
  type: 'init';
  worldSeed: string; // BigInt serialized as string
  tickRate: number;
  chunkCacheSize: number;
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

export type MainToWorkerMessage =
  | WorkerInitMessage
  | PlayerConnectMessage
  | PlayerDisconnectMessage
  | PlayerInputMessage
  | UpdatePositionMessage
  | GetVisiblePlayersMessage
  | GetAllPlayersMessage
  | BroadcastSpriteReloadMessage
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

export type WorkerToMainMessage =
  | WorkerReadyMessage
  | VisiblePlayersResponse
  | AllPlayersResponse
  | SpriteReloadBroadcast
  | WorkerErrorMessage;

let gameServer: GameServer | null = null;

function send(message: WorkerToMainMessage): void {
  if (process.send) {
    process.send(message);
  }
}

process.on('message', async (msg: MainToWorkerMessage) => {
  try {
    switch (msg.type) {
      case 'init': {
        gameServer = new GameServer({
          worldSeed: BigInt(msg.worldSeed),
          tickRate: msg.tickRate,
          chunkCacheSize: msg.chunkCacheSize,
        });

        // Set up sprite reload callback to forward to main process
        gameServer.setGlobalSpriteReloadCallback((userId: string) => {
          send({ type: 'sprite_reload', userId });
        });

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

      case 'shutdown': {
        console.log('[Worker] Shutdown requested');
        if (gameServer) {
          gameServer.stop();
        }
        process.exit(0);
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

console.log('[Worker] Game worker process started');
