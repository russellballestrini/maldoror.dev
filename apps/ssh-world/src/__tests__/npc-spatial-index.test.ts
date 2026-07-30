import { describe, expect, it } from 'vitest';
import { NPCSpatialIndex } from '../game/npc-spatial-index.js';

interface OracleEntry {
  id: string;
  x: number;
  y: number;
  order: number;
}

const bruteForce = (
  entries: readonly OracleEntry[],
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): string[] => entries
  .filter((entry) => (
    entry.x >= minX && entry.x <= maxX && entry.y >= minY && entry.y <= maxY
  ))
  .sort((left, right) => left.order - right.order)
  .map((entry) => entry.id);

describe('NPCSpatialIndex', () => {
  it('preserves insertion order across negative cells, moves, and adaptive queries', () => {
    const index = new NPCSpatialIndex(16);
    index.upsert('first', -17, -17);
    index.upsert('second', 0, 0);
    index.upsert('third', -1, -1);
    index.upsert('fourth', 16, 16);

    expect(index.query(-17, -17, 0, 0).ids).toEqual(['first', 'second', 'third']);
    index.upsert('first', 15, 15);
    expect(index.query(-1, -1, 16, 16).ids).toEqual(['first', 'second', 'third', 'fourth']);
    index.remove('second');
    index.upsert('second', 0, 0);
    expect(index.query(-1, -1, 16, 16).ids).toEqual(['first', 'third', 'fourth', 'second']);

    const enormous = index.query(-1_000_000, -1_000_000, 1_000_000, 1_000_000);
    expect(enormous.strategy).toBe('occupied');
    expect(enormous.ids).toEqual(['first', 'third', 'fourth', 'second']);
    expect(enormous.visitedBuckets).toBeLessThanOrEqual(4);
  });

  it('matches a brute-force oracle while bounding local candidate visitation', () => {
    const index = new NPCSpatialIndex(16);
    const entries: OracleEntry[] = [];
    let state = 0x6d2b79f5;
    const random = (): number => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return state >>> 0;
    };

    for (let order = 0; order < 2048; order++) {
      const entry = {
        id: `npc-${order}`,
        x: (random() % 8193) - 4096,
        y: (random() % 8193) - 4096,
        order,
      };
      entries.push(entry);
      index.upsert(entry.id, entry.x, entry.y);
    }

    let maximumVisitedCandidates = 0;
    for (let sample = 0; sample < 256; sample++) {
      const centerX = (random() % 8193) - 4096;
      const centerY = (random() % 8193) - 4096;
      const halfWidth = 4 + (random() % 60);
      const halfHeight = 4 + (random() % 40);
      const bounds = {
        minX: centerX - halfWidth,
        minY: centerY - halfHeight,
        maxX: centerX + halfWidth,
        maxY: centerY + halfHeight,
      };
      const actual = index.query(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
      expect(actual.ids).toEqual(bruteForce(
        entries,
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY,
      ));
      maximumVisitedCandidates = Math.max(maximumVisitedCandidates, actual.visitedCandidates);
    }

    expect(maximumVisitedCandidates).toBeLessThan(16);
  });
});
