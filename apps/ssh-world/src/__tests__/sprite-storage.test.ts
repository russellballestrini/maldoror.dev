import { beforeEach, describe, expect, it, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  select: vi.fn(),
  from: vi.fn(),
  where: vi.fn(),
}));

vi.mock('@maldoror/db', () => ({
  db: {
    select: dbMocks.select,
  },
  schema: {
    spriteFrames: {
      userId: {},
    },
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  eq: vi.fn(() => ({})),
}));

import { loadSpriteFromDisk } from '../utils/sprite-storage.js';

describe('runtime sprite cache', () => {
  beforeEach(() => {
    dbMocks.where.mockReset();
    dbMocks.from.mockReset();
    dbMocks.select.mockReset();
    dbMocks.where.mockResolvedValue([]);
    dbMocks.from.mockReturnValue({ where: dbMocks.where });
    dbMocks.select.mockReturnValue({ from: dbMocks.from });
  });

  it('coalesces and retains a bounded negative lookup for placeholder players', async () => {
    const userId = `missing-sprite-${Date.now()}`;

    await expect(Promise.all([
      loadSpriteFromDisk(userId),
      loadSpriteFromDisk(userId),
      loadSpriteFromDisk(userId),
    ])).resolves.toEqual([null, null, null]);
    await expect(loadSpriteFromDisk(userId)).resolves.toBeNull();

    expect(dbMocks.select).toHaveBeenCalledTimes(1);
    expect(dbMocks.where).toHaveBeenCalledTimes(1);
  });
});
