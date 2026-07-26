export const REGIONAL_ORIGIN_PREWARM = {
  bounds: { minX: -20, minY: -20, maxX: 20, maxY: 20 },
  resolution: 12,
} as const;

/** A bounded cross-shaped arrival horizon covers the login frame plus a long
 * uninterrupted first walk in every movement direction. The narrow arms keep
 * each independently validated package below the provider's 8,192-cell wire
 * ceiling; the resolution-1 centre supplies authoritative inhabitant
 * collision without encoding display pixels. */
export const REGIONAL_BUILD_PREWARM_SPECS = [
  {
    id: 'arrival-visual-halo',
    bounds: { minX: -44, minY: -44, maxX: 44, maxY: 44 },
    resolution: 12,
  },
  {
    id: 'arrival-visual-east',
    bounds: { minX: -20, minY: -22, maxX: 160, maxY: 22 },
    resolution: 12,
  },
  {
    id: 'arrival-visual-west',
    bounds: { minX: -160, minY: -22, maxX: 20, maxY: 22 },
    resolution: 12,
  },
  {
    id: 'arrival-visual-north',
    bounds: { minX: -22, minY: -160, maxX: 22, maxY: 20 },
    resolution: 12,
  },
  {
    id: 'arrival-visual-south',
    bounds: { minX: -22, minY: -20, maxX: 22, maxY: 160 },
    resolution: 12,
  },
  {
    id: 'arrival-collision-halo',
    bounds: { minX: -44, minY: -44, maxX: 44, maxY: 44 },
    resolution: 1,
  },
] as const;

export interface RegionalRuntimeBuildConfig {
  schemaVersion: 1;
  prewarmWorldSeeds: string[];
}

/** Parse the declarative build-time world list. Other runtime seeds remain
 * valid and simply use the generator lane instead of a baked origin. */
export function parseRegionalRuntimeBuildConfig(value: unknown): RegionalRuntimeBuildConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Regional runtime build config must be an object');
  }
  const root = value as Record<string, unknown>;
  if (root.schemaVersion !== 1) {
    throw new Error('Regional runtime build config schema must be 1');
  }
  if (!Array.isArray(root.prewarmWorldSeeds) || root.prewarmWorldSeeds.length === 0) {
    throw new Error('Regional runtime build config needs at least one prewarm world seed');
  }
  if (root.prewarmWorldSeeds.length > 16) {
    throw new Error('Regional runtime build config has too many prewarm world seeds');
  }
  const seeds = root.prewarmWorldSeeds.map((entry, index) => {
    if (typeof entry !== 'string' || !/^[0-9]+$/.test(entry)) {
      throw new Error(`Regional runtime prewarm seed ${index} must be an unsigned integer string`);
    }
    return entry;
  });
  if (new Set(seeds).size !== seeds.length) {
    throw new Error('Regional runtime prewarm world seeds must be unique');
  }
  return { schemaVersion: 1, prewarmWorldSeeds: seeds };
}
