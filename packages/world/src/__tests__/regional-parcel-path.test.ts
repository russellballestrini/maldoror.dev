import { describe, expect, it } from 'vitest';
import {
  buildRegionalParcelPath,
  distanceToRegionalParcelPath,
  rasterizeRegionalParcelPath,
  sampleRegionalParcelPath,
} from '../tiles/regional-parcel-path.js';

describe('regional parcel path', () => {
  it('builds a deterministic curved spine from a route-relative frame', () => {
    const config = {
      id: 'parcel:4:-3',
      startX: 12.5,
      startY: -8.5,
      tangentX: 0.92,
      tangentY: 0.38,
      outwardSign: 1 as const,
      length: 19,
      lateralOffset: 4.5,
    };
    const first = buildRegionalParcelPath(config);
    const second = buildRegionalParcelPath(config);
    expect(first).toEqual(second);
    expect(first.points[0]).toEqual({ x: 12.5, y: -8.5 });
    expect(first.arcLength).toBeGreaterThanOrEqual(19);
    const middle = sampleRegionalParcelPath(first, first.arcLength / 2);
    const end = sampleRegionalParcelPath(first, first.arcLength);
    expect(Math.hypot(middle.tangentX, middle.tangentY)).toBeCloseTo(1, 8);
    expect(Math.hypot(end.x - first.points[0]!.x, end.y - first.points[0]!.y))
      .toBeGreaterThan(18);
    expect(Math.abs(end.x - first.points.at(-1)!.x)).toBeLessThan(1e-8);
    expect(Math.abs(end.y - first.points.at(-1)!.y)).toBeLessThan(1e-8);

    const contourFollower = buildRegionalParcelPath({ ...config, lateralOffset: 99 });
    expect(contourFollower.lateralOffset).toBeCloseTo(19 * 0.78, 8);
    expect(contourFollower.arcLength).toBeGreaterThan(first.arcLength);
  });

  it('rasterizes one contiguous protected corridor without clipping render coverage', () => {
    const path = buildRegionalParcelPath({
      id: 'parcel:0:0',
      startX: 0.5,
      startY: 0.5,
      tangentX: 1,
      tangentY: 0,
      outwardSign: 1,
      length: 18,
      lateralOffset: 4,
    });
    const cells = rasterizeRegionalParcelPath(path);
    const core = cells.filter((cell) => cell.core);
    const protectedCells = cells.filter((cell) => cell.protected);
    expect(core.length).toBeGreaterThan(12);
    expect(protectedCells.length).toBeGreaterThanOrEqual(core.length);
    expect(cells.length).toBeGreaterThan(protectedCells.length);
    expect(cells.every((cell) => Number.isFinite(cell.distance))).toBe(true);
    for (const cell of core) {
      expect(distanceToRegionalParcelPath(cell.x + 0.5, cell.y + 0.5, path))
        .toBeCloseTo(cell.distance, 10);
      expect(core.some((other) => other !== cell && (
        Math.abs(other.x - cell.x) <= 1 && Math.abs(other.y - cell.y) <= 1
      ))).toBe(true);
    }
    const start = core.reduce((best, cell) => cell.y < best.y ? cell : best, core[0]!);
    const visited = new Set([`${start.x},${start.y}`]);
    const queue = [start];
    while (queue.length > 0) {
      const cell = queue.shift()!;
      for (const candidate of core) {
        const key = `${candidate.x},${candidate.y}`;
        if (visited.has(key) || Math.abs(candidate.x - cell.x) > 1 ||
            Math.abs(candidate.y - cell.y) > 1) continue;
        visited.add(key);
        queue.push(candidate);
      }
    }
    expect(visited.size).toBe(core.length);
  });
});
