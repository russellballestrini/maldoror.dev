import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadRegionalParcelComponentCandidate } from '../game/biome-assets.js';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const FIXTURE = path.join(
  ROOT,
  'tools/render-sim/fixtures/canal-town-meso-frontage-v1.json',
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
