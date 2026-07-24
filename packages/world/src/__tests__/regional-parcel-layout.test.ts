import { describe, expect, it } from 'vitest';
import {
  buildRegionalParcelLayout,
  rasterizeRegionalParcelLayout,
  sampleRegionalParcelLayout,
} from '../tiles/regional-parcel-layout.js';
import { buildRegionalParcelPath } from '../tiles/regional-parcel-path.js';

function makeLayout(civicOpeningRate = 1) {
  const path = buildRegionalParcelPath({
    id: 'parcel:shared-strip',
    startX: 3.5,
    startY: -4.5,
    tangentX: 0.94,
    tangentY: 0.34,
    outwardSign: 1,
    length: 23,
    lateralOffset: 8,
  });
  return buildRegionalParcelLayout({
    id: 'layout:shared-strip',
    path,
    centerStations: [8, 13, 18],
    seed: 0x71d0c5,
    civicOpeningRate,
  });
}

describe('regional parcel layout', () => {
  it('partitions both path sides with exact shared boundaries and open frontage', () => {
    const layout = makeLayout();
    expect(layout.plots).toHaveLength(6);
    expect(layout.plots.filter((plot) => plot.purpose === 'civic-opening')).toHaveLength(1);
    for (const side of [-1, 1] as const) {
      const plots = layout.plots.filter((plot) => plot.side === side);
      for (let index = 1; index < plots.length; index++) {
        const previous = plots[index - 1]!;
        const current = plots[index]!;
        expect(previous.polygon[1]).toBe(current.polygon[0]);
        expect(previous.polygon[2]).toBe(current.polygon[3]);
      }
      expect(layout.boundaries.filter((boundary) => (
        boundary.side === side && boundary.kind === 'separator'
      ))).toHaveLength(2);
    }
    expect(layout.boundaries.every((boundary) => boundary.kind !== 'separator' || (
      layout.plots.some((plot) => plot.frontage[0] === boundary.start) &&
      layout.plots.some((plot) => plot.polygon[3] === boundary.end)
    ))).toBe(true);
    for (const plot of layout.plots) {
      expect(plot.frontageWidth).toBeGreaterThan(4);
      expect(plot.depth).toBeGreaterThanOrEqual(3.8);
      expect(plot.frontageOpening[0]).not.toEqual(plot.frontageOpening[1]);
    }
  });

  it('is deterministic, non-uniform, bounded, and continuously sampleable', () => {
    const first = makeLayout(0);
    const second = makeLayout(0);
    expect(first).toEqual(second);
    expect(new Set(first.plots.map((plot) => Math.round(plot.depth * 10))).size).toBeGreaterThan(2);
    const cells = rasterizeRegionalParcelLayout(first);
    expect(cells.length).toBeGreaterThan(50);
    expect(cells.every((cell) => (
      cell.x >= Math.floor(first.bounds.minX) && cell.x <= Math.floor(first.bounds.maxX) &&
      cell.y >= Math.floor(first.bounds.minY) && cell.y <= Math.floor(first.bounds.maxY)
    ))).toBe(true);
    const garden = first.plots.find((plot) => plot.purpose === 'garden')!;
    const center = garden.yard.reduce((sum, point) => ({
      x: sum.x + point.x / garden.yard.length,
      y: sum.y + point.y / garden.yard.length,
    }), { x: 0, y: 0 });
    const sample = sampleRegionalParcelLayout(center.x, center.y, first);
    expect(sample.plotId).toBe(garden.id);
    expect(sample.insideWeight).toBeGreaterThan(0.9);
    expect(sample.yardWeight).toBeGreaterThan(0.9);
    expect(sample.boundaryWeight).toBeLessThan(0.1);
  });

  it('accepts numeric local constraints without embedding biome cases', () => {
    const path = buildRegionalParcelPath({
      id: 'parcel:constraint',
      startX: 0.5,
      startY: 0.5,
      tangentX: 1,
      tangentY: 0,
      outwardSign: 1,
      length: 18,
      lateralOffset: 0,
    });
    const layout = buildRegionalParcelLayout({
      id: 'layout:constraint',
      path,
      centerStations: [6, 11],
      seed: 44,
      constrainDepth: ({ side, proposedDepth }) => side < 0 ? 4.1 : proposedDepth,
    });
    expect(layout.plots.filter((plot) => plot.side < 0).every((plot) => (
      Math.abs(plot.depth - 4.1) < 1e-8
    ))).toBe(true);
    expect(layout.plots.filter((plot) => plot.side > 0).some((plot) => plot.depth > 4.1)).toBe(true);
  });
});
