import FastNoiseLite from 'fastnoise-lite';
import { spatialHash2DUnit } from '../spatial-hash.js';

export const BIOME_FAMILIES = [
  'canal-town',
  'forest',
  'coast',
  'rural',
  'mountain',
  'ruins',
] as const;

export type BiomeFamily = typeof BIOME_FAMILIES[number];
export type BiomeWeights = readonly [number, number, number, number, number, number];
export const REGIONAL_BASIN_SIZE = 112;

export interface BiomeWorldSample {
  weights: BiomeWeights;
  primary: BiomeFamily;
  ecologicalPrimary: Exclude<BiomeFamily, 'canal-town' | 'ruins'>;
  elevation: number;
  slope: number;
  waterDistance: number;
  isWater: boolean;
  isRiver: boolean;
}

export interface BiomePhysicalSample {
  elevation: number;
  slope: number;
  waterDistance: number;
  isWater: boolean;
  isRiver: boolean;
}

export interface ConstructedWaterwayBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Public geometric contract for a constructed waterway. Downstream place
 * layers consume this semantic centreline instead of rediscovering a canal
 * from raster colours or maintaining a second set of coordinates. */
export interface ConstructedWaterwayDescriptor {
  id: string;
  materialFamily: BiomeFamily;
  bounds: ConstructedWaterwayBounds;
}

export interface ConstructedWaterwaySample {
  id: string;
  progress: number;
  centreX: number;
  centreY: number;
  tangentX: number;
  tangentY: number;
  /** Unit normal pointing from the centreline toward the sampled bank. */
  bankNormalX: number;
  bankNormalY: number;
  bankSide: -1 | 1;
  halfWidth: number;
  /** Negative in water, zero at the bank, positive on adjacent dry ground. */
  signedDistance: number;
}

export interface BiomeWorldFieldConfig {
  blockSize?: number;
  maxCachedBlocks?: number;
  seaLevel?: number;
  filterHalo?: number;
}

interface PreparedNoise {
  noise: FastNoiseLite;
  angle: number;
}

interface RiverSegment {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  meanderAmplitude: number;
  meanderPhase: number;
}

interface DescriptorGrid {
  elevation: Float32Array;
  slope: Float32Array;
  river: Uint8Array;
  waterDistance: Float32Array;
}

interface CachedBlock {
  samples: BiomeWorldSample[];
  accessedAt: number;
}

const FAMILY_COUNT = BIOME_FAMILIES.length;
const CANAL_TOWN = 0;
const FOREST = 1;
const COAST = 2;
const MOUNTAIN = 4;
const RUINS = 5;
const ARRIVAL_CANAL: ConstructedWaterwayDescriptor = {
  id: 'arrival-canal',
  materialFamily: 'canal-town',
  bounds: { minX: -28, minY: -16, maxX: 42, maxY: 2 },
};
const CONSTRUCTED_WATERWAYS = [ARRIVAL_CANAL] as const;

/**
 * Deterministic regional geography expressed as continuous family weights.
 *
 * Physical descriptors (elevation, slope, hydrology and climate) produce four
 * ecological base families. Canal-town and ruins are cultural opportunity
 * layers, so a ruin can remain forested and a town can remain coastal instead
 * of erasing the underlying ecology. A halo surrounds every cached block before
 * filtering; neighbouring blocks therefore agree exactly at their boundary.
 */
export class BiomeWorldField {
  private readonly seed32: number;
  private readonly blockSize: number;
  private readonly maxCachedBlocks: number;
  private readonly seaLevel: number;
  private readonly filterHalo: number;
  private readonly cache = new Map<string, CachedBlock>();
  private readonly riverSegmentCache = new Map<string, RiverSegment[]>();
  private accessClock = 0;

  private readonly warpNoiseX: PreparedNoise;
  private readonly warpNoiseY: PreparedNoise;
  private readonly continentNoise: PreparedNoise;
  private readonly ridgeNoise: PreparedNoise;
  private readonly shelfNoise: PreparedNoise;
  private readonly temperatureNoise: PreparedNoise;
  private readonly regionalTemperatureNoise: PreparedNoise;
  private readonly moistureNoise: PreparedNoise;
  private readonly settlementNoise: PreparedNoise;
  private readonly ancientNoise: PreparedNoise;
  private readonly ancientRidgeNoise: PreparedNoise;

