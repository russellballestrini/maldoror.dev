import { describe, expect, it } from 'vitest';
import {
  REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE,
  regionalStreetPairCandidatesConflict,
  regionalStreetPairOwnershipCell,
  selectRegionalCanonicalStreetPairs,
  type RegionalStreetPairCandidate,
} from '../tiles/regional-street-pair-admission.js';

function candidate(
  id: string,
  config: Partial<RegionalStreetPairCandidate> = {},
): RegionalStreetPairCandidate {
  return {
    id,
    ownerSiteX: 12,
    ownerSiteY: 18,
    kind: 'replacement',
    priority: 0.5,
    reservedCells: [`${id}:cell`],
    visualGroups: [`${id}:group`],
    ...config,
  };
}

describe('regional canonical street-pair admission', () => {
  it('uses fixed world ownership rather than runtime provider blocks', () => {
    expect(REGIONAL_STREET_PAIR_OWNERSHIP_CELL_SIZE).toBe(64);
    expect(regionalStreetPairOwnershipCell(-1, 64)).toEqual({
      cellX: -1,
      cellY: 1,
      minX: -64,
      minY: 64,
      maxX: -1,
      maxY: 127,
    });
    expect(regionalStreetPairOwnershipCell(63.9, -0.1)).toEqual({
      cellX: 0,
      cellY: -1,
      minX: 0,
      minY: -64,
      maxX: 63,
      maxY: -1,
    });
  });

  it('selects the same complete candidates in every traversal order', () => {
    const values = [
      candidate('a', { priority: 0.9, reservedCells: ['0,0'] }),
      candidate('b', { priority: 0.2, reservedCells: ['0,0'] }),
      candidate('c', { priority: 0.4, reservedCells: ['8,8'] }),
    ];
    const signature = (input: RegionalStreetPairCandidate[]) => (
      selectRegionalCanonicalStreetPairs(input).map((value) => value.id)
    );
    expect(signature(values)).toEqual(['a', 'c']);
    expect(signature([...values].reverse())).toEqual(['a', 'c']);
    expect(signature([values[1]!, values[2]!, values[0]!])).toEqual(['a', 'c']);
  });

  it('gives an established strict pair precedence over replacement detail', () => {
    const strict = candidate('strict', {
      kind: 'strict',
      priority: 0.01,
      reservedCells: ['4,5'],
    });
    const replacement = candidate('replacement', {
      kind: 'replacement',
      priority: 0.99,
      reservedCells: ['4,5'],
    });
    expect(selectRegionalCanonicalStreetPairs([replacement, strict]).map((value) => value.id))
      .toEqual(['strict']);
  });

  it('uses conservative one-pass suppression rather than an order-dependent fixpoint', () => {
    const highest = candidate('highest', {
      priority: 0.9,
      reservedCells: ['0,0'],
    });
    const middle = candidate('middle', {
      priority: 0.6,
      reservedCells: ['0,0', '1,0'],
    });
    const lowest = candidate('lowest', {
      priority: 0.3,
      reservedCells: ['1,0'],
    });
    expect(selectRegionalCanonicalStreetPairs([lowest, middle, highest]).map((value) => value.id))
      .toEqual(['highest']);
  });

  it('treats repeated owning-place visual groups as conflicts without geometric overlap', () => {
    const barnStreet = candidate('barn-street', {
      reservedCells: ['1,1'],
      visualGroups: ['rural-stone-barn-v1', 'rural-awning-v1'],
      priority: 0.8,
    });
    const barnCommon = candidate('barn-common', {
      kind: 'strict',
      reservedCells: ['40,40'],
      visualGroups: ['rural-stone-barn-v1'],
      priority: 0.1,
    });
    expect(regionalStreetPairCandidatesConflict(barnStreet, barnCommon)).toBe(true);
    expect(selectRegionalCanonicalStreetPairs([barnStreet, barnCommon]).map((value) => value.id))
      .toEqual(['barn-common']);
  });

  it('allows the same visual group at different owning places when footprints do not meet', () => {
    const first = candidate('first', {
      ownerSiteX: 0,
      ownerSiteY: 0,
      reservedCells: ['0,0'],
      visualGroups: ['shelter'],
    });
    const second = candidate('second', {
      ownerSiteX: 96,
      ownerSiteY: 0,
      reservedCells: ['96,0'],
      visualGroups: ['shelter'],
    });
    expect(regionalStreetPairCandidatesConflict(first, second)).toBe(false);
    expect(selectRegionalCanonicalStreetPairs([second, first]).map((value) => value.id))
      .toEqual(['first', 'second']);
  });

  it('uses identity as a deterministic tie break and rejects invalid inputs', () => {
    const first = candidate('a', { reservedCells: ['2,2'], priority: 0.5 });
    const second = candidate('b', { reservedCells: ['2,2'], priority: 0.5 });
    expect(selectRegionalCanonicalStreetPairs([second, first]).map((value) => value.id))
      .toEqual(['a']);
    expect(() => selectRegionalCanonicalStreetPairs([first, first]))
      .toThrow('Duplicate street-pair candidate');
    expect(() => selectRegionalCanonicalStreetPairs([
      candidate('invalid', { priority: Number.NaN }),
    ])).toThrow('Invalid street-pair priority');
  });
});
