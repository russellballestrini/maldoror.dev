import { describe, expect, it } from 'vitest';
import {
  buildRegionalLandmarkFabricLayout,
  rasterizeRegionalLandmarkFabricLayout,
  sampleRegionalLandmarkFabricLayout,
} from '../tiles/regional-landmark-fabric-layout.js';

function makeLayout() {
  return buildRegionalLandmarkFabricLayout({
    id: 'landmark-fabric:arrival',
    materialFamily: 'canal-town',
    siteX: 0.5,
    siteY: 0.5,
    seed: 0x5a71c,
    focals: [
      {
        id: 'left-market',
        frontageAxis: 'north-south',
        compositionSide: -1,
        frontageStations: [0.31],
        minX: -15,
        minY: -7,
        maxX: -6,
        maxY: 7,
      },
      {
        id: 'right-street',
        frontageAxis: 'north-south',
        compositionSide: 1,
        frontageStations: [-0.24],
        minX: 6,
        minY: -7,
        maxX: 15,
        maxY: 7,
      },
    ],
  })!;
}

describe('regional landmark fabric layout', () => {
  it('builds only manifest-authored thresholds and narrow approaches', () => {
    const layout = makeLayout();
    expect(layout.aprons).toHaveLength(4);
    expect(layout.aprons.every((apron) => apron.axis === 'north-south')).toBe(true);
    expect(layout.aprons.filter((apron) => apron.role === 'threshold')).toHaveLength(2);
    expect(layout.aprons.filter((apron) => apron.role === 'approach')).toHaveLength(2);
    expect(layout.aprons.filter((apron) => apron.role === 'threshold').every(
      (apron) => apron.halfAcross <= 0.33,
    )).toBe(true);
    for (const threshold of layout.aprons.filter((apron) => apron.role === 'threshold')) {
      expect(sampleRegionalLandmarkFabricLayout(
        threshold.centreX,
        threshold.centreY,
        layout,
      ).thresholdWeight).toBeGreaterThan(0.7);
    }
    for (const approach of layout.aprons.filter((apron) => apron.role === 'approach')) {
      expect(approach.halfAlong).toBeLessThan(0.36);
      expect(sampleRegionalLandmarkFabricLayout(
        approach.centreX,
        approach.centreY,
        layout,
      ).approachWeight).toBeGreaterThan(0.9);
    }
    const leftStations = layout.aprons
      .filter((apron) => apron.role === 'approach' && apron.id.includes('left-market'))
      .map((apron) => apron.centreY);
    const rightStations = layout.aprons
      .filter((apron) => apron.role === 'approach' && apron.id.includes('right-street'))
      .map((apron) => apron.centreY);
    expect(leftStations).not.toEqual(rightStations);
    expect(sampleRegionalLandmarkFabricLayout(0.5, 0, layout).pavingWeight).toBeLessThan(0.05);
  });

  it('is deterministic, softly bounded, and has a conservative raster cover', () => {
    const first = makeLayout();
    const second = makeLayout();
    expect(first).toEqual(second);
    const cells = rasterizeRegionalLandmarkFabricLayout(first);
    expect(cells.length).toBeGreaterThan(50);
    for (const apron of first.aprons) {
      expect(cells.some((cell) => (
        cell.x === Math.floor(apron.centreX) && cell.y === Math.floor(apron.centreY)
      ))).toBe(true);
    }
    const firstApproach = first.aprons.find((apron) => apron.role === 'approach')!;
    const softBoundary = Array.from({ length: 80 }, (_, index) => (
      sampleRegionalLandmarkFabricLayout(
        firstApproach.centreX,
        firstApproach.centreY - firstApproach.halfAlong - 0.4 + index * 0.01,
        first,
      ).pavingWeight
    )).find((weight) => weight > 0 && weight < 1);
    expect(softBoundary).toBeDefined();
  });

  it('supports a horizontal frontage without changing the sampling contract', () => {
    const layout = buildRegionalLandmarkFabricLayout({
      id: 'landmark-fabric:horizontal',
      materialFamily: 'canal-town',
      siteX: 0.5,
      siteY: 0.5,
      seed: 42,
      focals: [{
        id: 'south-frontage',
        frontageAxis: 'east-west',
        compositionSide: -1,
        frontageStations: [0],
        minX: -8,
        minY: -9,
        maxX: 8,
        maxY: -3,
      }],
    })!;
    expect(layout.aprons).toHaveLength(2);
    expect(layout.aprons[0]?.axis).toBe('east-west');
    const threshold = layout.aprons.find((apron) => apron.role === 'threshold')!;
    expect(sampleRegionalLandmarkFabricLayout(
      threshold.centreX,
      threshold.centreY,
      layout,
    ).thresholdWeight).toBeGreaterThan(0.7);
    const approach = layout.aprons.find((apron) => apron.role === 'approach')!;
    expect(sampleRegionalLandmarkFabricLayout(
      approach.centreX,
      approach.centreY,
      layout,
    ).approachWeight).toBeGreaterThan(0.9);
  });

  it('builds a shared common only between opposite manifest frontages', () => {
    const config = {
      id: 'place-fabric:shared',
      materialFamily: 'rural' as const,
      siteX: 12.5,
      siteY: -7.5,
      seed: 0x7319,
      connectionMode: 'shared-common' as const,
      focals: [
        {
          id: 'north-barn',
          frontageAxis: 'east-west' as const,
          compositionSide: -1 as const,
          frontageStations: [0],
          minX: 8,
          minY: -15,
          maxX: 13,
          maxY: -11,
        },
        {
          id: 'south-market',
          frontageAxis: 'east-west' as const,
          compositionSide: 1 as const,
          frontageStations: [0],
          minX: 12,
          minY: -4,
          maxX: 17,
          maxY: 0,
        },
      ],
    };
    const layout = buildRegionalLandmarkFabricLayout(config)!;
    expect(layout).toEqual(buildRegionalLandmarkFabricLayout(config));
    expect(layout.connectionMode).toBe('shared-common');
    expect(layout.aprons.filter((apron) => apron.role === 'common')).toHaveLength(1);
    expect(layout.aprons.filter((apron) => apron.role === 'spine')).toHaveLength(1);
    expect(layout.aprons.filter((apron) => apron.role === 'approach')).toHaveLength(2);
    expect(layout.aprons.filter((apron) => apron.role === 'threshold')).toHaveLength(2);
    expect(sampleRegionalLandmarkFabricLayout(12.5, -7.5, layout)).toMatchObject({
      pavingWeight: 1,
      approachWeight: 1,
    });
    expect(rasterizeRegionalLandmarkFabricLayout(layout).length).toBeGreaterThan(70);

    expect(buildRegionalLandmarkFabricLayout({
      ...config,
      focals: config.focals.slice(0, 1),
    })).toBeNull();
  });
});