  constructor(worldSeed: bigint, config: BiomeWorldFieldConfig = {}) {
    this.seed32 = Number(BigInt.asUintN(32, worldSeed));
    this.blockSize = Math.max(16, config.blockSize ?? 32);
    this.maxCachedBlocks = Math.max(4, config.maxCachedBlocks ?? 48);
    this.seaLevel = clamp(config.seaLevel ?? 0.44);
    this.filterHalo = Math.max(10, config.filterHalo ?? 12);
    this.warpNoiseX = this.makeNoise(0x391a, 1 / 118, 'FBm', 3, 0.23);
    this.warpNoiseY = this.makeNoise(0x75b1, 1 / 131, 'FBm', 3, -0.51);
    this.continentNoise = this.makeNoise(0x1b63, 1 / 194, 'FBm', 5, 0.12);
    this.ridgeNoise = this.makeNoise(0x8d27, 1 / 92, 'Ridged', 4, 0.71);
    this.shelfNoise = this.makeNoise(0xc241, 1 / 330, 'FBm', 3, -0.33);
    this.temperatureNoise = this.makeNoise(0x16f3, 1 / 155, 'FBm', 4, 0.55);
    this.regionalTemperatureNoise = this.makeNoise(0xd317, 1 / 920, 'FBm', 4, -0.18);
    this.moistureNoise = this.makeNoise(0x9271, 1 / 128, 'FBm', 5, -0.47);
    this.settlementNoise = this.makeNoise(0x53c7, 1 / 78, 'FBm', 4, 0.88);
    this.ancientNoise = this.makeNoise(0xb591, 1 / 61, 'FBm', 4, 0.2);
    this.ancientRidgeNoise = this.makeNoise(0x31e9, 1 / 38, 'Ridged', 3, -0.75);
  }

  sample(worldX: number, worldY: number): BiomeWorldSample {
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    const blockX = floorDiv(tileX, this.blockSize);
    const blockY = floorDiv(tileY, this.blockSize);
    const block = this.getBlock(blockX, blockY);
    const localX = tileX - blockX * this.blockSize;
    const localY = tileY - blockY * this.blockSize;
    return block.samples[gridIndex(localX, localY, this.blockSize)]!;
  }

  /** Cheap physical lane for pathfinding and other sparse world queries.
   * It bypasses the six-family filtering/composition block while preserving
   * the exact elevation and hydrology functions used by the full field. */
  samplePhysical(worldX: number, worldY: number): BiomePhysicalSample {
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    const elevation = this.elevationAt(tileX, tileY);
    const slope = Math.max(
      Math.abs(this.elevationAt(tileX - 1, tileY) - this.elevationAt(tileX + 1, tileY)) / 2,
      Math.abs(this.elevationAt(tileX, tileY - 1) - this.elevationAt(tileX, tileY + 1)) / 2,
    );
    const riverDistance = this.distanceToHydrology(
      tileX,
      tileY,
      this.riverSegmentsAt(tileX, tileY),
    );
    const coastDistance = elevation <= this.seaLevel
      ? 0
      : (elevation - this.seaLevel) / Math.max(0.0025, slope);
    const isRiver = riverDistance <= 0 && elevation > this.seaLevel;
    return {
      elevation,
      slope,
      waterDistance: Math.min(coastDistance, Math.max(0, riverDistance)),
      isWater: elevation <= this.seaLevel || isRiver,
      isRiver,
    };
  }

  getConstructedWaterways(): readonly ConstructedWaterwayDescriptor[] {
    return CONSTRUCTED_WATERWAYS;
  }

  sampleConstructedWaterway(
    worldX: number,
    worldY: number,
    waterwayId = ARRIVAL_CANAL.id,
  ): ConstructedWaterwaySample | null {
    if (waterwayId !== ARRIVAL_CANAL.id) return null;
    return this.sampleArrivalCanal(worldX, worldY);
  }

