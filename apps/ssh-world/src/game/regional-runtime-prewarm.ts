import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { deserialize, serialize } from 'node:v8';
import { gunzipSync, gzipSync } from 'node:zlib';
import type { RegionalPackedPreparedViewport } from '@maldoror/world';

const PREWARM_SCHEMA_VERSION = 2;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export interface RegionalRuntimePrewarmBundle {
  schemaVersion: typeof PREWARM_SCHEMA_VERSION;
  runtimeDigest: string;
  assetManifestDigest: string;
  assetSourceDigest: string;
  viewports: RegionalPackedPreparedViewport[];
}

export interface RegionalRuntimePrewarmRead {
  bundle: RegionalRuntimePrewarmBundle;
  loadMs: number;
  packedBytes: number;
}

export interface RegionalRuntimePrewarmWrite {
  destination: string;
  encodeMs: number;
  packedBytes: number;
  viewports: number;
}

export interface RegionalRuntimePrewarmExpectation {
  runtimeDigest: string | null;
  assetManifestDigest: string;
  assetSourceDigest: string | null;
  worldSeed: string;
}

export interface RegionalRuntimePrewarmSelection {
  viewports: RegionalPackedPreparedViewport[];
  reason: 'matched' | 'runtime-digest' | 'manifest-digest' | 'source-digest';
}

export function encodeRegionalRuntimePrewarmBundle(
  bundle: RegionalRuntimePrewarmBundle,
): Buffer {
  validateRegionalRuntimePrewarmBundle(bundle);
  return gzipSync(serialize(bundle), { level: 1 });
}

export function decodeRegionalRuntimePrewarmBundle(
  encoded: Uint8Array,
): RegionalRuntimePrewarmBundle {
  const value = deserialize(gunzipSync(encoded)) as unknown;
  validateRegionalRuntimePrewarmBundle(value);
  return value;
}

export async function readRegionalRuntimePrewarmBundle(
  source: string,
): Promise<RegionalRuntimePrewarmRead> {
  const startedAt = performance.now();
  const encoded = await fs.promises.readFile(source);
  return {
    bundle: decodeRegionalRuntimePrewarmBundle(encoded),
    loadMs: performance.now() - startedAt,
    packedBytes: encoded.length,
  };
}

export async function writeRegionalRuntimePrewarmBundle(
  destination: string,
  bundle: RegionalRuntimePrewarmBundle,
): Promise<RegionalRuntimePrewarmWrite> {
  const encodeStartedAt = performance.now();
  const encoded = encodeRegionalRuntimePrewarmBundle(bundle);
  const encodeMs = performance.now() - encodeStartedAt;
  const absoluteDestination = path.resolve(destination);
  const temporary = `${absoluteDestination}.tmp-${process.pid}`;
  await fs.promises.mkdir(path.dirname(absoluteDestination), { recursive: true });
  await fs.promises.writeFile(temporary, encoded);
  await fs.promises.rename(temporary, absoluteDestination);
  return {
    destination: absoluteDestination,
    encodeMs,
    packedBytes: encoded.length,
    viewports: bundle.viewports.length,
  };
}

/** Match both generated artifacts, then select only the current runtime seed.
 * A normal fresh world therefore remains supported without special cases. */
export function selectRegionalRuntimePrewarmViewports(
  bundle: RegionalRuntimePrewarmBundle,
  expected: RegionalRuntimePrewarmExpectation,
): RegionalRuntimePrewarmSelection {
  if (!expected.runtimeDigest || bundle.runtimeDigest !== expected.runtimeDigest) {
    return { viewports: [], reason: 'runtime-digest' };
  }
  if (bundle.assetManifestDigest !== expected.assetManifestDigest) {
    return { viewports: [], reason: 'manifest-digest' };
  }
  if (!expected.assetSourceDigest || bundle.assetSourceDigest !== expected.assetSourceDigest) {
    return { viewports: [], reason: 'source-digest' };
  }
  return {
    viewports: bundle.viewports.filter((viewport) => viewport.worldSeed === expected.worldSeed),
    reason: 'matched',
  };
}

