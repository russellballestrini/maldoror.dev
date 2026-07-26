import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedNPCRecord, NPCRuntimeSnapshot } from '../utils/npc-storage.js';

const storage = vi.hoisted(() => ({
  loadAllNPCs: vi.fn(),
  loadNPCSpriteFromDisk: vi.fn(),
  createNPC: vi.fn(),
  loadWorldLifeState: vi.fn(),
  loadNPCRelationshipFamiliarities: vi.fn(),
  persistNPCRuntimeStates: vi.fn(),
}));

vi.mock('../utils/npc-storage.js', () => storage);

import { NPCManager } from '../game/npc-manager.js';

const record: LoadedNPCRecord = {
  id: 'npc-persistent-1',
  creatorId: 'creator-1',
  name: 'Canal Keeper',
  prompt: 'a keeper beside the canal',
  spawnX: 4,
  spawnY: -3,
  roamRadius: 15,
  playerAffinity: 50,
  modelUsed: 'subscription-imagegen',
  createdAt: new Date('2026-07-23T00:00:00Z'),
  persistedX: 7,
  persistedY: -2,
  persistedDirection: 'left',
  persistedAnimationFrame: 2,
  motorState: {
    targetX: 5,
    targetY: -2,
    ticksUntilNextDecision: 321,
    behaviorState: 'wandering',
    rngState: 123456789,
    isMoving: true,
    movementTicksRemaining: 0,
  },
  lifeState: null,
};

describe('NPCManager persistent body state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.loadAllNPCs.mockResolvedValue([record]);
    storage.loadWorldLifeState.mockResolvedValue(null);
    storage.loadNPCRelationshipFamiliarities.mockResolvedValue([]);
    storage.loadNPCSpriteFromDisk.mockResolvedValue(null);
    storage.persistNPCRuntimeStates.mockResolvedValue(undefined);
  });

  it('restores the complete persisted motor snapshot instead of the spawn point', async () => {
    const manager = new NPCManager();
    await manager.loadFromDB();

    expect(manager.getNPC(record.id)).toMatchObject({
      x: 7,
      y: -2,
      direction: 'left',
      animationFrame: 2,
      isMoving: true,
      targetX: 5,
      targetY: -2,
      ticksUntilNextDecision: 321,
      behaviorState: 'wandering',
      rngState: 123456789,
    });
  });

  it('checkpoints a cognitive move and resumes the exact resulting state', async () => {
    const first = new NPCManager();
    await first.loadFromDB();

    expect(first.moveNPC(record.id, 'down')).toMatchObject({ x: 7, y: -1, direction: 'down' });
    await first.flushRuntimeState();

    const snapshots = storage.persistNPCRuntimeStates.mock.calls[0]![0] as NPCRuntimeSnapshot[];
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      npcId: record.id,
      x: 7,
      y: -1,
      direction: 'down',
      motorState: {
        targetX: null,
        targetY: null,
        behaviorState: 'idle',
        isMoving: true,
        movementTicksRemaining: 3,
      },
    });

    storage.loadAllNPCs.mockResolvedValueOnce([{
      ...record,
      persistedX: snapshots[0]!.x,
      persistedY: snapshots[0]!.y,
      persistedDirection: snapshots[0]!.direction,
      persistedAnimationFrame: snapshots[0]!.animationFrame,
      motorState: snapshots[0]!.motorState,
      lifeState: snapshots[0]!.lifeState ?? null,
    }]);

    const restarted = new NPCManager();
    await restarted.loadFromDB();
    expect(restarted.getNPC(record.id)).toMatchObject({
      x: 7,
      y: -1,
      direction: 'down',
      targetX: null,
      targetY: null,
      ticksUntilNextDecision: snapshots[0]!.motorState.ticksUntilNextDecision,
      rngState: snapshots[0]!.motorState.rngState,
    });
  });

  it('keeps a blocked cognitive move in place and persists the failed intent', async () => {
    const manager = new NPCManager();
    manager.setCollisionChecker((x, y) => x === 8 && y === -2);
    await manager.loadFromDB();

    expect(manager.moveNPC(record.id, 'right')).toMatchObject({
      x: 7,
      y: -2,
      direction: 'right',
      isMoving: false,
    });
    await manager.flushRuntimeState();

    expect(storage.persistNPCRuntimeStates.mock.calls[0]![0]).toEqual([
      expect.objectContaining({ x: 7, y: -2, direction: 'right' }),
    ]);
  });

  it('caches one bounded detour while a persisted intent crosses authored collision', async () => {
    storage.loadAllNPCs.mockResolvedValueOnce([{
      ...record,
      spawnX: 0,
      spawnY: 0,
      roamRadius: 5,
      persistedX: 0,
      persistedY: 0,
      motorState: {
        ...record.motorState!,
        targetX: 2,
        targetY: 0,
        ticksUntilNextDecision: 1000,
      },
    }]);
    const collision = vi.fn((x: number, y: number) => (
      x === 1 && y >= -1 && y <= 1
    ));
    const manager = new NPCManager({ tickRate: 1000 });
    manager.setCollisionChecker(collision);
    await manager.loadFromDB();

    for (let tick = 0; tick < 4; tick++) manager.tickAll([]);
    const searchCollisionChecks = collision.mock.calls.length;
    for (let tick = 4; tick < 24; tick++) manager.tickAll([]);

    expect(manager.getNPC(record.id)).toMatchObject({ x: 2, y: 0, targetX: null, targetY: null });
    expect(searchCollisionChecks).toBeGreaterThan(20);
    expect(collision.mock.calls.length - searchCollisionChecks).toBeLessThan(10);
  });

  it('advances and atomically checkpoints world time, inhabitant needs, and audit facts', async () => {
    storage.loadWorldLifeState.mockResolvedValueOnce({
      worldId: 'primary',
      worldSeed: '42',
      worldMinute: 719,
      weather: 'clear',
      weatherIntensity: 0.1,
      weatherUntilWorldMinute: 720,
      season: 'spring',
      rngState: 123456,
      surfaceWetness: 0.2,
      waterTurbulence: 0.1,
      vegetationVitality: 0.72,
      decayPressure: 0.1,
    });
    const manager = new NPCManager({ worldSeed: '42', tickRate: 3 });
    await manager.loadFromDB();

    manager.tickAll([]);
    manager.tickAll([]);
    manager.tickAll([]);
    await manager.flushRuntimeState();

    const finalCall = storage.persistNPCRuntimeStates.mock.calls.at(-1)!;
    const snapshots = finalCall[0] as NPCRuntimeSnapshot[];
    expect(finalCall[1]).toMatchObject({ worldMinute: 720, worldSeed: '42' });
    expect(snapshots[0]!.lifeState).toMatchObject({
      npcId: record.id,
      lastWorldMinute: 720,
      stateVersion: 2,
    });
    expect(finalCall[2]).toContainEqual(expect.objectContaining({
      eventType: 'weather_changed',
      worldMinute: 720,
    }));
    expect(manager.getAllNPCs()[0]).toEqual(expect.objectContaining({
      role: expect.any(String),
      activity: expect.any(String),
      primaryNeed: expect.any(String),
    }));
  });
});