  prewarm(minX: number, minY: number, maxX: number, maxY: number): void {
    const firstBlockX = floorDiv(Math.floor(minX), this.blockSize);
    const lastBlockX = floorDiv(Math.floor(maxX), this.blockSize);
    const firstBlockY = floorDiv(Math.floor(minY), this.blockSize);
    const lastBlockY = floorDiv(Math.floor(maxY), this.blockSize);
    for (let blockY = firstBlockY; blockY <= lastBlockY; blockY++) {
      for (let blockX = firstBlockX; blockX <= lastBlockX; blockX++) this.getBlock(blockX, blockY);
    }
  }

  getStats(): { cachedBlocks: number; maxCachedBlocks: number; blockSize: number } {
    return {
      cachedBlocks: this.cache.size,
      maxCachedBlocks: this.maxCachedBlocks,
      blockSize: this.blockSize,
    };
  }

  clear(): void {
    this.cache.clear();
    this.riverSegmentCache.clear();
  }

  private riverSegmentsAt(worldX: number, worldY: number): RiverSegment[] {
    const basinX = floorDiv(worldX, REGIONAL_BASIN_SIZE);
    const basinY = floorDiv(worldY, REGIONAL_BASIN_SIZE);
    const key = `${basinX},${basinY}`;
    const cached = this.riverSegmentCache.get(key);
    if (cached) {
      this.riverSegmentCache.delete(key);
      this.riverSegmentCache.set(key, cached);
      return cached;
    }
    const originX = (basinX - 1) * REGIONAL_BASIN_SIZE;
    const originY = (basinY - 1) * REGIONAL_BASIN_SIZE;
    const segments = this.buildRiverSegments(
      originX,
      originY,
      REGIONAL_BASIN_SIZE * 3,
      REGIONAL_BASIN_SIZE * 3,
    );
    this.riverSegmentCache.set(key, segments);
    while (this.riverSegmentCache.size > 128) {
      const oldest = this.riverSegmentCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.riverSegmentCache.delete(oldest);
    }
    return segments;
  }

  private getBlock(blockX: number, blockY: number): CachedBlock {
    const key = `${blockX},${blockY}`;
    const cached = this.cache.get(key);
    if (cached) {
      cached.accessedAt = ++this.accessClock;
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const block = this.buildBlock(blockX, blockY);
    this.cache.set(key, block);
    while (this.cache.size > this.maxCachedBlocks) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return block;
  }

  private buildBlock(blockX: number, blockY: number): CachedBlock {
    const originX = blockX * this.blockSize;
    const originY = blockY * this.blockSize;
    const paddedOriginX = originX - this.filterHalo;
    const paddedOriginY = originY - this.filterHalo;
    const paddedSize = this.blockSize + this.filterHalo * 2;
    const descriptors = this.buildDescriptors(paddedOriginX, paddedOriginY, paddedSize, paddedSize);
    const raw = this.buildRawWeights(
      descriptors,
      paddedOriginX,
      paddedOriginY,
      paddedSize,
      paddedSize,
    );
    const smooth = this.smoothWeights(raw, paddedSize, paddedSize);
    const samples: BiomeWorldSample[] = [];
    for (let localY = 0; localY < this.blockSize; localY++) {
      for (let localX = 0; localX < this.blockSize; localX++) {
        const paddedIndex = gridIndex(
          localX + this.filterHalo,
          localY + this.filterHalo,
          paddedSize,
        );
        const smoothed = smooth[paddedIndex]!;
        const weights: BiomeWeights = [
          smoothed[0]!,
          smoothed[1]!,
          smoothed[2]!,
          smoothed[3]!,
          smoothed[4]!,
          smoothed[5]!,
        ];
        const primaryIndex = winningIndex(weights, 0, FAMILY_COUNT);
        const ecologicalIndex = winningIndex(weights, FOREST, MOUNTAIN + 1);
        samples.push({
          weights,
          primary: BIOME_FAMILIES[primaryIndex]!,
          ecologicalPrimary: BIOME_FAMILIES[ecologicalIndex] as BiomeWorldSample['ecologicalPrimary'],
          elevation: descriptors.elevation[paddedIndex]!,
          slope: descriptors.slope[paddedIndex]!,
          waterDistance: descriptors.waterDistance[paddedIndex]!,
          isWater: descriptors.elevation[paddedIndex]! <= this.seaLevel || descriptors.river[paddedIndex] === 1,
          isRiver: descriptors.river[paddedIndex] === 1,
        });
      }
    }
    return { samples, accessedAt: ++this.accessClock };
  }

  private buildDescriptors(originX: number, originY: number, width: number, height: number): DescriptorGrid {
    const size = width * height;
    const elevation = new Float32Array(size);
    const slope = new Float32Array(size);
    const river = new Uint8Array(size);
    const waterDistance = new Float32Array(size);
    const segments = this.buildRiverSegments(originX, originY, width, height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const worldX = originX + x;
        const worldY = originY + y;
        const index = gridIndex(x, y, width);
        const elevationHere = this.elevationAt(worldX, worldY);
        const slopeHere = Math.max(
          Math.abs(this.elevationAt(worldX - 1, worldY) - this.elevationAt(worldX + 1, worldY)) / 2,
          Math.abs(this.elevationAt(worldX, worldY - 1) - this.elevationAt(worldX, worldY + 1)) / 2,
        );
        const riverDistance = this.distanceToHydrology(worldX, worldY, segments);
        const coastDistance = elevationHere <= this.seaLevel
          ? 0
          : (elevationHere - this.seaLevel) / Math.max(0.0025, slopeHere);
        elevation[index] = elevationHere;
        slope[index] = slopeHere;
        river[index] = riverDistance <= 0 && elevationHere > this.seaLevel ? 1 : 0;
        waterDistance[index] = Math.min(coastDistance, Math.max(0, riverDistance));
      }
    }
    return { elevation, slope, river, waterDistance };
  }

