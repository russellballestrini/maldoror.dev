import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRegionalParcelComponentCandidate } from '../game/biome-assets.js';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const FIXTURE = path.join(
  ROOT,
  'tools/render-sim/fixtures/canal-town-meso-frontage-v1.json',
);
const MODULAR_FIXTURE = path.join(
  ROOT,
  'tools/render-sim/fixtures/canal-town-modular-frontages-v1.json',
);
const COMPACT_MODULAR_FIXTURE = path.join(
  ROOT,
  'tools/render-sim/fixtures/canal-town-modular-frontages-v2-compact.json',
);
const SEMANTIC_LOD_FIXTURE = path.join(
  ROOT,
  'tools/render-sim/fixtures/canal-town-modular-frontages-semantic-lod-v1.json',
);

interface CandidateFixture {
  runtimeManifest: boolean;
  sourceTileSize: number;
  asset: Record<string, unknown> & {
    id: string;
    collision: Array<[number, number]>;
    circulationOffsets: Array<[number, number]>;
  };
}

interface ModularCandidateFixture {
  runtimeManifest: boolean;
  sourceTileSize: number;
  assets: Array<Record<string, unknown> & {
    id: string;
    collision: Array<[number, number]>;
    circulationOffsets: Array<[number, number]>;
  }>;
}

function readFixture(): CandidateFixture {
  return JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as CandidateFixture;
}

describe('research-only meso frontage candidate', () => {
  it('loads through production parsing while preserving an authored open arch', async () => {
    const fixture = readFixture();
    const asset = await loadRegionalParcelComponentCandidate(
      path.join(ROOT, 'assets/biomes'),
      fixture.sourceTileSize,
      fixture.asset,
    );

    expect(fixture.runtimeManifest).toBe(false);
    expect(asset.id).toBe('canal-town-workshop-row-meso-frontage-v1');
    expect(asset.sprite).toMatchObject({ width: 20, height: 14 });
    expect(asset.placeDetailRole).toBe('corridor-frontage');
    expect(asset.visualGroup).toBe('canal-town-workshop-row-meso-frontage');
    expect(asset.frontageAxis).toBe('east-west');
    expect(asset.compositionSide).toBe(-1);
    expect(asset.frontageStations).toEqual([0.22]);
    expect(asset.circulationOffsets).toEqual([
      [2, 0], [2, -1], [2, -2], [2, -3], [2, -4],
    ]);

    const tiles = asset.sprite.tiles.flat();
    const sparseTiles = tiles.filter((tile) => tile.packedPixels === undefined);
    const packedBytes = tiles.reduce((total, tile) => (
      total + (tile.packedPixels?.data.byteLength ?? 0)
    ), 0);
    expect(sparseTiles).toHaveLength(73);
    expect(packedBytes).toBe(1_907_712);
    expect(tiles.every((tile) => (
      tile.packedPixels === undefined || tile.packedPixels.data.some((_, index) => (
        index % 4 === 3 && tile.packedPixels!.data[index]! >= 4
      ))
    ))).toBe(true);

    const collision = new Set(asset.collision.map(([x, y]) => `${x},${y}`));
    for (const [x, y] of asset.circulationOffsets ?? []) {
      expect(collision.has(`${x},${y}`)).toBe(false);
    }

    const anchorX = Math.floor(asset.sprite.width / 2);
    const anchorY = asset.sprite.height - 1;
    const apertureCoverage = (asset.circulationOffsets ?? []).map(([offsetX, offsetY]) => {
      const tile = asset.sprite.tiles[anchorY + offsetY]?.[anchorX + offsetX];
      const packed = tile?.packedPixels;
      if (!packed) return 0;
      let alpha = 0;
      for (let index = 3; index < packed.data.length; index += 4) alpha += packed.data[index]!;
      return alpha / (255 * packed.width * packed.height);
    });
    expect(Math.max(...apertureCoverage)).toBeLessThan(0.3);
    expect(apertureCoverage.at(-1)).toBeGreaterThan(0.15);
  });

  it('fails closed when collision occupies a declared circulation opening', async () => {
    const fixture = readFixture();
    await expect(loadRegionalParcelComponentCandidate(
      path.join(ROOT, 'assets/biomes'),
      fixture.sourceTileSize,
      {
        ...fixture.asset,
        collision: [...fixture.asset.collision, [2, -2]],
      },
    )).rejects.toThrow('Invalid regional parcel component entry');
  });

  it('fails closed when declared circulation is disconnected', async () => {
    const fixture = readFixture();
    await expect(loadRegionalParcelComponentCandidate(
      path.join(ROOT, 'assets/biomes'),
      fixture.sourceTileSize,
      {
        ...fixture.asset,
        circulationOffsets: [[2, 0], [2, -2]],
      },
    )).rejects.toThrow('Invalid regional parcel component entry');
  });

  it('is absent from the production parcel manifest', () => {
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'assets/biomes/parcel-components-manifest.json'),
      'utf8',
    )) as { assets: Array<{ id: string }> };
    expect(manifest.assets.some(({ id }) => (
      id === 'canal-town-workshop-row-meso-frontage-v1'
    ))).toBe(false);
  });
});

