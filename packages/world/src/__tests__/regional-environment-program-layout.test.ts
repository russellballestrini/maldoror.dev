import { describe, expect, it } from 'vitest';
import {
  buildRegionalEnvironmentProgramLayout,
  rasterizeRegionalEnvironmentProgramLayout,
  sampleRegionalEnvironmentProgramLayout,
} from '../tiles/regional-environment-program-layout.js';

const dryTerrain = (x: number, _y: number) => ({
  elevation: 0.48 + x * 0.01,
  slope: 0.02,
  isWater: false,
});

describe('regional environment program layout', () => {
  it('builds a connected entrance, tunnel graph, chambers, and solid rock boundary', () => {
    const layout = buildRegionalEnvironmentProgramLayout({
      id: 'environment:test-cave',
      kind: 'cave-interior',
      routePoint: { x: 0, y: 0 },
      anchorPoint: { x: 4, y: 0 },
      seed: 42,
      sampleTerrain: dryTerrain,
    })!;
    expect(layout.kind).toBe('cave-interior');
    expect(layout.interiorPaths).toHaveLength(2);
    expect(layout.chambers).toHaveLength(2);
    expect(layout.traversableLength).toBeGreaterThan(layout.directDistance);
    const entry = sampleRegionalEnvironmentProgramLayout(4.5, 0, layout);
    const mainChamber = sampleRegionalEnvironmentProgramLayout(
      layout.chambers[0]!.centre.x,
      layout.chambers[0]!.centre.y,
      layout,
    );
    expect(Math.max(entry.accessTrailWeight, entry.caveFloorWeight)).toBeGreaterThan(0.1);
    expect(mainChamber.caveFloorWeight).toBeGreaterThan(0.9);
    const cells = rasterizeRegionalEnvironmentProgramLayout(layout);
    expect(cells.some((cell) => cell.walkable && cell.roles.includes('cave-floor'))).toBe(true);
    expect(cells.some((cell) => cell.solid && cell.roles.includes('cave-wall'))).toBe(true);
    expect(walkableCellsConnected(cells)).toBe(true);
  });

  it('selects a higher endpoint and lengthens the ascent with a few long switchbacks', () => {
    const layout = buildRegionalEnvironmentProgramLayout({
      id: 'environment:test-highland',
      kind: 'highland-ascent',
      routePoint: { x: 0, y: 0 },
      anchorPoint: { x: 4, y: 0 },
      seed: 73,
      sampleTerrain: dryTerrain,
      maximumReach: 18,
    })!;
    expect(layout.kind).toBe('highland-ascent');
    expect(layout.elevationGain).toBeGreaterThan(0.1);
    expect(layout.switchbackCount).toBe(3);
    expect(layout.traversableLength).toBeGreaterThan(layout.directDistance * 1.08);
    expect(layout.terminalPoint.x).toBeGreaterThan(layout.anchorPoint.x);
    const cells = rasterizeRegionalEnvironmentProgramLayout(layout);
    expect(cells.some((cell) => cell.walkable && cell.roles.includes('highland-trail'))).toBe(true);
    expect(walkableCellsConnected(cells)).toBe(true);
  });

  it('is deterministic and rejects a flooded entrance', () => {
    const config = {
      id: 'environment:stable',
      kind: 'cave-interior' as const,
      routePoint: { x: -2, y: 1 },
      anchorPoint: { x: 3, y: 2 },
      seed: 991,
      sampleTerrain: dryTerrain,
    };
    expect(buildRegionalEnvironmentProgramLayout(config))
      .toEqual(buildRegionalEnvironmentProgramLayout(config));
    expect(buildRegionalEnvironmentProgramLayout({
      ...config,
      sampleTerrain: () => ({ elevation: 0.5, slope: 0.01, isWater: true }),
    })).toBeNull();
  });
});

function walkableCellsConnected(
  cells: ReturnType<typeof rasterizeRegionalEnvironmentProgramLayout>,
): boolean {
  const walkable = new Set(cells.filter((cell) => cell.walkable).map((cell) => `${cell.x},${cell.y}`));
  const first = walkable.values().next().value as string | undefined;
  if (!first) return false;
  const visited = new Set([first]);
  const queue = [first];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const [x, y] = current.split(',').map(Number) as [number, number];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const key = `${x + dx},${y + dy}`;
      if (!walkable.has(key) || visited.has(key)) continue;
      visited.add(key);
      queue.push(key);
    }
  }
  return visited.size === walkable.size;
}