  private buildRawWeights(
    descriptors: DescriptorGrid,
    originX: number,
    originY: number,
    width: number,
    height: number,
  ): number[][] {
    const weights = new Array<number[]>(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const worldX = originX + x;
        const worldY = originY + y;
        const index = gridIndex(x, y, width);
        const elevation = descriptors.elevation[index]!;
        const slope = descriptors.slope[index]!;
        const distance = descriptors.waterDistance[index]!;
        const land = smoothstep(this.seaLevel - 0.015, this.seaLevel + 0.025, elevation);
        const riverWater = descriptors.river[index] ? 1 : 0;
        const dryLand = land * (1 - riverWater);
        const water = Math.max(1 - land, riverWater);
        const temperature = clamp(
          0.35 + this.noise01(this.regionalTemperatureNoise, worldX, worldY) * 0.52 -
          elevation * 0.32 + (this.noise01(this.temperatureNoise, worldX, worldY) - 0.5) * 0.18,
        );
        const waterInfluence = Math.exp(-distance / 17);
        const moisture = clamp(
          0.12 + this.noise01(this.moistureNoise, worldX, worldY) * 0.56 +
          waterInfluence * 0.42 - elevation * 0.12,
        );
        const accessibility = dryLand * (1 - smoothstep(0.018, 0.09, slope));
        const settlementField = this.noise01(this.settlementNoise, worldX, worldY);
        const ancientField = this.noise01(this.ancientNoise, worldX, worldY) * 0.68 +
          this.noise01(this.ancientRidgeNoise, worldX, worldY) * 0.32;
        const temperate = gaussian(temperature, 0.58, 0.23);
        const shoreBand = gaussian(distance, 5.4, 5.1);
        // The exact origin is a composed arrival district, not a radial paint
        // stamp. Three overlapping anisotropic lobes imply a hub, quay, and
        // ward aligned to different travel axes; their smooth union has no
        // circular cutoff for overview art to expose as a "root ring".
        let arrival = 0;
        if (Math.abs(worldX) <= 96 && Math.abs(worldY) <= 96) {
          const arrivalHub = orientedGaussian(worldX, worldY, 0, 0, 18, 12, 0.28);
          const arrivalQuay = orientedGaussian(worldX, worldY, 10, -7, 36, 7, -0.48) * 0.82;
          const arrivalWard = orientedGaussian(worldX, worldY, -9, 11, 11, 29, 0.76) * 0.76;
          const arrivalUnion = 1 - (1 - arrivalHub) * (1 - arrivalQuay) * (1 - arrivalWard);
          arrival = Math.pow(arrivalUnion, 2.4);
        }
        const raw = [
          accessibility * shoreBand * smoothstep(0.47, 0.70, settlementField) * temperate * 2.28 + arrival * 8,
          dryLand * smoothstep(0.34, 0.69, moisture) * temperate *
            (1 - smoothstep(0.72, 0.86, elevation)) * 1.62,
          water * 2.8 + dryLand * waterInfluence * (0.34 + moisture * 0.46),
          accessibility * gaussian(moisture, 0.5, 0.24) * temperate *
            (0.52 + (1 - settlementField) * 0.34) * (1 - water * 0.9),
          dryLand * (
            smoothstep(0.585, 0.715, elevation) * 1.8 +
            smoothstep(0.011, 0.032, slope) * 0.86
          ),
          dryLand * smoothstep(0.52, 0.72, ancientField) *
            (0.50 + smoothstep(0.011, 0.032, slope) * 0.36 + waterInfluence * 0.22) * 1.92,
        ].map((value) => Math.pow(value + 0.025, 2.65));
        const total = raw.reduce((sum, value) => sum + value, 0);
        weights[index] = raw.map((value) => value / total);
      }
    }
    return weights;
  }

  private smoothWeights(weights: number[][], width: number, height: number): number[][] {
    const byFamily = Array.from({ length: FAMILY_COUNT }, (_, family) => {
      const field = Float32Array.from(weights, (cell) => cell[family]!);
      const radius = family === CANAL_TOWN || family === RUINS ? 2 : family === COAST ? 3 : 5;
      return blurField(blurField(field, radius, width, height), radius, width, height);
    });
    return Array.from({ length: width * height }, (_, index) => {
      const sharpened = byFamily.map((field) => Math.pow(Math.max(1e-7, field[index]!), 1.55));
      const total = sharpened.reduce((sum, value) => sum + value, 0);
      return sharpened.map((value) => value / total);
    });
  }

  private elevationAt(x: number, y: number): number {
    const warpX = this.sampleNoise(this.warpNoiseX, x, y) * 74;
    const warpY = this.sampleNoise(this.warpNoiseY, x, y) * 62;
    const warpedX = x + warpX;
    const warpedY = y + warpY;
    const continent = this.noise01(this.continentNoise, warpedX, warpedY);
    const ridge = this.noise01(this.ridgeNoise, warpedX, warpedY);
    const broadShelf = this.noise01(this.shelfNoise, x + warpX * 0.3, y + warpY * 0.3);
    return clamp(continent * 0.61 + ridge * 0.23 + broadShelf * 0.16);
  }

  private buildRiverSegments(originX: number, originY: number, width: number, height: number): RiverSegment[] {
    const firstCellX = Math.floor(originX / REGIONAL_BASIN_SIZE) - 3;
    const lastCellX = Math.floor((originX + width - 1) / REGIONAL_BASIN_SIZE) + 3;
    const firstCellY = Math.floor(originY / REGIONAL_BASIN_SIZE) - 3;
    const lastCellY = Math.floor((originY + height - 1) / REGIONAL_BASIN_SIZE) + 3;
    const nodes = new Map<string, ReturnType<BiomeWorldField['basinNode']>>();
    const nodeFor = (cellX: number, cellY: number) => {
      const key = `${cellX},${cellY}`;
      let node = nodes.get(key);
      if (!node) {
        node = this.basinNode(cellX, cellY);
        nodes.set(key, node);
      }
      return node;
    };
    const rawSegments: Array<{ start: ReturnType<BiomeWorldField['basinNode']>; receiver: ReturnType<BiomeWorldField['basinNode']> }> = [];
    for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
        const start = nodeFor(cellX, cellY);
        if (start.elevation <= this.seaLevel + 0.025) continue;
        let receiver: ReturnType<BiomeWorldField['basinNode']> | null = null;
        for (let offsetY = -1; offsetY <= 1; offsetY++) {
          for (let offsetX = -1; offsetX <= 1; offsetX++) {
            if (offsetX === 0 && offsetY === 0) continue;
            const candidate = nodeFor(cellX + offsetX, cellY + offsetY);
            if (candidate.elevation >= start.elevation - 0.002) continue;
            if (!receiver || candidate.elevation < receiver.elevation) receiver = candidate;
          }
        }
        if (receiver) rawSegments.push({ start, receiver });
      }
    }
    const incoming = new Map<string, number>();
    for (const segment of rawSegments) {
      const key = `${segment.receiver.cellX},${segment.receiver.cellY}`;
      incoming.set(key, (incoming.get(key) ?? 0) + 1);
    }
    return rawSegments.map((segment) => {
      const dx = segment.receiver.x - segment.start.x;
      const dy = segment.receiver.y - segment.start.y;
      const length = Math.max(1, Math.hypot(dx, dy));
      const bendSign = this.hashUnit(segment.start.cellX, segment.start.cellY, 0x6c2f) < 0.5 ? -1 : 1;
      const bend = bendSign * length * (
        0.08 + this.hashUnit(segment.start.cellX, segment.start.cellY, 0x17b9) * 0.17
      );
      const receiverKey = `${segment.receiver.cellX},${segment.receiver.cellY}`;
      return {
        x0: segment.start.x,
        y0: segment.start.y,
        x1: (segment.start.x + segment.receiver.x) / 2 - dy / length * bend,
        y1: (segment.start.y + segment.receiver.y) / 2 + dx / length * bend,
        x2: segment.receiver.x,
        y2: segment.receiver.y,
        width: 0.8 + Math.sqrt(incoming.get(receiverKey) ?? 1) * 0.48,
        meanderAmplitude: 2.4 + this.hashUnit(segment.start.cellX, segment.start.cellY, 0x8a73) * 5.2,
        meanderPhase: this.hashUnit(segment.start.cellX, segment.start.cellY, 0x214d) * Math.PI * 2,
      };
    });
  }

  private basinNode(cellX: number, cellY: number): { cellX: number; cellY: number; x: number; y: number; elevation: number } {
    const x = (cellX + 0.16 + this.hashUnit(cellX, cellY, 0x4137) * 0.68) * REGIONAL_BASIN_SIZE;
    const y = (cellY + 0.16 + this.hashUnit(cellX, cellY, 0x97c1) * 0.68) * REGIONAL_BASIN_SIZE;
    return { cellX, cellY, x, y, elevation: this.elevationAt(x, y) };
  }

  private distanceToRiver(worldX: number, worldY: number, segments: RiverSegment[]): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const segment of segments) {
      const bounds = 14 + segment.width + segment.meanderAmplitude;
      if (worldX < Math.min(segment.x0, segment.x1, segment.x2) - bounds ||
          worldX > Math.max(segment.x0, segment.x1, segment.x2) + bounds ||
          worldY < Math.min(segment.y0, segment.y1, segment.y2) - bounds ||
          worldY > Math.max(segment.y0, segment.y1, segment.y2) + bounds) continue;
      let previousX = segment.x0;
      let previousY = segment.y0;
      for (let step = 1; step <= 24; step++) {
        const t = step / 24;
        const inverse = 1 - t;
        const baseX = inverse * inverse * segment.x0 + 2 * inverse * t * segment.x1 + t * t * segment.x2;
        const baseY = inverse * inverse * segment.y0 + 2 * inverse * t * segment.y1 + t * t * segment.y2;
        const tangentX = 2 * inverse * (segment.x1 - segment.x0) + 2 * t * (segment.x2 - segment.x1);
        const tangentY = 2 * inverse * (segment.y1 - segment.y0) + 2 * t * (segment.y2 - segment.y1);
        const tangentLength = Math.max(1e-6, Math.hypot(tangentX, tangentY));
        const endpointEnvelope = Math.sin(Math.PI * t);
        const offset = endpointEnvelope * segment.meanderAmplitude * (
          Math.sin(Math.PI * 2 * t + segment.meanderPhase) * 0.72 +
          Math.sin(Math.PI * 5 * t - segment.meanderPhase * 0.63) * 0.28
        );
        const x = baseX - tangentY / tangentLength * offset;
        const y = baseY + tangentX / tangentLength * offset;
        nearest = Math.min(nearest, segmentDistance(worldX, worldY, previousX, previousY, x, y) - segment.width);
        previousX = x;
        previousY = y;
      }
    }
    return nearest;
  }

  /** Fold the singular arrival's constructed inlet into the same signed
   * hydrology answer as natural rivers. The western coast already reaches the
   * district edge; this bounded canal continues that water into the civic
   * fabric, bends around the dry spawn, and terminates in a working basin.
   * Terrain, route solving, collision, crossing classification, and rendering
   * therefore agree that it is water instead of treating it as decoration. */
  private distanceToHydrology(
    worldX: number,
    worldY: number,
    segments: RiverSegment[],
  ): number {
    return Math.min(
      this.distanceToRiver(worldX, worldY, segments),
      this.distanceToArrivalCanal(worldX, worldY),
    );
  }

  /** Signed distance to a finite quadratic canal centreline. A varying width
   * creates a narrow neck at the sea, a readable route crossing, and a rounder
   * terminal basin without a rectangular stamp or coordinate-grid seam. */
  private distanceToArrivalCanal(worldX: number, worldY: number): number {
    return this.sampleArrivalCanal(worldX, worldY)?.signedDistance ?? Number.POSITIVE_INFINITY;
  }

  private sampleArrivalCanal(worldX: number, worldY: number): ConstructedWaterwaySample | null {
    const { bounds } = ARRIVAL_CANAL;
    if (worldX < bounds.minX || worldX > bounds.maxX ||
        worldY < bounds.minY || worldY > bounds.maxY) return null;
    const startX = -24;
    const startY = -7;
    const controlX = -4;
    const controlY = -2.8;
    const endX = 36;
    const endY = -9;
    let nearestDistance = Number.POSITIVE_INFINITY;
    let nearestProgress = 0;
    let nearestX = startX;
    let nearestY = startY;
    let nearestTangentX = 1;
    let nearestTangentY = 0;
    let previousX = startX;
    let previousY = startY;
    let previousProgress = 0;
    for (let step = 1; step <= 32; step++) {
      const t = step / 32;
      const inverse = 1 - t;
      const x = inverse * inverse * startX + 2 * inverse * t * controlX + t * t * endX;
      const y = inverse * inverse * startY + 2 * inverse * t * controlY + t * t * endY;
      const dx = x - previousX;
      const dy = y - previousY;
      const lengthSquared = dx * dx + dy * dy;
      const projection = lengthSquared > 0
        ? clamp(((worldX - previousX) * dx + (worldY - previousY) * dy) / lengthSquared)
        : 0;
      const projectedX = previousX + dx * projection;
      const projectedY = previousY + dy * projection;
      const distance = Math.hypot(worldX - projectedX, worldY - projectedY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestProgress = previousProgress + (t - previousProgress) * projection;
        nearestX = projectedX;
        nearestY = projectedY;
        const tangentLength = Math.max(1e-9, Math.hypot(dx, dy));
        nearestTangentX = dx / tangentLength;
        nearestTangentY = dy / tangentLength;
      }
      previousX = x;
      previousY = y;
      previousProgress = t;
    }
    const halfWidth = arrivalCanalHalfWidth(nearestProgress);
    const cross = nearestTangentX * (worldY - nearestY) -
      nearestTangentY * (worldX - nearestX);
    const bankSide: -1 | 1 = cross < 0 ? -1 : 1;
    return {
      id: ARRIVAL_CANAL.id,
      progress: nearestProgress,
      centreX: nearestX,
      centreY: nearestY,
      tangentX: nearestTangentX,
      tangentY: nearestTangentY,
      bankNormalX: -nearestTangentY * bankSide,
      bankNormalY: nearestTangentX * bankSide,
      bankSide,
      halfWidth,
      signedDistance: nearestDistance - halfWidth,
    };
  }

  private makeNoise(
    seedOffset: number,
    frequency: number,
    fractalType: 'FBm' | 'Ridged',
    octaves: number,
    angle: number,
  ): PreparedNoise {
    const noise = new FastNoiseLite((this.seed32 + seedOffset) | 0);
    noise.SetNoiseType(FastNoiseLite.NoiseType.OpenSimplex2S);
    noise.SetFrequency(frequency);
    noise.SetFractalType(FastNoiseLite.FractalType[fractalType]);
    noise.SetFractalOctaves(octaves);
    noise.SetFractalLacunarity(2.03);
    noise.SetFractalGain(0.5);
    return { noise, angle };
  }

  private sampleNoise(prepared: PreparedNoise, x: number, y: number): number {
    const cosine = Math.cos(prepared.angle);
    const sine = Math.sin(prepared.angle);
    return prepared.noise.GetNoise(x * cosine - y * sine, x * sine + y * cosine);
  }

  private noise01(prepared: PreparedNoise, x: number, y: number): number {
    return this.sampleNoise(prepared, x, y) * 0.5 + 0.5;
  }

  private hashUnit(x: number, y: number, salt: number): number {
    return spatialHash2DUnit(this.seed32, x, y, salt);
  }

}