describe('research-only modular frontage candidates', () => {
  it('loads three smaller authored thresholds through the production parser', async () => {
    const fixture = JSON.parse(
      fs.readFileSync(MODULAR_FIXTURE, 'utf8'),
    ) as ModularCandidateFixture;
    const assets = await Promise.all(fixture.assets.map((entry) => (
      loadRegionalParcelComponentCandidate(
        path.join(ROOT, 'assets/biomes'),
        fixture.sourceTileSize,
        entry,
      )
    )));

    expect(fixture.runtimeManifest).toBe(false);
    expect(assets.map((asset) => asset.id)).toEqual([
      'canal-town-modular-shops-frontage-v1',
      'canal-town-modular-arch-frontage-v1',
      'canal-town-modular-workshop-frontage-v1',
    ]);
    expect(assets.every((asset) => (
      asset.sprite.width === 6 && asset.sprite.height === 7 &&
      asset.placeDetailRole === 'corridor-frontage' &&
      asset.frontageAxis === 'east-west' && asset.compositionSide === -1
    ))).toBe(true);

    const expectedPacked = new Map([
      ['canal-town-modular-shops-frontage-v1', { sparse: 5, bytes: 340_992 }],
      ['canal-town-modular-arch-frontage-v1', { sparse: 6, bytes: 331_776 }],
      ['canal-town-modular-workshop-frontage-v1', { sparse: 1, bytes: 377_856 }],
    ]);
    for (const asset of assets) {
      const tiles = asset.sprite.tiles.flat();
      const expected = expectedPacked.get(asset.id)!;
      expect(tiles.filter((tile) => tile.packedPixels === undefined)).toHaveLength(
        expected.sparse,
      );
      expect(tiles.reduce((total, tile) => (
        total + (tile.packedPixels?.data.byteLength ?? 0)
      ), 0)).toBe(expected.bytes);
      const collision = new Set(asset.collision.map(([x, y]) => `${x},${y}`));
      expect(asset.circulationOffsets?.every(([x, y]) => !collision.has(`${x},${y}`)))
        .toBe(true);
    }

    const arch = assets[1]!;
    const [openingX, openingY] = arch.circulationOffsets![0]!;
    const opening = arch.sprite.tiles[
      arch.sprite.height - 1 + openingY
    ]?.[
      Math.floor(arch.sprite.width / 2) + openingX
    ]?.packedPixels;
    const openingAlpha = opening
      ? opening.data.reduce((total, value, index) => (
        index % 4 === 3 ? total + value : total
      ), 0) / (255 * opening.width * opening.height)
      : 0;
    expect(openingAlpha).toBeLessThan(0.15);
  });

  it('keeps every modular experiment out of the production parcel manifest', () => {
    const fixtures = [
      MODULAR_FIXTURE,
      COMPACT_MODULAR_FIXTURE,
      SEMANTIC_LOD_FIXTURE,
    ].map((fixturePath) => (
      JSON.parse(fs.readFileSync(fixturePath, 'utf8')) as ModularCandidateFixture
    ));
    const manifest = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'assets/biomes/parcel-components-manifest.json'),
      'utf8',
    )) as { assets: Array<{ id: string }> };
    const productionIds = new Set(manifest.assets.map(({ id }) => id));
    expect(fixtures.flatMap(({ assets }) => assets).every(({ id }) => (
      !productionIds.has(id)
    ))).toBe(true);
  });

  it('loads a separately authored regional visual source without changing semantics', async () => {
    const [walkingFixture, lodFixture] = [MODULAR_FIXTURE, SEMANTIC_LOD_FIXTURE].map(
      (fixturePath) => JSON.parse(
        fs.readFileSync(fixturePath, 'utf8'),
      ) as ModularCandidateFixture,
    );
    if (!walkingFixture || !lodFixture) throw new Error('Missing modular visual fixture');
    const descriptorSemantics = (entry: Record<string, unknown>) => Object.fromEntries(
      Object.entries(entry).filter(([key]) => key !== 'file'),
    );
    expect(lodFixture.assets.map(descriptorSemantics)).toEqual(
      walkingFixture.assets.map(descriptorSemantics),
    );
    const load = (fixture: ModularCandidateFixture) => Promise.all(fixture.assets.map((entry) => (
      loadRegionalParcelComponentCandidate(
        path.join(ROOT, 'assets/biomes'),
        fixture.sourceTileSize,
        entry,
      )
    )));
    const [walking, lod] = await Promise.all([load(walkingFixture), load(lodFixture)]);
    const semanticSignature = (asset: (typeof walking)[number]) => ({
      id: asset.id,
      families: asset.families,
      role: asset.role,
      visualGroup: asset.visualGroup,
      compositionRole: asset.compositionRole,
      streetPairRole: asset.streetPairRole,
      placeDetailRole: asset.placeDetailRole,
      frontageAxis: asset.frontageAxis,
      compositionSide: asset.compositionSide,
      frontageStations: asset.frontageStations,
      circulationOffsets: asset.circulationOffsets,
      collision: asset.collision,
      emitsLight: asset.emitsLight,
      spriteAnchor: asset.spriteAnchor,
      spriteDimensions: [asset.sprite.width, asset.sprite.height],
    });

    expect(lod.map(semanticSignature)).toEqual(walking.map(semanticSignature));
    expect(lod.map((asset) => asset.sprite.tiles.flat().reduce((total, tile) => (
      total + (tile.packedPixels?.data.byteLength ?? 0)
    ), 0))).toEqual([322_560, 331_776, 359_424]);
    expect(lod.map((asset) => asset.sprite.tiles.flat().filter((tile) => (
      tile.packedPixels === undefined
    )).length)).toEqual([7, 6, 3]);
    expect(lod.some((asset, index) => asset.sprite.tiles.flat().some((tile, tileIndex) => (
      tile.packedPixels?.data.some((value, byteIndex) => (
        byteIndex % 4 !== 3 && value !==
          walking[index]!.sprite.tiles.flat()[tileIndex]?.packedPixels?.data[byteIndex]
      )) ?? false
    )))).toBe(true);
  });

  it('retains the rejected 5x6 reconstruction with exact bounded planes', async () => {
    const fixture = JSON.parse(
      fs.readFileSync(COMPACT_MODULAR_FIXTURE, 'utf8'),
    ) as ModularCandidateFixture;
    const assets = await Promise.all(fixture.assets.map((entry) => (
      loadRegionalParcelComponentCandidate(
        path.join(ROOT, 'assets/biomes'),
        fixture.sourceTileSize,
        entry,
      )
    )));
    const expectedPacked = new Map([
      ['canal-town-modular-shops-frontage-v2-compact', { sparse: 3, bytes: 248_832 }],
      ['canal-town-modular-arch-frontage-v2-compact', { sparse: 4, bytes: 239_616 }],
      ['canal-town-modular-workshop-frontage-v2-compact', { sparse: 1, bytes: 267_264 }],
    ]);

    expect(fixture.runtimeManifest).toBe(false);
    expect(assets).toHaveLength(3);
    for (const asset of assets) {
      const tiles = asset.sprite.tiles.flat();
      const expected = expectedPacked.get(asset.id)!;
      const collision = new Set(asset.collision.map(([x, y]) => `${x},${y}`));
      expect(asset.sprite).toMatchObject({ width: 5, height: 6 });
      expect(tiles.filter((tile) => tile.packedPixels === undefined)).toHaveLength(
        expected.sparse,
      );
      expect(tiles.reduce((total, tile) => (
        total + (tile.packedPixels?.data.byteLength ?? 0)
      ), 0)).toBe(expected.bytes);
      expect(asset.circulationOffsets?.every(([x, y]) => !collision.has(`${x},${y}`)))
        .toBe(true);
    }
  });
});
