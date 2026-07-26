import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  decodeRegionalRuntimeAssetPack,
  encodeRegionalRuntimeAssetPack,
  loadRegionalRuntimeAssets,
  regionalManifestDigest,
  type RegionalRuntimeAssetPack,
  type RegionalWorldAssetKits,
} from '../game/regional-runtime-asset-pack.js';
import type { RegionalWorldAssetPaths } from '../game/regional-world-provider.js';

const temporaryDirectories: string[] = [];
const digest = 'a'.repeat(64);

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    fs.promises.rm(directory, { recursive: true, force: true })
  )));
});

describe('regional runtime asset pack', () => {
  it('round-trips every named kit in a deterministic compressed envelope', () => {
    const pack = fixturePack();
    const first = encodeRegionalRuntimeAssetPack(pack);
    const second = encodeRegionalRuntimeAssetPack(pack);

    expect(first.equals(second)).toBe(true);
    expect(decodeRegionalRuntimeAssetPack(first)).toEqual(pack);
  });

  it('rejects corrupt or schema-incomplete payloads instead of opening them', () => {
    expect(() => decodeRegionalRuntimeAssetPack(Buffer.from('not-a-pack'))).toThrow();
    expect(() => encodeRegionalRuntimeAssetPack({
      ...fixturePack(),
      schemaVersion: 2,
    } as unknown as RegionalRuntimeAssetPack)).toThrow(/schema/);
  });

  it('binds runtime selection to the complete ordered manifest set', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'maldoror-assets-'));
    temporaryDirectories.push(directory);
    const paths = await manifestPaths(directory);
    const first = await regionalManifestDigest(paths);
    await fs.promises.writeFile(paths.quayDetails, '{"changed":true}\n');
    const second = await regionalManifestDigest(paths);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(second).not.toBe(first);
  });

  it('selects a matching pack without opening the PNG source lane', async () => {
    const directory = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'maldoror-assets-'));
    temporaryDirectories.push(directory);
    const paths = await manifestPaths(directory);
    const pack = {
      ...fixturePack(),
      manifestDigest: await regionalManifestDigest(paths),
    };
    const encoded = encodeRegionalRuntimeAssetPack(pack);
    await fs.promises.writeFile(paths.runtimePack, encoded);
    vi.stubEnv('MALDOROR_DISABLE_REGIONAL_RUNTIME_PACK', '0');

    const loaded = await loadRegionalRuntimeAssets(paths);

    expect(loaded.kits).toEqual(pack.kits);
    expect(loaded.provenance).toMatchObject({
      source: 'runtime-pack',
      manifestDigest: pack.manifestDigest,
      sourceDigest: pack.sourceDigest,
      packedBytes: encoded.length,
    });
  });
});

function fixturePack(): RegionalRuntimeAssetPack {
  const names = [
    'biome',
    'routes',
    'landmarks',
    'ambient',
    'civicDetails',
    'quayDetails',
    'routeContacts',
    'parcelComponents',
    'environmentContacts',
  ] as const;
  return {
    schemaVersion: 1,
    manifestDigest: digest,
    sourceDigest: 'b'.repeat(64),
    kits: Object.fromEntries(names.map((name) => [name, { marker: name }])) as unknown as
      RegionalWorldAssetKits,
  };
}

async function manifestPaths(directory: string): Promise<RegionalWorldAssetPaths> {
  const names = [
    'ambient',
    'biomeMaterials',
    'civicDetails',
    'environmentContacts',
    'landmarks',
    'parcelComponents',
    'quayDetails',
    'routeContacts',
    'routeMaterials',
  ] as const;
  const result = { runtimePack: path.join(directory, 'runtime-pack') } as RegionalWorldAssetPaths;
  for (const name of names) {
    const file = path.join(directory, `${name}.json`);
    await fs.promises.writeFile(file, `${JSON.stringify({ name })}\n`);
    result[name] = file;
  }
  return result;
}
