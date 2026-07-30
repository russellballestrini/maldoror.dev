import { describe, expect, it, vi } from 'vitest';
import type { RegionalAssetPlacement, RegionalWorldTileProvider } from '@maldoror/world';
import { collectRegionalLifeWorkplaces } from '../game/regional-life-places.js';

describe('regional life places', () => {
  it('projects only access-proven semantic waterfronts and deduplicates overlap', () => {
    const placements: RegionalAssetPlacement[] = [
      {
        assetId: 'market-frontage',
        kind: 'ambient',
        families: ['canal-town'],
        siteX: 0,
        siteY: 0,
        anchorX: 2,
        anchorY: 3,
        waterfrontId: 'quay:origin',
        waterfrontFunction: 'market',
        quayAccessPath: [[2, 3], [2, 4]],
      },
      {
        assetId: 'unproven-workshop',
        kind: 'ambient',
        families: ['canal-town'],
        siteX: 0,
        siteY: 0,
        anchorX: 5,
        anchorY: 3,
        waterfrontFunction: 'workshop',
      },
      {
        assetId: 'nonsemantic-door',
        kind: 'ambient',
        families: ['canal-town'],
        siteX: 0,
        siteY: 0,
        anchorX: 7,
        anchorY: 3,
        quayAccessPath: [[7, 3], [7, 4]],
      },
    ];
    const getAmbientPlacementsInBounds = vi.fn(() => placements);
    const world = { getAmbientPlacementsInBounds } as Pick<
      RegionalWorldTileProvider,
      'getAmbientPlacementsInBounds'
    >;

    const result = collectRegionalLifeWorkplaces(world, [
      { minX: -5, minY: -5, maxX: 5, maxY: 5 },
      { minX: 0, minY: 0, maxX: 10, maxY: 10 },
    ]);

    expect(getAmbientPlacementsInBounds).toHaveBeenNthCalledWith(1, -15, -15, 15, 15);
    expect(getAmbientPlacementsInBounds).toHaveBeenNthCalledWith(2, -10, -10, 20, 20);
    expect(result).toEqual([{
      id: 'quay:origin:market-frontage@2,3',
      x: 2,
      y: 3,
    }]);
  });
});
