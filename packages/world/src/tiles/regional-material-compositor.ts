import type { MaterialMask, PixelGrid, RGB, Tile } from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldSample,
} from '../biomes/biome-world-field.js';
import type {
  RegionalCrossingKind,
  RegionalRouteKind,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';

export interface BiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
}

export interface RegionalRouteSampler {
  sample(worldX: number, worldY: number): RegionalRouteSample;
}

export interface RegionalMaterialCompositorConfig {
  worldSeed: bigint;
  field: BiomeSampler;
  materials: Readonly<Record<BiomeFamily, readonly Tile[]>>;
  routes?: RegionalRouteSampler;
  routeMaterials?: Readonly<Record<RegionalRouteKind, readonly Tile[]>>;
  crossingMaterials?: Readonly<Partial<Record<RegionalCrossingKind, readonly Tile[]>>>;
  maxCachedTiles?: number;
  variantPeriodTiles?: number;
  /** World-tile span of one complete source texture. Values above one prevent
   * the source master from becoming a visible stamp on every terrain tile. */
  textureScaleTiles?: number;
}

interface PreparedTextureLevel {
  width: number;
  height: number;
  linear: Float32Array;
}

interface PreparedTexture extends PreparedTextureLevel {
  levels: readonly PreparedTextureLevel[];
}

const FOREST = 1;
const COAST = 2;
const RURAL = 3;
const MOUNTAIN = 4;
const ROUTE_KINDS: readonly RegionalRouteKind[] = ['trail', 'local-road', 'arterial'];
const SEMANTIC_RESOLUTIONS = [4, 8, 16, 26, 51, 77, 102, 128, 154, 179, 205, 230, 256] as const;

/**
 * Continuous six-family material reconstruction in linear light.
 *
 * The four ecological families contribute the strongest two textures at each
 * pixel; canal-town and ruins are cultural overlays. This avoids the muddy
 * average produced by mixing all six equally while retaining broad ecotones.
 * Shared corner samples make every composed tile edge exactly agree with its
 * neighbour, independent of cache or traversal order.
 */
export class RegionalMaterialCompositor {
  private readonly seed32: number;
  private readonly field: BiomeSampler;
  private readonly routes?: RegionalRouteSampler;
  private readonly materials: Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
  private readonly routeMaterials?: Readonly<Record<RegionalRouteKind, readonly PreparedTexture[]>>;
  private readonly crossingMaterials?: Readonly<Partial<Record<RegionalCrossingKind, readonly PreparedTexture[]>>>;
  private readonly maxCachedTiles: number;
  private readonly variantPeriodTiles: number;
  private readonly textureScaleTiles: number;
  private readonly sourceSize: number;
  private readonly cache = new Map<string, Tile>();

  constructor(config: RegionalMaterialCompositorConfig) {
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.routes = config.routes;
    this.maxCachedTiles = Math.max(8, config.maxCachedTiles ?? 128);
    this.variantPeriodTiles = Math.max(2, config.variantPeriodTiles ?? 5);
    this.textureScaleTiles = Math.max(2, config.textureScaleTiles ?? 7);
    this.materials = Object.fromEntries(BIOME_FAMILIES.map((family) => {
      const sources = config.materials[family];
      if (sources.length === 0) throw new Error(`Regional material family is empty: ${family}`);
      return [family, sources.map(prepareTexture)];
    })) as unknown as Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
    if (Boolean(config.routes) !== Boolean(config.routeMaterials)) {
      throw new Error('Regional routes and route materials must be configured together');
    }
    if (config.routeMaterials) {
      this.routeMaterials = Object.fromEntries(ROUTE_KINDS.map((kind) => {
        const sources = config.routeMaterials![kind];
        if (sources.length === 0) throw new Error(`Regional route material kind is empty: ${kind}`);
        return [kind, sources.map(prepareTexture)];
      })) as unknown as Readonly<Record<RegionalRouteKind, readonly PreparedTexture[]>>;
    }
    if (config.crossingMaterials) {
      this.crossingMaterials = Object.fromEntries(Object.entries(config.crossingMaterials).map(([kind, sources]) => [
        kind,
        sources?.map(prepareTexture),
      ])) as Readonly<Partial<Record<RegionalCrossingKind, readonly PreparedTexture[]>>>;
    }
    const prepared = [
      ...BIOME_FAMILIES.flatMap((family) => this.materials[family]),
      ...ROUTE_KINDS.flatMap((kind) => this.routeMaterials?.[kind] ?? []),
      ...Object.values(this.crossingMaterials ?? {}).flatMap((textures) => textures ?? []),
    ];
    this.sourceSize = Math.min(...prepared.flatMap((texture) => [texture.width, texture.height]));
    if (this.sourceSize === 0) throw new Error('Regional material textures cannot be empty');
  }

