import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzipSync } from 'node:zlib';
import type {
  RegionalAmbientKit,
  RegionalBiomeMaterialKit,
  RegionalCivicDetailKit,
  RegionalEnvironmentContactKit,
  RegionalLandmarkKit,
  RegionalParcelComponentKit,
  RegionalQuayDetailKit,
  RegionalRouteContactKit,
  RegionalRouteMaterialKit,
} from './biome-assets.js';
import type { RegionalWorldAssetPaths } from './regional-world-provider.js';

const PACK_SCHEMA_VERSION = 2;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface RegionalWorldAssetKits {
  biome: RegionalBiomeMaterialKit;
  routes: RegionalRouteMaterialKit;
  landmarks: RegionalLandmarkKit;
  ambient: RegionalAmbientKit;
  civicDetails: RegionalCivicDetailKit;
  quayDetails: RegionalQuayDetailKit;
  routeContacts: RegionalRouteContactKit;
  parcelComponents: RegionalParcelComponentKit;
  environmentContacts: RegionalEnvironmentContactKit;
}

export interface RegionalRuntimeAssetProvenance {
  source: 'runtime-pack' | 'png-manifests';
  loadMs: number;
  manifestDigest: string;
  sourceDigest: string | null;
  runtimeDigest: string | null;
  packedBytes: number | null;
}

export interface LoadedRegionalRuntimeAssets {
  kits: RegionalWorldAssetKits;
  provenance: RegionalRuntimeAssetProvenance;
}

export interface RegionalRuntimeAssetPack {
  schemaVersion: typeof PACK_SCHEMA_VERSION;
  manifestDigest: string;
  sourceDigest: string;
  runtimeDigest: string;
  kits: RegionalWorldAssetKits;
}

export interface RegionalRuntimeAssetPackBuild {
  destination: string;
  manifestDigest: string;
  sourceDigest: string;
  runtimeDigest: string;
  packedBytes: number;
  sourceFiles: number;
  loadMs: number;
  encodeMs: number;
}

/** Load the build-owned contiguous pack when it matches the live manifests.
 * Source decoding remains an explicit development/rollback lane. */
