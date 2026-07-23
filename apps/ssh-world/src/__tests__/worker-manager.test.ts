import { describe, expect, it, vi } from 'vitest';
import { WorkerManager } from '../server/worker-manager.js';

interface WorkerManagerInternals {
  workerReady: boolean;
  worker: { connected: boolean } | null;
  reloadState: 'running' | 'reloading';
  sendRequest: ReturnType<typeof vi.fn>;
  getAllSessionStates(): Promise<Array<{ sessionId: string; playerX: number; playerY: number }>>;
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
});