function blurField(source: Float32Array, radius: number, width: number, height: number): Float32Array {
  const horizontal = new Float32Array(source.length);
  const output = new Float32Array(source.length);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += source[gridIndex(clampInt(x, 0, width - 1), y, width)]!;
    for (let x = 0; x < width; x++) {
      horizontal[gridIndex(x, y, width)] = sum / (radius * 2 + 1);
      sum -= source[gridIndex(clampInt(x - radius, 0, width - 1), y, width)]!;
      sum += source[gridIndex(clampInt(x + radius + 1, 0, width - 1), y, width)]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += horizontal[gridIndex(x, clampInt(y, 0, height - 1), width)]!;
    for (let y = 0; y < height; y++) {
      output[gridIndex(x, y, width)] = sum / (radius * 2 + 1);
      sum -= horizontal[gridIndex(x, clampInt(y - radius, 0, height - 1), width)]!;
      sum += horizontal[gridIndex(x, clampInt(y + radius + 1, 0, height - 1), width)]!;
    }
  }
  return output;
}

function winningIndex(weights: readonly number[], start: number, end: number): number {
  let winner = start;
  for (let index = start + 1; index < end; index++) if (weights[index]! > weights[winner]!) winner = index;
  return winner;
}

function segmentDistance(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  const projection = lengthSquared > 0 ? clamp(((px - x0) * dx + (py - y0) * dy) / lengthSquared) : 0;
  return Math.hypot(px - (x0 + dx * projection), py - (y0 + dy * projection));
}

function arrivalCanalHalfWidth(progress: number): number {
  return 2.18 + Math.sin(Math.PI * progress) * 0.34 +
    smoothstep(0.78, 1, progress) * 0.54;
}

function gaussian(value: number, centre: number, spread: number): number {
  return Math.exp(-((value - centre) ** 2) / (2 * spread ** 2));
}

function orientedGaussian(
  x: number,
  y: number,
  centreX: number,
  centreY: number,
  spreadX: number,
  spreadY: number,
  angle: number,
): number {
  const translatedX = x - centreX;
  const translatedY = y - centreY;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const localX = translatedX * cosine - translatedY * sine;
  const localY = translatedX * sine + translatedY * cosine;
  return Math.exp(-0.5 * ((localX / spreadX) ** 2 + (localY / spreadY) ** 2));
}

function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / Math.max(1e-9, high - low));
  return t * t * (3 - 2 * t);
}

function clamp(value: number, low = 0, high = 1): number {
  return Math.max(low, Math.min(high, value));
}

function clampInt(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, Math.trunc(value)));
}

function floorDiv(value: number, divisor: number): number {
  return Math.floor(value / divisor);
}

function gridIndex(x: number, y: number, width: number): number {
  return y * width + x;
}
