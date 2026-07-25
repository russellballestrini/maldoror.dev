import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const persistence = vi.hoisted(() => {
  const selectResults: unknown[][] = [];
  const updates: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const db = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: async () => selectResults.shift() ?? [],
        }),
      }),
    })),
    update: vi.fn((table: unknown) => ({
      set: (values: Record<string, unknown>) => {
        updates.push({ table, values });
        return { where: async () => undefined };
      },
    })),
    insert: vi.fn((table: unknown) => ({
      values: async (values: Record<string, unknown>) => {
        inserts.push({ table, values });
      },
    })),
  };
  return { db, inserts, selectResults, updates };
});

const fakeSchema = vi.hoisted(() => ({
  agentTokens: { id: {}, tokenHash: {}, userId: {}, expiresAt: {}, revokedAt: {} },
  users: { id: {}, username: {} },
  playerState: {
    userId: {}, x: {}, y: {}, direction: {}, animationFrame: {}, isOnline: {},
    lastSeenAt: {}, updatedAt: {},
  },
}));

vi.mock('@maldoror/db', () => ({ db: persistence.db, schema: fakeSchema }));
vi.mock('drizzle-orm', () => ({
  and: (...values: unknown[]) => values,
  eq: (...values: unknown[]) => values,
  isNull: (value: unknown) => value,
}));
vi.mock('../server/stats-server.js', () => ({
  addBotActivity: vi.fn(),
  addChatMessage: vi.fn(),
}));

import { AgentSession } from '../server/agent-session.js';

describe('AgentSession login origin', () => {
  beforeEach(() => {
    persistence.selectResults.length = 0;
    persistence.updates.length = 0;
    persistence.inserts.length = 0;
    vi.clearAllMocks();
  });

  it('resets a returning agent to 0,0 before exposing it to the worker', async () => {
    persistence.selectResults.push(
      [{ id: 'token-id', userId: 'user-id', expiresAt: null, revokedAt: null }],
      [{ id: 'user-id', username: 'stored-name' }],
      [{ direction: 'left' }],
    );
    const ws = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
      close: vi.fn(),
    });
    const workerManager = {
      playerConnect: vi.fn(async () => undefined),
      updatePlayerPosition: vi.fn(),
      playerDisconnect: vi.fn(async () => undefined),
    };
    const session = new AgentSession({
      ws: ws as never,
      workerManager: workerManager as never,
      observationIntervalMs: 1000,
    });

    await (session as unknown as {
      handleAuthenticate(
        payload: { token: string; agentName: string },
        requestId?: string,
      ): Promise<void>;
    }).handleAuthenticate({ token: `mat_${'a'.repeat(40)}`, agentName: 'fresh-agent' }, 'request-1');

    const playerUpdate = persistence.updates.find((entry) => entry.table === fakeSchema.playerState);
    expect(playerUpdate?.values).toMatchObject({
      x: 0,
      y: 0,
      animationFrame: 0,
      isOnline: true,
    });
    expect(workerManager.playerConnect).toHaveBeenCalledWith(
      'user-id',
      'agent-user-id',
      'fresh-agent',
    );
    expect(workerManager.updatePlayerPosition).toHaveBeenCalledWith('user-id', 0, 0);
    expect(JSON.parse(ws.send.mock.calls.at(-1)?.[0] as string)).toMatchObject({
      type: 'authenticated',
      payload: { success: true, userId: 'user-id', username: 'fresh-agent' },
    });
  });
});
