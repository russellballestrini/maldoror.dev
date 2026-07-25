import { describe, expect, it } from 'vitest';
import {
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
} from '../biomes/biome-world-field.js';
import {
  buildRegionalQuayLayout,
  regionalQuayCellIsWalkable,
  sampleRegionalQuayLayout,
} from '../tiles/regional-quay-layout.js';

const WORLD_SEED = 8_801_799_478_018_485n;

function makeFixture() {
  const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 8 });
  const waterway = field.getConstructedWaterways()[0]!;
  const layout = buildRegionalQuayLayout({ id: 'quay:test', waterway });
  const sample = (x: number, y: number) => sampleRegionalQuayLayout(
    field.sampleConstructedWaterway(x, y, waterway.id),
    layout,
  );
  return { field, layout, sample };
}

describe('regional quay layout', () => {
  it('creates two dry continuous circulation bands without paving water or spawn', () => {
    const { sample } = makeFixture();
    expect(sample(0, -2).quayWeight).toBeGreaterThan(0.8);
    expect(sample(0, -8).quayWeight).toBeGreaterThan(0.55);
    expect(sample(0, -5).quayWeight).toBe(0);
    expect(sample(0, 0).quayWeight).toBe(0);
    expect(sample(0, 0).frontageReserveWeight).toBeGreaterThan(0.4);
    expect(sample(0, -2).bankSide).toBe(1);
    expect(sample(0, -8).bankSide).toBe(-1);
  });

  it('uses the waterway progress envelope instead of extending as an infinite stripe', () => {
    const { sample } = makeFixture();
    expect(sample(-20, -3.5).quayWeight).toBeGreaterThan(0.2);
    expect(sample(26, -4.8).quayWeight).toBeGreaterThan(0.2);
    expect(sample(-27.5, -7).quayWeight).toBe(0);
    expect(sample(41.5, -9).quayWeight).toBe(0);
  });

  it('conservatively protects visibly covered quay cells for physical traversal', () => {
    const { field, layout } = makeFixture();
    const sampleWaterway = (x: number, y: number, id: string) => (
      field.sampleConstructedWaterway(x, y, id)
    );
    expect(regionalQuayCellIsWalkable(0, -2, layout, sampleWaterway)).toBe(true);
    expect(regionalQuayCellIsWalkable(0, -8, layout, sampleWaterway)).toBe(true);
    expect(regionalQuayCellIsWalkable(0, -5, layout, sampleWaterway)).toBe(false);
    expect(regionalQuayCellIsWalkable(0, 0, layout, sampleWaterway)).toBe(false);
  });

  it('projects bilateral walkable quays from both selected civic canals', () => {
    const field = new BiomeWorldField(WORLD_SEED, {
      blockSize: 16,
      maxCachedBlocks: 8,
      arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
    });
    const layouts = new Map(field.getConstructedWaterways().slice(1).map((waterway) => [
      waterway.id,
      buildRegionalQuayLayout({ id: `quay:${waterway.id}`, waterway }),
    ]));
    const isWalkable = (x: number, y: number, waterwayId: string) => {
      const layout = layouts.get(waterwayId)!;
      return regionalQuayCellIsWalkable(
        x,
        y,
        layout,
        (sampleX, sampleY, id) => field.sampleConstructedWaterway(sampleX, sampleY, id),
      );
    };

    expect([...layouts.keys()]).toEqual(['arrival-civic-west', 'arrival-civic-east']);
    expect(isWalkable(-9, 4, 'arrival-civic-west')).toBe(true);
    expect(isWalkable(-5, 4, 'arrival-civic-west')).toBe(true);
    expect(isWalkable(-7, 4, 'arrival-civic-west')).toBe(false);
    expect(isWalkable(5, 4, 'arrival-civic-east')).toBe(true);
    expect(isWalkable(9, 4, 'arrival-civic-east')).toBe(true);
    expect(isWalkable(7, 4, 'arrival-civic-east')).toBe(false);
  });
});