export async function loadRegionalRuntimeAssets(
  assets: RegionalWorldAssetPaths,
): Promise<LoadedRegionalRuntimeAssets> {
  const startedAt = performance.now();
  const manifestDigest = await regionalManifestDigest(assets);
  if (
    process.env.MALDOROR_DISABLE_REGIONAL_RUNTIME_PACK !== '1'
    && assets.runtimePack
  ) {
    try {
      const encoded = await fs.promises.readFile(assets.runtimePack);
      const pack = decodeRegionalRuntimeAssetPack(encoded);
      if (pack.manifestDigest === manifestDigest) {
        return {
          kits: pack.kits,
          provenance: {
            source: 'runtime-pack',
            loadMs: performance.now() - startedAt,
            manifestDigest,
            sourceDigest: pack.sourceDigest,
            runtimeDigest: pack.runtimeDigest,
            packedBytes: encoded.length,
          },
        };
      }
      console.warn(
        `[RegionalAssets] Ignoring stale runtime pack ${assets.runtimePack}: ` +
        `${pack.manifestDigest} != ${manifestDigest}`,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[RegionalAssets] Runtime pack unavailable; decoding sources:`, error);
      }
    }
  }

  const kits = await loadRegionalWorldAssetKitsFromSources(assets);
  return {
    kits,
    provenance: {
      source: 'png-manifests',
      loadMs: performance.now() - startedAt,
      manifestDigest,
      sourceDigest: null,
      runtimeDigest: null,
      packedBytes: null,
    },
  };
}

export async function loadRegionalWorldAssetKitsFromSources(
  assets: RegionalWorldAssetPaths,
): Promise<RegionalWorldAssetKits> {
  const loaders = await import('./biome-assets.js');
  const [
    biome,
    routes,
    landmarks,
    ambient,
    civicDetails,
    quayDetails,
    routeContacts,
    parcelComponents,
    environmentContacts,
  ] = await Promise.all([
    loaders.loadRegionalBiomeMaterialKit(assets.biomeMaterials),
    loaders.loadRegionalRouteMaterialKit(assets.routeMaterials),
    loaders.loadRegionalLandmarkKit(assets.landmarks),
    loaders.loadRegionalAmbientKit(assets.ambient),
    loaders.loadRegionalCivicDetailKit(assets.civicDetails),
    loaders.loadRegionalQuayDetailKit(assets.quayDetails),
    loaders.loadRegionalRouteContactKit(assets.routeContacts),
    loaders.loadRegionalParcelComponentKit(assets.parcelComponents),
    loaders.loadRegionalEnvironmentContactKit(assets.environmentContacts),
  ]);
  return {
    biome,
    routes,
    landmarks,
    ambient,
    civicDetails,
    quayDetails,
    routeContacts,
    parcelComponents,
    environmentContacts,
  };
}

export async function buildRegionalRuntimeAssetPack(
  assets: RegionalWorldAssetPaths,
  destination: string,
  runtimeDigest: string,
): Promise<RegionalRuntimeAssetPackBuild> {
  if (!DIGEST_PATTERN.test(runtimeDigest)) {
    throw new Error('Regional runtime code digest must be SHA-256');
  }
  const sourceStartedAt = performance.now();
  const [kits, manifestDigest, source] = await Promise.all([
    loadRegionalWorldAssetKitsFromSources(assets),
    regionalManifestDigest(assets),
    regionalSourceDigest(assets),
  ]);
  const loadMs = performance.now() - sourceStartedAt;
  const encodeStartedAt = performance.now();
  const encoded = encodeRegionalRuntimeAssetPack({
    schemaVersion: PACK_SCHEMA_VERSION,
    manifestDigest,
    sourceDigest: source.digest,
    runtimeDigest,
    kits,
  });
  const encodeMs = performance.now() - encodeStartedAt;
  const absoluteDestination = path.resolve(destination);
  const temporary = `${absoluteDestination}.tmp-${process.pid}`;
  await fs.promises.mkdir(path.dirname(absoluteDestination), { recursive: true });
  await fs.promises.writeFile(temporary, encoded);
  await fs.promises.rename(temporary, absoluteDestination);
  return {
    destination: absoluteDestination,
    manifestDigest,
    sourceDigest: source.digest,
    runtimeDigest,
    packedBytes: encoded.length,
    sourceFiles: source.files,
    loadMs,
    encodeMs,
  };
}

export function encodeRegionalRuntimeAssetPack(pack: RegionalRuntimeAssetPack): Buffer {
  validateRegionalRuntimeAssetPack(pack);
  return gzipSync(serialize(pack), { level: 1 });
}

export function decodeRegionalRuntimeAssetPack(encoded: Uint8Array): RegionalRuntimeAssetPack {
  const value = deserialize(gunzipSync(encoded)) as unknown;
  validateRegionalRuntimeAssetPack(value);
  return value;
}

export async function regionalManifestDigest(assets: RegionalWorldAssetPaths): Promise<string> {
  const entries = manifestEntries(assets);
  const contents = await Promise.all(entries.map(([, file]) => fs.promises.readFile(file)));
  const hash = crypto.createHash('sha256');
  for (let index = 0; index < entries.length; index++) {
    hashFramed(hash, entries[index]![0], contents[index]!);
  }
  return hash.digest('hex');
}

async function regionalSourceDigest(
  assets: RegionalWorldAssetPaths,
): Promise<{ digest: string; files: number }> {
  const manifests = manifestEntries(assets);
  const manifestContents = await Promise.all(
    manifests.map(async ([label, file]) => [label, file, await fs.promises.readFile(file)] as const),
  );
  const referenced = new Map<string, string>();
  for (const [label, manifestPath, contents] of manifestContents) {
    const parsed = JSON.parse(contents.toString('utf8')) as unknown;
    collectReferencedPngs(parsed, path.dirname(manifestPath), label, referenced);
  }
  const sourceFiles = [...referenced.entries()]
    .map(([file, label]) => [label, file] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const sourceContents = await Promise.all(
    sourceFiles.map(async ([label, file]) => [label, await fs.promises.readFile(file)] as const),
  );
  const hash = crypto.createHash('sha256');
  for (const [label, , contents] of manifestContents) hashFramed(hash, `manifest:${label}`, contents);
  for (const [label, contents] of sourceContents) hashFramed(hash, `asset:${label}`, contents);
  return { digest: hash.digest('hex'), files: manifests.length + sourceFiles.length };
}

function manifestEntries(assets: RegionalWorldAssetPaths): Array<readonly [string, string]> {
  return [
    ['ambient', assets.ambient],
    ['biomeMaterials', assets.biomeMaterials],
    ['civicDetails', assets.civicDetails],
    ['environmentContacts', assets.environmentContacts],
    ['landmarks', assets.landmarks],
    ['parcelComponents', assets.parcelComponents],
    ['quayDetails', assets.quayDetails],
    ['routeContacts', assets.routeContacts],
    ['routeMaterials', assets.routeMaterials],
  ];
}

function collectReferencedPngs(
  value: unknown,
  manifestDirectory: string,
  prefix: string,
  output: Map<string, string>,
): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => collectReferencedPngs(
      entry,
      manifestDirectory,
      `${prefix}[${index}]`,
      output,
    ));
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, entry] of Object.entries(value)) {
    const label = `${prefix}.${key}`;
    if (typeof entry === 'string' && entry.toLowerCase().endsWith('.png')) {
      const resolved = path.resolve(manifestDirectory, entry);
      if (!resolved.startsWith(`${manifestDirectory}${path.sep}`)) {
        throw new Error(`Regional runtime asset escapes manifest directory: ${entry}`);
      }
      if (!output.has(resolved)) output.set(resolved, label);
    } else {
      collectReferencedPngs(entry, manifestDirectory, label, output);
    }
  }
}

function hashFramed(hash: crypto.Hash, label: string, contents: Uint8Array): void {
  hash.update(label);
  hash.update('\0');
  hash.update(String(contents.length));
  hash.update('\0');
  hash.update(contents);
  hash.update('\0');
}

function validateRegionalRuntimeAssetPack(value: unknown): asserts value is RegionalRuntimeAssetPack {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Regional runtime asset pack must be an object');
  }
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== PACK_SCHEMA_VERSION) {
    throw new Error(`Regional runtime asset pack schema must be ${PACK_SCHEMA_VERSION}`);
  }
  if (typeof root.manifestDigest !== 'string' || !DIGEST_PATTERN.test(root.manifestDigest)) {
    throw new Error('Regional runtime asset pack has an invalid manifest digest');
  }
  if (typeof root.sourceDigest !== 'string' || !DIGEST_PATTERN.test(root.sourceDigest)) {
    throw new Error('Regional runtime asset pack has an invalid source digest');
  }
  if (typeof root.runtimeDigest !== 'string' || !DIGEST_PATTERN.test(root.runtimeDigest)) {
    throw new Error('Regional runtime asset pack has an invalid runtime digest');
  }
  if (!root.kits || typeof root.kits !== 'object' || Array.isArray(root.kits)) {
    throw new Error('Regional runtime asset pack has no kits object');
  }
  const kits = root.kits as Record<string, unknown>;
  for (const key of [
    'biome',
    'routes',
    'landmarks',
    'ambient',
    'civicDetails',
    'quayDetails',
    'routeContacts',
    'parcelComponents',
    'environmentContacts',
  ]) {
    if (!kits[key] || typeof kits[key] !== 'object' || Array.isArray(kits[key])) {
      throw new Error(`Regional runtime asset pack is missing kit: ${key}`);
    }
  }
}
