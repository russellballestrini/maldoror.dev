import type {
  BiomeFamily,
  ConstructedWaterwayDescriptor,
  ConstructedWaterwaySample,
} from '../biomes/biome-world-field.js';

export interface RegionalQuayLayoutConfig {
  id: string;
  waterway: ConstructedWaterwayDescriptor;
  materialFamily?: BiomeFamily;
  quayWidth?: number;
  frontageDepth?: number;
  progressRange?: readonly [number, number];
}

export interface RegionalQuayLayout {
  id: string;
  waterwayId: string;
  materialFamily: BiomeFamily;
  quayWidth: number;
  frontageDepth: number;
  progressRange: readonly [number, number];
  bounds: ConstructedWaterwayDescriptor['bounds'];
}

export interface RegionalQuayLayoutSample {
  quayWeight: number;
  watersideEdgeWeight: number;
  landsideEdgeWeight: number;
  frontageReserveWeight: number;
  bankSide: -1 | 1 | 0;
  progress: number;
}

/** A paired quay is a continuous dry offset of one authoritative waterway.
 * It does not change hydrology: the waterway's signed bank distance owns the
 * inner edge, while this layout owns only constructed circulation and the
 * reserved frontage band behind it. */
export function buildRegionalQuayLayout(config: RegionalQuayLayoutConfig): RegionalQuayLayout {
  const minimumProgress = clamp(config.progressRange?.[0] ?? 0.08, 0, 1);
  const maximumProgress = clamp(config.progressRange?.[1] ?? 0.94, 0, 1);
  if (maximumProgress - minimumProgress < 0.08) {
    throw new Error('Regional quay progress range is too short');
  }
  return {
    id: config.id,
    waterwayId: config.waterway.id,
    materialFamily: config.materialFamily ?? config.waterway.materialFamily,
    quayWidth: Math.max(1.15, config.quayWidth ?? 1.8),
    frontageDepth: Math.max(2.5, config.frontageDepth ?? 4.6),
    progressRange: [minimumProgress, maximumProgress],
    bounds: { ...config.waterway.bounds },
  };
}

export function sampleRegionalQuayLayout(
  waterway: ConstructedWaterwaySample | null,
  layout: RegionalQuayLayout,
): RegionalQuayLayoutSample {
  if (!waterway || waterway.id !== layout.waterwayId) return emptySample();
  const [minimumProgress, maximumProgress] = layout.progressRange;
  const progressFeather = Math.min(0.055, (maximumProgress - minimumProgress) * 0.2);
  const progressWeight = smoothstep(
    minimumProgress,
    minimumProgress + progressFeather,
    waterway.progress,
  ) * (1 - smoothstep(
    maximumProgress - progressFeather,
    maximumProgress,
    waterway.progress,
  ));
  if (progressWeight <= 0.0001) return emptySample(waterway);

  const distance = waterway.signedDistance;
  const dryBankWeight = smoothstep(-0.1, 0.08, distance);
  const quayOuterWeight = 1 - smoothstep(
    layout.quayWidth - 0.24,
    layout.quayWidth + 0.22,
    distance,
  );
  const quayWeight = progressWeight * dryBankWeight * quayOuterWeight;
  const watersideEdgeWeight = progressWeight *
    (1 - smoothstep(0.03, 0.28, Math.abs(distance - 0.035))) * dryBankWeight;
  const landsideEdgeWeight = progressWeight *
    (1 - smoothstep(0.04, 0.26, Math.abs(distance - layout.quayWidth))) * quayOuterWeight;
  const frontageReserveWeight = progressWeight * smoothstep(
    layout.quayWidth + 0.22,
    layout.quayWidth + 0.64,
    distance,
  ) * (1 - smoothstep(
    layout.quayWidth + layout.frontageDepth - 0.55,
    layout.quayWidth + layout.frontageDepth,
    distance,
  ));
  return {
    quayWeight,
    watersideEdgeWeight,
    landsideEdgeWeight,
    frontageReserveWeight,
    bankSide: waterway.bankSide,
    progress: waterway.progress,
  };
}

/** Conservative physical query for one world tile. The centre alone can miss
 * a curved 1.8-tile ribbon, so collision samples the same sub-cell footprint
 * that the raster compositor can visibly cover. */
export function regionalQuayCellIsWalkable(
  tileX: number,
  tileY: number,
  layout: RegionalQuayLayout,
  sampleWaterway: (worldX: number, worldY: number, id: string) => ConstructedWaterwaySample | null,
): boolean {
  for (const offsetY of [0.08, 0.5, 0.92]) {
    for (const offsetX of [0.08, 0.5, 0.92]) {
      const sample = sampleRegionalQuayLayout(
        sampleWaterway(tileX + offsetX, tileY + offsetY, layout.waterwayId),
        layout,
      );
      if (sample.quayWeight > 0.12) return true;
    }
  }
  return false;
}

function emptySample(waterway?: ConstructedWaterwaySample): RegionalQuayLayoutSample {
  return {
    quayWeight: 0,
    watersideEdgeWeight: 0,
    landsideEdgeWeight: 0,
    frontageReserveWeight: 0,
    bankSide: waterway?.bankSide ?? 0,
    progress: waterway?.progress ?? 0,
  };
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / Math.max(1e-9, maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