function validateRegionalRuntimePrewarmBundle(
  value: unknown,
): asserts value is RegionalRuntimePrewarmBundle {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Regional runtime prewarm bundle must be an object');
  }
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== PREWARM_SCHEMA_VERSION) {
    throw new Error(`Regional runtime prewarm schema must be ${PREWARM_SCHEMA_VERSION}`);
  }
  for (const key of ['runtimeDigest', 'assetManifestDigest', 'assetSourceDigest'] as const) {
    if (typeof root[key] !== 'string' || !DIGEST_PATTERN.test(root[key])) {
      throw new Error(`Regional runtime prewarm has an invalid ${key}`);
    }
  }
  if (!Array.isArray(root.viewports) || root.viewports.length === 0) {
    throw new Error('Regional runtime prewarm has no viewports');
  }
  for (const viewport of root.viewports) validatePackedViewport(viewport);
}

function validatePackedViewport(value: unknown): asserts value is RegionalPackedPreparedViewport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Regional runtime prewarm viewport must be an object');
  }
  const viewport = value as Record<string, unknown>;
  if (viewport.version !== 3 || typeof viewport.worldSeed !== 'string' ||
      !/^[0-9]+$/.test(viewport.worldSeed)) {
    throw new Error('Regional runtime prewarm viewport identity is invalid');
  }
  if (!viewport.bounds || typeof viewport.bounds !== 'object' || Array.isArray(viewport.bounds)) {
    throw new Error('Regional runtime prewarm viewport bounds are invalid');
  }
  const bounds = viewport.bounds as Record<string, unknown>;
  const coordinates = ['minX', 'minY', 'maxX', 'maxY'] as const;
  if (coordinates.some((key) => !Number.isSafeInteger(bounds[key]))) {
    throw new Error('Regional runtime prewarm viewport bounds must be safe integers');
  }
  const minX = bounds.minX as number;
  const minY = bounds.minY as number;
  const maxX = bounds.maxX as number;
  const maxY = bounds.maxY as number;
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const resolution = viewport.resolution;
  if (width <= 0 || height <= 0 || width * height > 8192 ||
      !Number.isSafeInteger(resolution) || (resolution as number) < 1 ||
      (resolution as number) > 256) {
    throw new Error('Regional runtime prewarm viewport dimensions are invalid');
  }
  const area = width * height;
  const pixelsPerTile = (resolution as number) ** 2;
  typedLength(viewport.terrainRgba, Uint8Array, area * pixelsPerTile * 4, 'terrainRgba');
  typedLength(viewport.terrainMaterial, Uint8Array, area * pixelsPerTile, 'terrainMaterial');
  typedLength(viewport.terrainWalkable, Uint8Array, area, 'terrainWalkable');
  typedLength(viewport.solid, Uint8Array, area, 'solid');
  if (!(viewport.overlayCoordinates instanceof Int32Array) ||
      viewport.overlayCoordinates.length % 2 !== 0) {
    throw new Error('Regional runtime prewarm overlayCoordinates are invalid');
  }
  const overlays = viewport.overlayCoordinates.length / 2;
  typedLength(viewport.overlayRgba, Uint8Array, overlays * pixelsPerTile * 4, 'overlayRgba');
  validateDynamicPlacements(viewport.dynamicPlacements);
}

function validateDynamicPlacements(value: unknown): void {
  if (!Array.isArray(value) || value.length > 8192) {
    throw new Error('Regional runtime prewarm dynamicPlacements must be a bounded array');
  }
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Regional runtime prewarm dynamicPlacements[${index}] must be an object`);
    }
    const placement = entry as Record<string, unknown>;
    if (typeof placement.assetId !== 'string' || placement.assetId.length < 1 ||
        placement.assetId.length > 256 || !Number.isSafeInteger(placement.anchorX) ||
        !Number.isSafeInteger(placement.anchorY)) {
      throw new Error(`Regional runtime prewarm dynamicPlacements[${index}] identity is invalid`);
    }
    for (const key of ['pathTangentX', 'pathTangentY'] as const) {
      const component = placement[key];
      if (component !== undefined && (typeof component !== 'number' ||
          !Number.isFinite(component) || Math.abs(component) > 1.000001)) {
        throw new Error(`Regional runtime prewarm dynamicPlacements[${index}].${key} is invalid`);
      }
    }
    if (placement.parcelPathId !== undefined &&
        (typeof placement.parcelPathId !== 'string' || placement.parcelPathId.length > 512)) {
      throw new Error(`Regional runtime prewarm dynamicPlacements[${index}].parcelPathId is invalid`);
    }
  }
}

function typedLength(
  value: unknown,
  constructor: typeof Uint8Array,
  length: number,
  label: string,
): void {
  if (!(value instanceof constructor) || value.length !== length) {
    throw new Error(`Regional runtime prewarm ${label} length is invalid`);
  }
}
