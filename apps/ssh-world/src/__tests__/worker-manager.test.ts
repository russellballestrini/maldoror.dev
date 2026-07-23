import { describe, expect, it, vi } from 'vitest';
import { WorkerManager } from '../server/worker-manager.js';

interface WorkerManagerInternals {
  workerReady: boolean;
  worker: { connected: boolean } | null;
  reloadState: 'running' | 'reloading';
  sendRequest: ReturnType<typeof vi.fn>;
  getAllSessionStates(): Promise<Array<{ sessionId: string; playerX: number; playerY: number }>>;
}

interface HotReloadInternals {
  workerReady: boolean;
  worker: { connected: boolean; kill: ReturnType<typeof vi.fn> } | null;
  workerSessions: Map<string, {
    sessionId: string;
    fingerprint: string;
    username: string;
    userId: string;
    cols: number;
    rows: number;
  }>;
  connectedSessions: Map<string, {
    userId: string;
    sessionId: string;
    username: string;
  }>;
  getAllSessionStates: ReturnType<typeof vi.fn>;
  flushNPCState: ReturnType<typeof vi.fn>;
  spawnWorker: ReturnType<typeof vi.fn>;
  sendToWorker: ReturnType<typeof vi.fn>;
  hotReload(): Promise<void>;
}

function managerInternals(): WorkerManagerInternals {
  const manager = new WorkerManager({
    worldSeed: 42n,
    tickRate: 15,
    chunkCacheSize: 16,
    providerConfig: {} as ConstructorParameters<typeof WorkerManager>[0]['providerConfig'],
  });
  return manager as unknown as WorkerManagerInternals;
}

describe('WorkerManager hot-reload state capture', () => {
  it('requests live session state after public admission enters reloading', async () => {
    const manager = managerInternals();
    const expected = [{ sessionId: 'session-1', playerX: 7, playerY: -3 }];
    manager.workerReady = true;
    manager.worker = { connected: true };
    manager.reloadState = 'reloading';
    manager.sendRequest = vi.fn().mockResolvedValue(expected);

    await expect(manager.getAllSessionStates()).resolves.toEqual(expected);
    expect(manager.sendRequest).toHaveBeenCalledOnce();
  });

  it('does not request state from a missing worker channel', async () => {
    const manager = managerInternals();
    manager.workerReady = true;
    manager.worker = null;
    manager.reloadState = 'reloading';
    manager.sendRequest = vi.fn();

    await expect(manager.getAllSessionStates()).resolves.toEqual([]);
    expect(manager.sendRequest).not.toHaveBeenCalled();
  });

  it('re-registers the same session with its captured position and view', async () => {
    const manager = managerInternals() as unknown as HotReloadInternals;
    const kill = vi.fn();
    manager.workerReady = true;
    manager.worker = { connected: true, kill };
    manager.connectedSessions = new Map();
    manager.workerSessions = new Map([
      ['session-1', {
        sessionId: 'session-1',
        fingerprint: 'fingerprint-1',
        username: 'walker',
        userId: 'user-1',
        cols: 160,
        rows: 46,
      }],
    ]);
    manager.getAllSessionStates = vi.fn().mockResolvedValue([{
      sessionId: 'session-1',
      playerX: 5,
      playerY: -2,
      zoomLevel: 0.5,
      renderMode: 'octant',
      cameraMode: 'follow',
    }]);
    manager.flushNPCState = vi.fn().mockResolvedValue(undefined);
    manager.spawnWorker = vi.fn().mockResolvedValue(undefined);
    manager.sendToWorker = vi.fn();

    await manager.hotReload();

    expect(kill).toHaveBeenCalledWith('SIGTERM');
    expect(manager.flushNPCState).toHaveBeenCalledOnce();
    expect(manager.sendToWorker).toHaveBeenCalledWith(expect.objectContaining({
      type: 'create_session',
      sessionId: 'session-1',
      restoredState: {
        sessionId: 'session-1',
        playerX: 5,
        playerY: -2,
        zoomLevel: 0.5,
        renderMode: 'octant',
        cameraMode: 'follow',
      },
    }));
  });

  it('does not replace the worker when the NPC checkpoint fails', async () => {
    const manager = managerInternals() as unknown as HotReloadInternals;
    const kill = vi.fn();
    manager.workerReady = true;
    manager.worker = { connected: true, kill };
    manager.connectedSessions = new Map();
    manager.workerSessions = new Map();
    manager.getAllSessionStates = vi.fn().mockResolvedValue([]);
    manager.flushNPCState = vi.fn().mockRejectedValue(new Error('database unavailable'));
    manager.spawnWorker = vi.fn().mockResolvedValue(undefined);
    manager.sendToWorker = vi.fn();

    await expect(manager.hotReload()).rejects.toThrow(
      'Hot reload aborted because NPC state was not durable'
    );
    expect(kill).not.toHaveBeenCalled();
    expect(manager.spawnWorker).not.toHaveBeenCalled();
  });
});
