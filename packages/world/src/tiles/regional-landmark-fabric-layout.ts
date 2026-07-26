import type { BiomeFamily } from '../biomes/biome-world-field.js';

/** Continuous landmark-place ground derived from explicitly authored
 * focal footprints. The raster never inspects filenames or source pixels: the
 * manifest declares frontage axis, side, and entrance stations, while the
 * provider supplies the visible world-space bounds of each placed focal. */

export type RegionalLandmarkFabricAxis = 'north-south' | 'east-west';
export type RegionalLandmarkFabricConnectionMode = 'route-threshold' | 'internal-spine';

export interface RegionalLandmarkFocalFootprint {
  id: string;
  frontageAxis: RegionalLandmarkFabricAxis;
  compositionSide: -1 | 1;
  /** Authored access positions normalized along the visible frontage. */
  frontageStations: readonly number[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalLandmarkFabricLayoutConfig {
  id: string;
  materialFamily: BiomeFamily;
  siteX: number;
  siteY: number;
  seed: number;
  focals: readonly RegionalLandmarkFocalFootprint[];
  connectionMode?: RegionalLandmarkFabricConnectionMode;
}

export interface RegionalLandmarkFabricApron {
  id: string;
  role: 'threshold' | 'approach' | 'spine';
  axis: RegionalLandmarkFabricAxis;
  centreX: number;
  centreY: number;
  halfAlong: number;
  halfAcross: number;
  cornerRadius: number;
  phase: number;
  frontageCoordinate: number;
}

export interface RegionalLandmarkFabricBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface RegionalLandmarkFabricSpatialCell {
  apronIndices: number[];
}

export interface RegionalLandmarkFabricLayout {
  id: string;
  materialFamily: BiomeFamily;
  siteX: number;
  siteY: number;
  seed: number;
  connectionMode: RegionalLandmarkFabricConnectionMode;
  aprons: RegionalLandmarkFabricApron[];
  bounds: RegionalLandmarkFabricBounds;
  spatialIndex: ReadonlyMap<string, RegionalLandmarkFabricSpatialCell>;
}

export interface RegionalLandmarkFabricSample {
  pavingWeight: number;
  thresholdWeight: number;
  approachWeight: number;
  edgeWeight: number;
}

export interface RegionalLandmarkFabricCell {
  x: number;
  y: number;
}

/** Build small thresholds and narrow approaches only at manifest-authored
 * access stations. Focal sprites already contain their own edge paving; this
 * layer joins those real entrances to circulation without drawing a second
 * full-length sidewalk. Rounded world-space edges remain identical across
 * tiles, LODs, and cache order. */
export function buildRegionalLandmarkFabricLayout(
  config: RegionalLandmarkFabricLayoutConfig,
): RegionalLandmarkFabricLayout | null {
  const connectionMode = config.connectionMode ?? 'route-threshold';
  const aprons = config.focals.flatMap((focal, index) => (
    buildAprons(config, focal, index, connectionMode)
  ));
  if (connectionMode === 'internal-spine') {
    const spine = buildInternalSpine(config);
    if (spine) aprons.unshift(spine);
  }
  if (aprons.length === 0) return null;
  const feather = 0.32;
  const bounds = aprons.reduce<RegionalLandmarkFabricBounds>((result, apron) => {
    const extentX = apron.axis === 'north-south' ? apron.halfAcross : apron.halfAlong;
    const extentY = apron.axis === 'north-south' ? apron.halfAlong : apron.halfAcross;
    result.minX = Math.min(result.minX, apron.centreX - extentX - feather);
    result.minY = Math.min(result.minY, apron.centreY - extentY - feather);
    result.maxX = Math.max(result.maxX, apron.centreX + extentX + feather);
    result.maxY = Math.max(result.maxY, apron.centreY + extentY + feather);
    return result;
  }, {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  });
  return {
    id: config.id,
    materialFamily: config.materialFamily,
    siteX: config.siteX,
    siteY: config.siteY,
    seed: config.seed,
    connectionMode,
    aprons,
    bounds,
    spatialIndex: buildSpatialIndex(aprons),
  };
}

/** Sample continuous material weights at an arbitrary world-space point. */
export function sampleRegionalLandmarkFabricLayout(
  worldX: number,
  worldY: number,
  layout: RegionalLandmarkFabricLayout,
): RegionalLandmarkFabricSample {
  const spatial = layout.spatialIndex.get(`${Math.floor(worldX)},${Math.floor(worldY)}`);
  let pavingWeight = 0;
  let thresholdWeight = 0;
  let approachWeight = 0;
  let edgeWeight = 0;
  for (const index of spatial?.apronIndices ?? []) {
    const apron = layout.aprons[index]!;
    const localX = worldX - apron.centreX;
    const localY = worldY - apron.centreY;
    const along = apron.axis === 'north-south' ? localY : localX;
    const across = apron.axis === 'north-south' ? localX : localY;
    const edgeNoise = (
      Math.sin(worldX * 1.91 + worldY * 0.73 + apron.phase) * 0.045 +
      Math.sin(worldX * 0.47 - worldY * 1.37 + apron.phase * 0.61) * 0.035
    );
    const signedDistance = roundedBoxDistance(
      along,
      across,
      apron.halfAlong,
      apron.halfAcross,
      apron.cornerRadius,
    ) - edgeNoise;
    const candidatePaving = 1 - smoothstep(-0.06, 0.18, signedDistance);
    pavingWeight = Math.max(pavingWeight, candidatePaving);
    edgeWeight = Math.max(
      edgeWeight,
      (1 - smoothstep(0.025, 0.15, Math.abs(signedDistance))) * candidatePaving,
    );
    const absoluteFrontageDistance = Math.abs(
      (apron.axis === 'north-south' ? worldX : worldY) - apron.frontageCoordinate,
    );
    const alongFade = 1 - smoothstep(apron.halfAlong - 0.65, apron.halfAlong + 0.15, Math.abs(along));
    if (apron.role === 'threshold') {
      thresholdWeight = Math.max(
        thresholdWeight,
        Math.max(
          candidatePaving * 0.72,
          (1 - smoothstep(0.28, 1.15, absoluteFrontageDistance)) * alongFade * candidatePaving,
        ),
      );
    } else {
      approachWeight = Math.max(approachWeight, candidatePaving);
    }
  }
  return { pavingWeight, thresholdWeight, approachWeight, edgeWeight };
}

/** Conservative tile cover; exact opacity remains a per-pixel SDF sample. */
export function rasterizeRegionalLandmarkFabricLayout(
  layout: RegionalLandmarkFabricLayout,
): RegionalLandmarkFabricCell[] {
  return [...layout.spatialIndex.keys()].map((key) => {
    const [x, y] = key.split(',').map(Number) as [number, number];
    return { x, y };
  }).sort((a, b) => a.y - b.y || a.x - b.x);
}

function buildAprons(
  config: RegionalLandmarkFabricLayoutConfig,
  focal: RegionalLandmarkFocalFootprint,
  index: number,
  connectionMode: RegionalLandmarkFabricConnectionMode,
): RegionalLandmarkFabricApron[] {
  const width = focal.maxX - focal.minX;
  const height = focal.maxY - focal.minY;
  if (width < 1 || height < 1 || focal.frontageStations.length === 0) return [];
  const northSouth = focal.frontageAxis === 'north-south';
  const frontageCoordinate = northSouth
    ? focal.compositionSide > 0 ? focal.minX - 0.15 : focal.maxX + 0.15
    : focal.compositionSide > 0 ? focal.minY - 0.15 : focal.maxY + 0.15;
  const siteCoordinate = northSouth ? config.siteX : config.siteY;
  // Stop approaches just outside the protected arterial core. The underlying
  // route SDF owns the final join, so thresholds cannot repaint circulation.
  const coreEdge = connectionMode === 'internal-spine'
    ? siteCoordinate
    : siteCoordinate + focal.compositionSide * 1.35;
  const alongMinimum = northSouth ? focal.minY : focal.minX;
  const alongMaximum = northSouth ? focal.maxY : focal.maxX;
  const centreAlong = (alongMinimum + alongMaximum) / 2;
  const stationSpan = Math.max(0, (alongMaximum - alongMinimum) / 2 - 0.8);
  const approachStart = frontageCoordinate - focal.compositionSide * 0.42;
  const approachCentreAcross = (approachStart + coreEdge) / 2;
  const approachHalfAcross = Math.max(0.65, Math.abs(approachStart - coreEdge) / 2 + 0.06);
  const focalHash = hashString(focal.id);
  return focal.frontageStations.flatMap((station, stationIndex): RegionalLandmarkFabricApron[] => {
    const stationAlong = clamp(
      centreAlong + station * stationSpan,
      alongMinimum + 0.65,
      alongMaximum - 0.65,
    );
    const thresholdHalfAlong = 0.56 + hashUnit(
      config.seed ^ 0x39d1,
      focalHash,
      stationIndex,
    ) * 0.16;
    const thresholdInner = frontageCoordinate - focal.compositionSide * 0.48;
    const thresholdOuter = frontageCoordinate + focal.compositionSide * 0.16;
    const thresholdCentreAcross = (thresholdInner + thresholdOuter) / 2;
    const thresholdHalfAcross = Math.abs(thresholdOuter - thresholdInner) / 2;
    const phase = hashUnit(config.seed, index, focalHash ^ stationIndex) * Math.PI * 2;
    const threshold: RegionalLandmarkFabricApron = {
      id: `${config.id}:${focal.id}:threshold:${stationIndex}`,
      role: 'threshold',
      axis: focal.frontageAxis,
      centreX: northSouth ? thresholdCentreAcross : stationAlong,
      centreY: northSouth ? stationAlong : thresholdCentreAcross,
      halfAlong: thresholdHalfAlong,
      halfAcross: thresholdHalfAcross,
      cornerRadius: Math.min(thresholdHalfAlong * 0.56, thresholdHalfAcross * 0.72),
      phase,
      frontageCoordinate,
    };
    const approachHalfAlong = 0.25 + hashUnit(
      config.seed ^ 0x43d1,
      focalHash,
      stationIndex,
    ) * 0.1;
    const approach: RegionalLandmarkFabricApron = {
      id: `${config.id}:${focal.id}:approach:${stationIndex}`,
      role: 'approach',
      axis: focal.frontageAxis,
      centreX: northSouth ? approachCentreAcross : stationAlong,
      centreY: northSouth ? stationAlong : approachCentreAcross,
      halfAlong: approachHalfAlong,
      halfAcross: approachHalfAcross,
      cornerRadius: Math.min(approachHalfAlong * 0.88, approachHalfAcross * 0.24),
      phase: phase + 1.73,
      frontageCoordinate,
    };
    return [threshold, approach];
  });
}

/** Off-route places own a narrow internal circulation spine. It is derived
 * from the manifest-declared focal axis and visible footprints, so a grove,
 * farmstead, outcrop, or ruin reads as one place without pretending that a
 * regional road passes through it. */
function buildInternalSpine(
  config: RegionalLandmarkFabricLayoutConfig,
): RegionalLandmarkFabricApron | null {
  const axis = config.focals[0]?.frontageAxis;
  if (!axis) return null;
  const focals = config.focals.filter((focal) => focal.frontageAxis === axis);
  if (focals.length === 0) return null;
  const northSouth = axis === 'north-south';
  const siteAlong = northSouth ? config.siteY : config.siteX;
  const minimumAlong = Math.min(
    siteAlong - 3.25,
    ...focals.map((focal) => northSouth ? focal.minY : focal.minX),
  );
  const maximumAlong = Math.max(
    siteAlong + 3.25,
    ...focals.map((focal) => northSouth ? focal.maxY : focal.maxX),
  );
  const centreAlong = (minimumAlong + maximumAlong) * 0.5;
  const centreAcross = northSouth ? config.siteX : config.siteY;
  const halfAlong = Math.max(3.25, (maximumAlong - minimumAlong) * 0.5);
  const halfAcross = 0.38 + hashUnit(config.seed ^ 0x5a71, focals.length, 0) * 0.12;
  return {
    id: `${config.id}:internal-spine`,
    role: 'spine',
    axis,
    centreX: northSouth ? centreAcross : centreAlong,
    centreY: northSouth ? centreAlong : centreAcross,
    halfAlong,
    halfAcross,
    cornerRadius: Math.min(halfAcross * 0.82, 0.42),
    phase: hashUnit(config.seed ^ 0x6e31, focals.length, 1) * Math.PI * 2,
    frontageCoordinate: centreAcross,
  };
}

function buildSpatialIndex(
  aprons: readonly RegionalLandmarkFabricApron[],
): ReadonlyMap<string, RegionalLandmarkFabricSpatialCell> {
  const index = new Map<string, RegionalLandmarkFabricSpatialCell>();
  for (const [apronIndex, apron] of aprons.entries()) {
    const extentX = apron.axis === 'north-south' ? apron.halfAcross : apron.halfAlong;
    const extentY = apron.axis === 'north-south' ? apron.halfAlong : apron.halfAcross;
    for (let y = Math.floor(apron.centreY - extentY - 1);
      y <= Math.floor(apron.centreY + extentY + 1); y++) {
      for (let x = Math.floor(apron.centreX - extentX - 1);
        x <= Math.floor(apron.centreX + extentX + 1); x++) {
        const key = `${x},${y}`;
        const cell = index.get(key) ?? { apronIndices: [] };
        cell.apronIndices.push(apronIndex);
        index.set(key, cell);
      }
    }
  }
  return index;
}

function roundedBoxDistance(
  along: number,
  across: number,
  halfAlong: number,
  halfAcross: number,
  radius: number,
): number {
  const alongDelta = Math.abs(along) - Math.max(0, halfAlong - radius);
  const acrossDelta = Math.abs(across) - Math.max(0, halfAcross - radius);
  return Math.hypot(Math.max(alongDelta, 0), Math.max(acrossDelta, 0)) +
    Math.min(Math.max(alongDelta, acrossDelta), 0) - radius;
}

function smoothstep(minimum: number, maximum: number, value: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 0x01000193);
  }
  return hash >>> 0;
}

function hashUnit(seed: number, x: number, y: number): number {
  let hash = seed ^ Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 0x1_0000_0000;
}
