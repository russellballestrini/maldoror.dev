import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BIOME_FAMILIES } from '@maldoror/world';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalCivicDetailKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalQuayDetailKit,
  loadRegionalRouteMaterialKit,
  loadRegionalRouteContactKit,
} from '../game/biome-assets.js';

describe('regional biome material manifest', () => {
  it('loads all six authored families into shared bounded source tiles', async () => {
    const kit = await loadRegionalBiomeMaterialKit(path.resolve('assets/biomes/manifest.json'));
    expect(kit.sourceTileSize).toBe(96);
    expect(kit.tiles).toHaveLength(31);
    for (const family of BIOME_FAMILIES) {
      expect(kit.materials[family]).toHaveLength(4);
      expect(kit.overviewMaterials[family]).toHaveLength(1);
      for (const tile of kit.materials[family]) {
        expect(tile.pixels).toEqual([]);
        expect(tile.packedPixels).toMatchObject({ width: 96, height: 96 });
      }
      expect(kit.overviewMaterials[family].every((tile) => (
        tile.pixels.length === 0 && tile.packedPixels?.width === 128 && tile.packedPixels.height === 128
      ))).toBe(true);
    }
    expect(kit.landmarkFabricMaterials['canal-town']).toHaveLength(1);
    expect(kit.landmarkFabricMaterials['canal-town']?.every((tile) => (
      tile.walkable && tile.pixels.length === 0 && tile.packedPixels?.width === 96
    ))).toBe(true);
    expect(Object.keys(kit.landmarkFabricMaterials)).toEqual(['canal-town']);
    expect(kit.materials.coast.every((tile) => tile.material === 'water' && !tile.walkable)).toBe(true);
  });

  it('loads route and bridge surfaces from closed manifest semantics', async () => {
    const kit = await loadRegionalRouteMaterialKit(path.resolve('assets/routes/manifest.json'));
    expect(kit.sourceTileSize).toBe(96);
    expect(kit.tiles).toHaveLength(16);
    expect(Object.keys(kit.routeMaterials).sort()).toEqual(['arterial', 'local-road', 'trail']);
    for (const tiles of Object.values(kit.routeMaterials)) {
      expect(tiles).toHaveLength(4);
      expect(tiles.every((tile) => (
        tile.walkable && tile.pixels.length === 0 && tile.packedPixels?.width === 96
      ))).toBe(true);
    }
    expect(kit.crossingMaterials.bridge).toHaveLength(4);
    expect(kit.crossingMaterials.ferry).toBeUndefined();
    expect(kit.routeSurfaceStyles).toEqual({
      arterial: {
        textureScaleTiles: 2.6,
        detailWidthScale: 0.94,
        overviewWidthScale: 0.62,
        detailOpacity: 0.8,
        overviewOpacity: 0.68,
      },
      'local-road': {
        textureScaleTiles: 3.2,
        detailWidthScale: 0.88,
        overviewWidthScale: 0.55,
        detailOpacity: 0.74,
        overviewOpacity: 0.62,
      },
      trail: {
        textureScaleTiles: 4,
        detailWidthScale: 0.74,
        overviewWidthScale: 0.46,
        detailOpacity: 0.64,
        overviewOpacity: 0.54,
      },
    });
    expect(kit.crossingSurfaceStyles.bridge).toEqual({
      textureScaleTiles: 2.4,
      detailWidthScale: 0.96,
      overviewWidthScale: 0.78,
      detailOpacity: 0.96,
      overviewOpacity: 0.9,
    });
  });

  it('loads six alpha-keyed landmark clusters with explicit collision thresholds', async () => {
    const kit = await loadRegionalLandmarkKit(path.resolve('assets/biomes/landmarks-manifest.json'));
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.assets).toHaveLength(6);
    expect(new Set(kit.assets.flatMap((asset) => asset.families))).toEqual(new Set(BIOME_FAMILIES));
    expect(kit.assets.filter((asset) => asset.emitsLight)).toHaveLength(3);
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(5);
      expect(asset.collision).not.toContainEqual([0, 0]);
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0)).toBe(true);
      expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
    }
  });

  it('loads twelve soft-alpha ambient masses with explicit world constraints', async () => {
    const kit = await loadRegionalAmbientKit(path.resolve('assets/biomes/ambient-manifest.json'));
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.cellSize).toBe(4);
    expect(kit.density).toBeCloseTo(0.86);
    expect(kit.assets).toHaveLength(12);
    expect(new Set(kit.assets.flatMap((asset) => asset.families))).toEqual(new Set(BIOME_FAMILIES));
    expect(kit.assets.filter((asset) => asset.emitsLight).map((asset) => asset.id))
      .toEqual(['canal-town-facade-planter-v2']);
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(5);
      expect(asset.sprite.height).toBe(4);
      expect(asset.routeDistance[0]).toBeGreaterThanOrEqual(2);
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
    }
  });

  it('loads the semantic canal-town civic-life kit with route and landmark bands', async () => {
    const kit = await loadRegionalCivicDetailKit(
      path.resolve('assets/biomes/civic-details-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.cellSize).toBe(1);
    expect(kit.density).toBeCloseTo(0.92);
    expect(kit.assets).toHaveLength(4);
    expect(kit.assets.every((asset) => (
      asset.role === 'civic-detail' && asset.families[0] === 'canal-town' &&
      asset.minimumFamilyWeight >= 0.5 && asset.routeDistance[0] > 2 &&
      asset.landmarkDistance[1] <= 14 && asset.collision.length > 0
    ))).toBe(true);
    expect(kit.assets.filter((asset) => asset.emitsLight).map((asset) => asset.id))
      .toEqual(['canal-town-civic-lantern-v1']);
    expect(new Set(kit.assets.map((asset) => `${asset.sprite.width}x${asset.sprite.height}`)))
      .toEqual(new Set(['2x2', '2x3']));
    for (const asset of kit.assets) {
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
    }
  });

  it('loads semantic quay life with explicit waterway and physical-surface contracts', async () => {
    const kit = await loadRegionalQuayDetailKit(
      path.resolve('assets/biomes/quay-details-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.density).toBeCloseTo(0.94);
    expect(kit.assets).toHaveLength(6);
    expect(new Set(kit.assets.map((asset) => asset.surface)))
      .toEqual(new Set(['water', 'quay']));
    expect(new Set(kit.assets.map((asset) => asset.waterwayAxis)))
      .toEqual(new Set(['east-west', 'north-south', 'any']));
    expect(kit.assets.filter((asset) => asset.surface === 'water')).toHaveLength(3);
    expect(kit.assets.filter((asset) => asset.surface === 'quay')).toHaveLength(3);
    expect(kit.assets.filter((asset) => asset.activity)).toHaveLength(2);
    expect(kit.assets.filter((asset) => asset.activity).every((asset) => (
      asset.surface === 'water' && asset.activity !== undefined &&
      asset.activity.tangentDriftTiles === 1 &&
      asset.activity.cycleMinutes === 120
    ))).toBe(true);
    expect(kit.assets.every((asset) => (
      asset.role === 'quay-detail' && asset.families[0] === 'canal-town' &&
      asset.minimumFamilyWeight >= 0.15 && asset.minimumSpacing >= 4.5 &&
      asset.maximumPerLandmark >= 1 && asset.maximumPerLandmark <= 2 &&
      asset.progressRange[0] >= 0 && asset.progressRange[1] <= 1 &&
      asset.bankDistance[1] >= asset.bankDistance[0] && asset.collision.length > 0
    ))).toBe(true);
    expect(kit.assets.every((asset) => (
      asset.surface === 'water'
        ? asset.bankDistance[1] < 0
        : asset.bankDistance[0] > 0
    ))).toBe(true);
    for (const asset of kit.assets) {
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0)).toBe(true);
      expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
    }
  });

  it('loads paired authored route-contact axes for every biome family', async () => {
    const kit = await loadRegionalRouteContactKit(
      path.resolve('assets/biomes/route-contacts-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.blockSize).toBe(32);
    expect(kit.cellSize).toBe(10);
    expect(kit.density).toBe(1);
    expect(kit.assets).toHaveLength(12);
    expect(kit.assets.filter((asset) => asset.emitsLight)).toHaveLength(2);
    for (const family of BIOME_FAMILIES) {
      const familyAssets = kit.assets.filter((asset) => asset.families.includes(family));
      expect(new Set(familyAssets.map((asset) => asset.accessAxis)))
        .toEqual(new Set(['north-south', 'east-west']));
    }
    for (const asset of kit.assets) {
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(6);
      expect(asset.spriteAnchor).toEqual([3, 3]);
      expect(asset.collision).not.toContainEqual([0, 0]);
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0 && value < 255)).toBe(true);
    }
  });

  it('loads explicit modular parcel masses for every biome family', async () => {
    const [kit, ambient] = await Promise.all([
      loadRegionalParcelComponentKit(path.resolve('assets/biomes/parcel-components-manifest.json')),
      loadRegionalAmbientKit(path.resolve('assets/biomes/ambient-manifest.json')),
    ]);
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.minimumLayers).toBe(2);
    expect(kit.maximumLayers).toBe(3);
    expect(kit.layerSpacing).toBe(5);
    expect(kit.assets).toHaveLength(53);
    for (const family of BIOME_FAMILIES) {
      expect(kit.assets.filter((asset) => asset.families.includes(family))).toHaveLength(
        family === 'canal-town' ? 15 :
          family === 'forest' || family === 'coast' ? 10 : 6,
      );
    }
    for (const asset of kit.assets) {
      expect(asset.role).toBe('mass');
      expect(asset.sprite.width).toBeGreaterThanOrEqual(5);
      expect(asset.sprite.width).toBeLessThanOrEqual(16);
      expect(asset.sprite.height).toBeGreaterThanOrEqual(4);
      expect(asset.sprite.height).toBeLessThanOrEqual(14);
      expect(asset.collision.length).toBeGreaterThan(0);
    }
    const focal = kit.assets.filter((asset) => asset.compositionRole === 'focal');
    expect(focal).toHaveLength(11);
    expect(new Set(focal.map((asset) => asset.frontageAxis)))
      .toEqual(new Set(['east-west', 'north-south']));
    expect(focal.find((asset) => asset.id === 'canal-town-connected-frontage-parcel-component-v1')
      ?.sprite.width).toBe(16);
    const forestFocals = focal.filter((asset) => asset.families.includes('forest'));
    expect(forestFocals).toHaveLength(4);
    expect(new Set(forestFocals.map((asset) => asset.frontageAxis)))
      .toEqual(new Set(['east-west', 'north-south']));
    expect(new Set(forestFocals.map((asset) => asset.compositionSide)))
      .toEqual(new Set([-1, 1]));
    expect(new Set(forestFocals.map((asset) => asset.visualGroup)))
      .toEqual(new Set(['forest-log-shelter-v1', 'forest-hunter-lean-to-v1']));
    expect(forestFocals.every((asset) => asset.sprite.width === 5 && asset.sprite.height === 4))
      .toBe(true);
    const coastFocals = focal.filter((asset) => asset.families.includes('coast'));
    expect(coastFocals).toHaveLength(4);
    expect(new Set(coastFocals.map((asset) => asset.frontageAxis)))
      .toEqual(new Set(['east-west', 'north-south']));
    expect(new Set(coastFocals.map((asset) => asset.compositionSide)))
      .toEqual(new Set([-1, 1]));
    expect(new Set(coastFocals.map((asset) => asset.visualGroup)))
      .toEqual(new Set(['coast-dune-hut-v1', 'coast-fishing-rack-v1']));
    expect(coastFocals.every((asset) => asset.sprite.width === 5 && asset.sprite.height === 4))
      .toBe(true);
    expect(new Set(focal
      .filter((asset) => asset.families.includes('canal-town') &&
        asset.frontageAxis === 'north-south')
      .map((asset) => asset.compositionSide))).toEqual(new Set([-1, 1]));
    expect(focal.every((asset) => (
      asset.frontageStations !== undefined && asset.frontageStations.length >= 1 &&
      asset.frontageStations.every((station) => station >= -0.85 && station <= 0.85)
    ))).toBe(true);
    const waterfront = kit.assets.filter((asset) => asset.programs?.includes('waterfront'));
    expect(waterfront).toHaveLength(11);
    expect(new Set(waterfront.map((asset) => asset.waterfrontFunction))).toEqual(new Set([
      'boat-repair',
      'boat-shed',
      'fish-processing',
      'inn',
      'market',
      'shelter',
      'warehouse',
      'workshop',
    ]));
    const quayFrontage = waterfront.filter((asset) => asset.quayBankSide !== undefined);
    expect(quayFrontage).toHaveLength(9);
    expect(new Set(quayFrontage.map((asset) => asset.quayBankSide))).toEqual(new Set([-1, 1]));
    expect(new Set(quayFrontage.map((asset) => asset.frontageAxis)))
      .toEqual(new Set(['east-west', 'north-south']));
    expect(new Set(quayFrontage.map((asset) => asset.sprite.width))).toEqual(new Set([5, 10, 13]));
    const sideCanalFrontage = quayFrontage.filter((asset) => asset.frontageAxis === 'north-south');
    expect(sideCanalFrontage).toHaveLength(4);
    expect(sideCanalFrontage.every((asset) => (
      asset.sprite.height === 7 && asset.quayAccessOffset?.[0] === 0 &&
      asset.quayAccessOffset[1] === 0 && !asset.collision.some(
        ([x, y]) => x === asset.quayAccessOffset?.[0] && y === asset.quayAccessOffset?.[1],
      )
    ))).toBe(true);
    expect(kit.assets.find((asset) => asset.id === 'canal-town-facade-parcel-mass-v1')?.sprite)
      .toBe(ambient.assets.find((asset) => asset.id === 'canal-town-facade-planter-v2')?.sprite);
  });

  it('loads coast and highland contacts with explicit physical envelopes', async () => {
    const kit = await loadRegionalEnvironmentContactKit(
      path.resolve('assets/biomes/environment-contacts-manifest.json'),
    );
    expect(kit.sourceTileSize).toBe(48);
    expect(kit.cellSize).toBe(18);
    expect(kit.density).toBeCloseTo(0.72);
    expect(kit.assets).toHaveLength(8);
    expect(new Set(kit.assets.flatMap((asset) => asset.families)))
      .toEqual(new Set(['coast', 'mountain']));
    expect(kit.assets.find((asset) => asset.program === 'cave-interior')?.id)
      .toBe('mountain-cave-mouth-environment-contact-v1');
    expect(kit.assets.find((asset) => asset.program === 'highland-ascent')?.id)
      .toBe('mountain-way-shrine-environment-contact-v1');
    for (const asset of kit.assets) {
      expect(asset.role).toBe('environment-contact');
      expect(asset.sprite.width).toBe(6);
      expect(asset.sprite.height).toBe(6);
      expect(asset.constraints.landOnly).toBe(true);
      expect(asset.constraints.waterDistance[1]).toBeGreaterThanOrEqual(
        asset.constraints.waterDistance[0],
      );
      const alpha = spriteAlphaValues(asset.sprite);
      expect(alpha.some((value) => value === 0)).toBe(true);
      expect(alpha.some((value) => value > 0)).toBe(true);
    }
  });
});

function spriteAlphaValues(sprite: {
  tiles: Array<Array<{ pixels: unknown[]; packedPixels?: { data: Uint8Array } }>>;
}): number[] {
  return sprite.tiles.flatMap((row) => row.flatMap((tile) => {
    expect(tile.pixels).toEqual([]);
    expect(tile.packedPixels).toBeDefined();
    const data = tile.packedPixels!.data;
    const alpha: number[] = [];
    for (let index = 3; index < data.length; index += 4) alpha.push(data[index]!);
    return alpha;
  }));
}
