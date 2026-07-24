import { describe, expect, it } from 'vitest';
import {
  buildRegionalWaterfrontLayout,
  rasterizeRegionalWaterfrontLayout,
  sampleRegionalWaterfrontLayout,
} from '../tiles/regional-waterfront-layout.js';

function makeLayout() {
  return buildRegionalWaterfrontLayout({
    id: 'waterfront:test',
    accessStart: { x: 0.5, y: -12.5 },
    shorePoint: { x: 0.5, y: -0.15 },
    waterNormalX: 0,
    waterNormalY: 1,
    seed: 0x721d,
    isWater: (_x, y) => y >= 0,
  })!;
}

describe('regional waterfront layout', () => {
  it('connects a dry approach to an apron, separate work yards, wet piers, and a protected slip', () => {
    const layout = makeLayout();
    expect(layout.accessPath.points[0]).toEqual({ x: 0.5, y: -12.5 });
    expect(layout.accessPath.points.at(-1)!.y).toBeCloseTo(-0.15, 5);
    expect(layout.workYards).toHaveLength(2);
    expect(layout.piers).toHaveLength(2);
    expect(layout.slips).toHaveLength(1);
    for (const pier of layout.piers) {
      const tip = pier.polygon.reduce((best, point) => point.y > best.y ? point : best);
      expect(tip.y).toBeGreaterThan(4);
      expect(pier.polygon.slice(2).every((point) => point.y >= 0)).toBe(true);
    }
    const slipCentre = layout.slips[0]!.polygon.reduce((sum, point) => ({
      x: sum.x + point.x / 4,
      y: sum.y + point.y / 4,
    }), { x: 0, y: 0 });
    const sample = sampleRegionalWaterfrontLayout(slipCentre.x, slipCentre.y, layout);
    expect(sample.role).toBe('slip');
    expect(sample.slipWeight).toBeGreaterThan(0.9);
    expect(sample.pierWeight).toBe(0);
  });

  it('is deterministic, continuously sampleable, and raster-coverable', () => {
    const first = makeLayout();
    const second = makeLayout();
    expect(first).toEqual(second);
    const cells = rasterizeRegionalWaterfrontLayout(first);
    expect(cells.length).toBeGreaterThan(140);
    expect(cells.some((cell) => cell.roles.includes('apron'))).toBe(true);
    expect(cells.some((cell) => cell.roles.includes('work-yard'))).toBe(true);
    expect(cells.some((cell) => cell.roles.includes('pier'))).toBe(true);
    expect(cells.some((cell) => cell.roles.includes('slip'))).toBe(true);
    const apronSample = sampleRegionalWaterfrontLayout(0.5, -2, first);
    expect(apronSample.apronWeight).toBeGreaterThan(0.9);
    expect(apronSample.edgeWeight).toBeLessThan(0.1);
  });

  it('shortens fingers at physical water obstructions and rejects a dry shore', () => {
    const shortened = buildRegionalWaterfrontLayout({
      id: 'waterfront:short',
      accessStart: { x: 0, y: -10 },
      shorePoint: { x: 0, y: 0 },
      waterNormalX: 0,
      waterNormalY: 1,
      seed: 7,
      maximumPierLength: 8,
      isWater: (_x, y) => y >= 0.25 && y <= 4.25,
    })!;
    expect(shortened.piers.every((pier) => (
      Math.max(...pier.polygon.map((point) => point.y)) <= 4.25
    ))).toBe(true);
    expect(buildRegionalWaterfrontLayout({
      id: 'waterfront:dry',
      accessStart: { x: 0, y: -10 },
      shorePoint: { x: 0, y: 0 },
      waterNormalX: 0,
      waterNormalY: 1,
      seed: 7,
      isWater: () => false,
    })).toBeNull();
  });
});
