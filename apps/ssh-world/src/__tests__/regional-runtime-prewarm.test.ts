import { describe, expect, it } from 'vitest';
import type { RegionalPackedPreparedViewport } from '@maldoror/world';
import {
  REGIONAL_BUILD_PREWARM_SPECS,
  REGIONAL_ORIGIN_PREWARM,
  parseRegionalRuntimeBuildConfig,
} from '../game/regional-runtime-config.js';
import {
  decodeRegionalRuntimePrewarmBundle,
  encodeRegionalRuntimePrewarmBundle,
  selectRegionalRuntimePrewarmViewports,
  type RegionalRuntimePrewarmBundle,
} from '../game/regional-runtime-prewarm.js';

const runtimeDigest = 'a'.repeat(64);
const manifestDigest = 'b'.repeat(64);
const sourceDigest = 'c'.repeat(64);

describe('regional runtime prewarm', () => {
  it('round-trips typed viewport planes in a deterministic envelope', () => {
    const bundle = fixtureBundle();
    const first = encodeRegionalRuntimePrewarmBundle(bundle);
    const second = encodeRegionalRuntimePrewarmBundle(bundle);

    expect(first.equals(second)).toBe(true);
    expect(decodeRegionalRuntimePrewarmBundle(first)).toEqual(bundle);
  });

  it('rejects corrupt dimensions before a viewport enters the service cache', () => {
    const bundle = fixtureBundle();
    expect(() => decodeRegionalRuntimePrewarmBundle(Buffer.from('not-a-prewarm'))).toThrow();
    expect(() => encodeRegionalRuntimePrewarmBundle({
      ...bundle,
      viewports: [{
        ...bundle.viewports[0]!,
        terrainRgba: new Uint8Array(1),
      }],
    })).toThrow(/terrainRgba/);
  });

  it('requires exact runtime and asset provenance while allowing other seeds to generate', () => {
    const bundle = fixtureBundle();
    const matched = selectRegionalRuntimePrewarmViewports(bundle, {
      runtimeDigest,
      assetManifestDigest: manifestDigest,
      assetSourceDigest: sourceDigest,
      worldSeed: '42',
    });
    expect(matched.reason).toBe('matched');
    expect(matched.viewports).toEqual(bundle.viewports);

    expect(selectRegionalRuntimePrewarmViewports(bundle, {
      runtimeDigest: 'd'.repeat(64),
      assetManifestDigest: manifestDigest,
      assetSourceDigest: sourceDigest,
      worldSeed: '42',
    })).toEqual({ viewports: [], reason: 'runtime-digest' });
    expect(selectRegionalRuntimePrewarmViewports(bundle, {
      runtimeDigest,
      assetManifestDigest: manifestDigest,
      assetSourceDigest: sourceDigest,
      worldSeed: '43',
    })).toEqual({ viewports: [], reason: 'matched' });
  });

  it('validates the declarative seed list without fixing runtime fallback seeds', () => {
    expect(parseRegionalRuntimeBuildConfig({
      schemaVersion: 1,
      prewarmWorldSeeds: ['42', '43'],
    })).toEqual({ schemaVersion: 1, prewarmWorldSeeds: ['42', '43'] });
    expect(() => parseRegionalRuntimeBuildConfig({
      schemaVersion: 1,
      prewarmWorldSeeds: ['42', '42'],
    })).toThrow(/unique/);
  });

  it('keeps every build-time horizon package bounded and every visual arm origin-ready', () => {
    expect(REGIONAL_BUILD_PREWARM_SPECS).toHaveLength(6);
    for (const spec of REGIONAL_BUILD_PREWARM_SPECS) {
      const width = spec.bounds.maxX - spec.bounds.minX + 1;
      const height = spec.bounds.maxY - spec.bounds.minY + 1;
      expect(width * height, spec.id).toBeLessThanOrEqual(8192);
      if (spec.resolution === REGIONAL_ORIGIN_PREWARM.resolution) {
        expect(spec.bounds.minX, spec.id).toBeLessThanOrEqual(REGIONAL_ORIGIN_PREWARM.bounds.minX);
        expect(spec.bounds.minY, spec.id).toBeLessThanOrEqual(REGIONAL_ORIGIN_PREWARM.bounds.minY);
        expect(spec.bounds.maxX, spec.id).toBeGreaterThanOrEqual(REGIONAL_ORIGIN_PREWARM.bounds.maxX);
        expect(spec.bounds.maxY, spec.id).toBeGreaterThanOrEqual(REGIONAL_ORIGIN_PREWARM.bounds.maxY);
      }
    }
  });
});

function fixtureBundle(): RegionalRuntimePrewarmBundle {
  return {
    schemaVersion: 1,
    runtimeDigest,
    assetManifestDigest: manifestDigest,
    assetSourceDigest: sourceDigest,
    viewports: [fixtureViewport()],
  };
}

function fixtureViewport(): RegionalPackedPreparedViewport {
  return {
    version: 2,
    worldSeed: '42',
    bounds: { minX: -1, minY: -1, maxX: 0, maxY: 0 },
    resolution: 2,
    terrainRgba: new Uint8Array(64),
    terrainMaterial: new Uint8Array(16),
    terrainWalkable: new Uint8Array(4),
    overlayCoordinates: new Int32Array([0, 0]),
    overlayRgba: new Uint8Array(16),
    solid: new Uint8Array(4),
  };
}