  getTile(tileX: number, tileY: number): Tile {
    return this.getTileAtResolution(tileX, tileY, this.sourceSize);
  }

  /**
   * Compose only the semantic LOD the screen can consume. The requested size
   * is quantized so animated zoom does not create a new full world cache on
   * every intermediate frame.
   */
  getTileAtResolution(tileX: number, tileY: number, requestedResolution: number): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `${tileX},${tileY}@${resolution}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const tile = this.composeTile(tileX, tileY, resolution);
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  getStats(): { cachedTiles: number; maxCachedTiles: number; sourceSize: number } {
    return { cachedTiles: this.cache.size, maxCachedTiles: this.maxCachedTiles, sourceSize: this.sourceSize };
  }

  clear(): void {
    this.cache.clear();
  }

  private selectResolution(requestedResolution: number): number {
    const requested = Math.max(1, Math.min(this.sourceSize, Math.round(requestedResolution)));
    return SEMANTIC_RESOLUTIONS.find((resolution) => (
      resolution >= requested && resolution < this.sourceSize
    )) ?? this.sourceSize;
  }

  private textureScaleForResolution(resolution: number): number {
    if (resolution <= 4) return 2;
    if (resolution <= 8) return Math.min(4, this.textureScaleTiles);
    return this.textureScaleTiles;
  }

  private composeTile(tileX: number, tileY: number, resolution: number): Tile {
    const samples = [
      this.field.sample(tileX, tileY),
      this.field.sample(tileX + 1, tileY),
      this.field.sample(tileX, tileY + 1),
      this.field.sample(tileX + 1, tileY + 1),
    ] as const;
    const routeSamples = this.routes ? [
      this.routes.sample(tileX, tileY),
      this.routes.sample(tileX + 1, tileY),
      this.routes.sample(tileX, tileY + 1),
      this.routes.sample(tileX + 1, tileY + 1),
    ] as const : null;
    const composed = this.composeGrid(
      tileX,
      tileY,
      resolution,
      this.textureScaleForResolution(resolution),
      samples,
      routeSamples,
    );
    return {
      id: `regional-material:${tileX},${tileY}@${resolution}`,
      name: 'Continuous regional biome material',
      pixels: composed.pixels,
      materialMask: composed.materialMask,
      walkable: !samples[0].isWater || Boolean(routeSamples?.[0].isWalkableRoute),
      resolutions: { [String(resolution)]: composed.pixels },
    };
  }

  private composeGrid(
    tileX: number,
    tileY: number,
    size: number,
    textureScaleTiles: number,
    samples: readonly [BiomeWorldSample, BiomeWorldSample, BiomeWorldSample, BiomeWorldSample],
    routeSamples: readonly [RegionalRouteSample, RegionalRouteSample, RegionalRouteSample, RegionalRouteSample] | null,
  ): { pixels: PixelGrid; materialMask: MaterialMask } {
    const pixels: PixelGrid = [];
    const materialMask: MaterialMask = [];
    const textureSamples = Array.from({ length: BIOME_FAMILIES.length }, () => new Float64Array(3));
    for (let y = 0; y < size; y++) {
      const row: RGB[] = [];
      const materialRow = new Uint8Array(size);
      const smoothV = smoothstep01((y + 0.5) / size);
      for (let x = 0; x < size; x++) {
        const smoothU = smoothstep01((x + 0.5) / size);
        const worldX = tileX + (x + 0.5) / size;
        const worldY = tileY + (y + 0.5) / size;
        const weights = interpolateWeights(samples, smoothU, smoothV);
        const ecology = strongestEcologicalPair(weights);
        const canalOverlay = smoothstep(0.12, 0.62, weights[0]);
        const ruinsOverlay = smoothstep(0.14, 0.68, weights[5]);
        const needed = new Set<number>([ecology[0], ecology[1]]);
        if (canalOverlay > 0.001) needed.add(0);
        if (ruinsOverlay > 0.001) needed.add(5);
        for (const familyIndex of needed) {
          const family = BIOME_FAMILIES[familyIndex]!;
          this.sampleTextureField(
            this.materials[family],
            worldX,
            worldY,
            0x93d7 + familyIndex * 0x1f123,
            textureScaleTiles,
            size,
            textureSamples[familyIndex]!,
          );
        }
        const firstWeight = weights[ecology[0]]!;
        const secondWeight = weights[ecology[1]]!;
        const ecologicalTotal = Math.max(1e-9, firstWeight + secondWeight);
        const ecologicalMix = secondWeight / ecologicalTotal;
        const first = textureSamples[ecology[0]]!;
        const second = textureSamples[ecology[1]]!;
        const town = textureSamples[0]!;
        const ruins = textureSamples[5]!;
        let linear = [0, 1, 2].map((channel) => {
          const ecological = lerp(first[channel]!, second[channel]!, ecologicalMix);
          const withTown = lerp(ecological, town[channel]!, canalOverlay);
          return lerp(withTown, ruins[channel]!, ruinsOverlay * (0.88 - canalOverlay * 0.2));
        });
        const routeLayer = routeSamples
          ? selectRouteLayer(routeSamples, smoothU, smoothV)
          : null;
        if (routeLayer && routeLayer.sample.crossingKind !== 'ferry' && this.routeMaterials) {
          const crossingTextures = routeLayer.sample.crossingKind
            ? this.crossingMaterials?.[routeLayer.sample.crossingKind]
            : undefined;
          const routeTextures = crossingTextures ?? this.routeMaterials[routeLayer.sample.routeKind!];
          const routeTexture = new Float64Array(3);
          let textureX = worldX;
          let textureY = worldY;
          if (routeLayer.sample.crossingKind === 'bridge') {
            const directionLength = Math.hypot(
              routeLayer.sample.directionX,
              routeLayer.sample.directionY,
            );
            if (directionLength > 0.1) {
              const tangentX = routeLayer.sample.directionX / directionLength;
              const tangentY = routeLayer.sample.directionY / directionLength;
              textureX = worldX * -tangentY + worldY * tangentX;
              textureY = worldX * tangentX + worldY * tangentY;
            }
          }
          this.sampleTextureField(
            routeTextures,
            textureX,
            textureY,
            0x4d71,
            textureScaleTiles,
            size,
            routeTexture,
          );
          const crossingOpacity = routeLayer.sample.crossingKind === 'ford' ? 0.48 : 1;
          const opacity = routeLayer.opacity * crossingOpacity;
          linear = linear.map((value, channel) => lerp(value, routeTexture[channel]!, opacity));
        }
        row.push({
          r: linearToSrgb(linear[0]!),
          g: linearToSrgb(linear[1]!),
          b: linearToSrgb(linear[2]!),
        });
        const waterCoverage = bilerp(
          Number(samples[0].isWater),
          Number(samples[1].isWater),
          Number(samples[2].isWater),
          Number(samples[3].isWater),
          smoothU,
          smoothV,
        );
        const bridgeCoverage = routeLayer?.sample.crossingKind === 'bridge' ? routeLayer.opacity : 0;
        if (waterCoverage >= 0.5 && bridgeCoverage < 0.5) materialRow[x] = 1;
      }
      pixels.push(row);
      materialMask.push(materialRow);
    }
    return { pixels, materialMask };
  }

  private sampleTextureField(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
  ): void {
    out.fill(0);
    const fieldX = worldX / this.variantPeriodTiles;
    const fieldY = worldY / this.variantPeriodTiles;
    const cellX = Math.floor(fieldX);
    const cellY = Math.floor(fieldY);
    const blendX = smoothstep01(fieldX - cellX);
    const blendY = smoothstep01(fieldY - cellY);
    for (let dy = 0; dy <= 1; dy++) {
      const verticalWeight = dy === 0 ? 1 - blendY : blendY;
      for (let dx = 0; dx <= 1; dx++) {
        const weight = (dx === 0 ? 1 - blendX : blendX) * verticalWeight;
        const hash = this.hash(cellX + dx, cellY + dy, salt);
        const texture = textures[hash % textures.length]!;
        const level = selectTextureLevel(texture, outputSize, textureScaleTiles);
        const scaleX = level.width / texture.width;
        const scaleY = level.height / texture.height;
        const phaseX = ((hash >>> 8) % texture.width) * scaleX;
        const phaseY = ((hash >>> 17) % texture.height) * scaleY;
        const sampleX = mirrorIndex(
          Math.floor(worldX * level.width / textureScaleTiles + phaseX),
          level.width,
        );
        const sampleY = mirrorIndex(
          Math.floor(worldY * level.height / textureScaleTiles + phaseY),
          level.height,
        );
        const index = (sampleY * level.width + sampleX) * 3;
        out[0] = out[0]! + level.linear[index]! * weight;
        out[1] = out[1]! + level.linear[index + 1]! * weight;
        out[2] = out[2]! + level.linear[index + 2]! * weight;
      }
    }
  }

  private hash(x: number, y: number, salt: number): number {
    let value = (this.seed32 ^ salt) | 0;
    value = Math.imul(value ^ x, 0x45d9f3b);
    value = Math.imul(value ^ y, 0x119de1f3);
    return (value ^ (value >>> 16)) >>> 0;
  }
}

function interpolateWeights(
  samples: readonly [BiomeWorldSample, BiomeWorldSample, BiomeWorldSample, BiomeWorldSample],
  u: number,
  v: number,
): BiomeWeights {
  return BIOME_FAMILIES.map((_, family) => bilerp(
    samples[0].weights[family]!,
    samples[1].weights[family]!,
    samples[2].weights[family]!,
    samples[3].weights[family]!,
    u,
    v,
  )) as unknown as BiomeWeights;
}

function strongestEcologicalPair(weights: BiomeWeights): [number, number] {
  const ranked = [FOREST, COAST, RURAL, MOUNTAIN].sort((a, b) => weights[b]! - weights[a]!);
  return [ranked[0]!, ranked[1]!];
}

function selectRouteLayer(
  samples: readonly [RegionalRouteSample, RegionalRouteSample, RegionalRouteSample, RegionalRouteSample],
  u: number,
  v: number,
): { sample: RegionalRouteSample; opacity: number } | null {
  const cornerWeights = [
    (1 - u) * (1 - v),
    u * (1 - v),
    (1 - u) * v,
    u * v,
  ];
  let coverage = 0;
  let selectedIndex = -1;
  let selectedWeight = -1;
  for (let index = 0; index < samples.length; index++) {
    if (!samples[index]!.isRoute) continue;
    coverage += cornerWeights[index]!;
    if (cornerWeights[index]! > selectedWeight) {
      selectedIndex = index;
      selectedWeight = cornerWeights[index]!;
    }
  }
  if (selectedIndex < 0) return null;
  return {
    sample: samples[selectedIndex]!,
    opacity: smoothstep(0.02, 0.42, coverage),
  };
}

function prepareTexture(tile: Tile): PreparedTexture {
  const height = tile.pixels.length;
  const width = tile.pixels[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new Error(`Empty regional material texture: ${tile.id}`);
  const linear = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = tile.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
      const index = (y * width + x) * 3;
      linear[index] = srgbToLinear(pixel.r);
      linear[index + 1] = srgbToLinear(pixel.g);
      linear[index + 2] = srgbToLinear(pixel.b);
    }
  }
  const levels: PreparedTextureLevel[] = [{ width, height, linear }];
  while (levels.at(-1)!.width > 1 || levels.at(-1)!.height > 1) {
    levels.push(downsampleTextureLevel(levels.at(-1)!));
  }
  return { width, height, linear, levels };
}

function downsampleTextureLevel(source: PreparedTextureLevel): PreparedTextureLevel {
  const width = Math.max(1, Math.ceil(source.width / 2));
  const height = Math.max(1, Math.ceil(source.height / 2));
  const linear = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sourceX = x * 2;
      const sourceY = y * 2;
      let count = 0;
      for (let offsetY = 0; offsetY < 2; offsetY++) {
        const sampleY = sourceY + offsetY;
        if (sampleY >= source.height) continue;
        for (let offsetX = 0; offsetX < 2; offsetX++) {
          const sampleX = sourceX + offsetX;
          if (sampleX >= source.width) continue;
          const sourceIndex = (sampleY * source.width + sampleX) * 3;
          const targetIndex = (y * width + x) * 3;
          linear[targetIndex] = linear[targetIndex]! + source.linear[sourceIndex]!;
          linear[targetIndex + 1] = linear[targetIndex + 1]! + source.linear[sourceIndex + 1]!;
          linear[targetIndex + 2] = linear[targetIndex + 2]! + source.linear[sourceIndex + 2]!;
          count++;
        }
      }
      const targetIndex = (y * width + x) * 3;
      linear[targetIndex] = linear[targetIndex]! / count;
      linear[targetIndex + 1] = linear[targetIndex + 1]! / count;
      linear[targetIndex + 2] = linear[targetIndex + 2]! / count;
    }
  }
  return { width, height, linear };
}

function selectTextureLevel(
  texture: PreparedTexture,
  outputSize: number,
  textureScaleTiles: number,
): PreparedTextureLevel {
  const texelsPerOutputPixel = Math.max(texture.width, texture.height) /
    Math.max(1, outputSize * textureScaleTiles);
  const levelIndex = Math.max(0, Math.min(
    texture.levels.length - 1,
    Math.round(Math.log2(Math.max(1, texelsPerOutputPixel))),
  ));
  return texture.levels[levelIndex]!;
}

function bilerp(a: number, b: number, c: number, d: number, u: number, v: number): number {
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function mirrorIndex(value: number, size: number): number {
  if (size <= 1) return 0;
  const period = (size - 1) * 2;
  const wrapped = ((value % period) + period) % period;
  return wrapped < size ? wrapped : period - wrapped;
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const channel = Math.max(0, Math.min(1, value));
  const srgb = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function smoothstep(low: number, high: number, value: number): number {
  const t = smoothstep01((value - low) / Math.max(1e-9, high - low));
  return t;
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
