import type { MaterialMask, PixelGrid, RGB, Tile } from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldSample,
} from '../biomes/biome-world-field.js';

export interface BiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
}

export interface RegionalMaterialCompositorConfig {
  worldSeed: bigint;
  field: BiomeSampler;
  materials: Readonly<Record<BiomeFamily, readonly Tile[]>>;
  maxCachedTiles?: number;
  variantPeriodTiles?: number;
  /** World-tile span of one complete source texture. Values above one prevent
   * the source master from becoming a visible stamp on every terrain tile. */
  textureScaleTiles?: number;
}

interface PreparedTexture {
  width: number;
  height: number;
  linear: Float32Array;
}

const FOREST = 1;
const COAST = 2;
const RURAL = 3;
const MOUNTAIN = 4;

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
  private readonly materials: Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
  private readonly maxCachedTiles: number;
  private readonly variantPeriodTiles: number;
  private readonly textureScaleTiles: number;
  private readonly sourceSize: number;
  private readonly cache = new Map<string, Tile>();

  constructor(config: RegionalMaterialCompositorConfig) {
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.maxCachedTiles = Math.max(8, config.maxCachedTiles ?? 128);
    this.variantPeriodTiles = Math.max(2, config.variantPeriodTiles ?? 5);
    this.textureScaleTiles = Math.max(2, config.textureScaleTiles ?? 7);
    this.materials = Object.fromEntries(BIOME_FAMILIES.map((family) => {
      const sources = config.materials[family];
      if (sources.length === 0) throw new Error(`Regional material family is empty: ${family}`);
      return [family, sources.map(prepareTexture)];
    })) as unknown as Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
    this.sourceSize = Math.min(...BIOME_FAMILIES.flatMap((family) =>
      this.materials[family].flatMap((texture) => [texture.width, texture.height])));
    if (this.sourceSize === 0) throw new Error('Regional material textures cannot be empty');
  }

  getTile(tileX: number, tileY: number): Tile {
    const key = `${tileX},${tileY}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const tile = this.composeTile(tileX, tileY);
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

  private composeTile(tileX: number, tileY: number): Tile {
    const size = this.sourceSize;
    const samples = [
      this.field.sample(tileX, tileY),
      this.field.sample(tileX + 1, tileY),
      this.field.sample(tileX, tileY + 1),
      this.field.sample(tileX + 1, tileY + 1),
    ] as const;
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
        const linear = [0, 1, 2].map((channel) => {
          const ecological = lerp(first[channel]!, second[channel]!, ecologicalMix);
          const withTown = lerp(ecological, town[channel]!, canalOverlay);
          return lerp(withTown, ruins[channel]!, ruinsOverlay * (0.88 - canalOverlay * 0.2));
        });
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
        if (waterCoverage >= 0.5) materialRow[x] = 1;
      }
      pixels.push(row);
      materialMask.push(materialRow);
    }
    return {
      id: `regional-material:${tileX},${tileY}`,
      name: 'Continuous regional biome material',
      pixels,
      materialMask,
      walkable: !samples[0].isWater,
      resolutions: { [String(size)]: pixels },
    };
  }

  private sampleTextureField(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
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
        const phaseX = (hash >>> 8) % texture.width;
        const phaseY = (hash >>> 17) % texture.height;
        const sampleX = mirrorIndex(
          Math.floor(worldX * texture.width / this.textureScaleTiles + phaseX),
          texture.width,
        );
        const sampleY = mirrorIndex(
          Math.floor(worldY * texture.height / this.textureScaleTiles + phaseY),
          texture.height,
        );
        const index = (sampleY * texture.width + sampleX) * 3;
        out[0] = out[0]! + texture.linear[index]! * weight;
        out[1] = out[1]! + texture.linear[index + 1]! * weight;
        out[2] = out[2]! + texture.linear[index + 2]! * weight;
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
  return { width, height, linear };
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
