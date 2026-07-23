import type { MaterialMask, PixelGrid, RGB, Tile } from '@maldoror/protocol';

export interface CanalMaterialCompositorConfig {
  worldSeed: bigint;
  water: readonly Tile[];
  paving: readonly Tile[];
  garden?: readonly Tile[];
  edge?: readonly Tile[];
  maxCachedTiles?: number;
  /** Number of world tiles over which texture variants cross-fade. */
  variantPeriodTiles?: number;
  /** Width of the water/land handoff in normalized coverage units. */
  materialTransitionWidth?: number;
  /** Half-width of the distinct edge-material band. */
  edgeBandWidth?: number;
  edgeStrength?: number;
  /** Add a land-side stone band, wet contact line, joints, and reflections. */
  constructedEdgeDetail?: boolean;
}

export type WaterClassifier = (tileX: number, tileY: number) => boolean;
export type MaterialClassifier = (tileX: number, tileY: number) => boolean;

interface PreparedTexture {
  width: number;
  height: number;
  linear: Float32Array;
}

interface CachedTransition {
  tile: Tile;
}

/**
 * Bounded, shared transition compositor for the first material-field research
 * candidate. It preserves the Tile API while replacing hard material plates at
 * boundaries with a continuous world-space coverage field.
 *
 * Coverage is reconstructed from shared lattice corners, then perturbed by
 * deterministic world-space value noise. Texture variants are themselves
 * cross-faded over a coarser lattice and mirror-sampled, so both the material
 * mask and source texture are continuous across tile/chunk boundaries.
 */
export class CanalMaterialCompositor {
  private readonly seed32: number;
  private readonly water: PreparedTexture[];
  private readonly paving: PreparedTexture[];
  private readonly garden: PreparedTexture[];
  private readonly edge: PreparedTexture[];
  private readonly maxCachedTiles: number;
  private readonly variantPeriodTiles: number;
  private readonly materialTransitionWidth: number;
  private readonly edgeBandWidth: number;
  private readonly edgeStrength: number;
  private readonly constructedEdgeDetail: boolean;
  private readonly cache = new Map<string, CachedTransition>();

  constructor(config: CanalMaterialCompositorConfig) {
    if (config.water.length === 0 || config.paving.length === 0) {
      throw new Error('CanalMaterialCompositor requires water and paving textures');
    }
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.water = config.water.map(prepareTexture);
    this.paving = config.paving.map(prepareTexture);
    this.garden = (config.garden ?? []).map(prepareTexture);
    this.edge = (config.edge ?? []).map(prepareTexture);
    this.maxCachedTiles = Math.max(8, config.maxCachedTiles ?? 96);
    this.variantPeriodTiles = Math.max(2, config.variantPeriodTiles ?? 4);
    this.materialTransitionWidth = clamp(config.materialTransitionWidth ?? 0.075, 0.02, 0.4);
    this.edgeBandWidth = clamp(config.edgeBandWidth ?? 0.13, 0.015, 0.3);
    this.edgeStrength = clamp01(config.edgeStrength ?? 0.94);
    this.constructedEdgeDetail = config.constructedEdgeDetail ?? true;
  }

  /** Return null for a uniform neighbourhood so flat interiors keep using the
   * existing shared terrain tiles. Only true boundaries pay allocation cost. */
  getTransitionTile(
    tileX: number,
    tileY: number,
    isWaterAt: WaterClassifier,
  ): Tile | null {
    const centerWater = isWaterAt(tileX, tileY);
    let crossesBoundary = false;
    for (let dy = -1; dy <= 1 && !crossesBoundary; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (isWaterAt(tileX + dx, tileY + dy) !== centerWater) {
          crossesBoundary = true;
          break;
        }
      }
    }
    if (!crossesBoundary) return null;

    const key = `water:${tileX},${tileY}`;
    const cached = this.cache.get(key);
    if (cached) {
      // Map insertion order is the LRU list; touching a tile moves it to tail.
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.tile;
    }

    const tile = this.composeTile(tileX, tileY, isWaterAt, centerWater);
    this.cache.set(key, { tile });
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Blend garden/soil masses into paving through the same shared-corner field.
   * Water owns its boundary first; this method is only for the land hierarchy. */
  getGardenTransitionTile(
    tileX: number,
    tileY: number,
    isGardenAt: MaterialClassifier,
  ): Tile | null {
    if (this.garden.length === 0) return null;
    const centerGarden = isGardenAt(tileX, tileY);
    let crossesBoundary = false;
    for (let dy = -1; dy <= 1 && !crossesBoundary; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (isGardenAt(tileX + dx, tileY + dy) !== centerGarden) {
          crossesBoundary = true;
          break;
        }
      }
    }
    if (!crossesBoundary) return null;

    const key = `garden:${tileX},${tileY}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.tile;
    }
    const tile = this.composeGardenTile(tileX, tileY, isGardenAt);
    this.cache.set(key, { tile });
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (!oldest) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  getStats(): { cachedTiles: number; maxCachedTiles: number; sourceSize: number } {
    return {
      cachedTiles: this.cache.size,
      maxCachedTiles: this.maxCachedTiles,
      sourceSize: this.water[0]?.width ?? 0,
    };
  }

  clear(): void {
    this.cache.clear();
  }

  private composeTile(
    tileX: number,
    tileY: number,
    isWaterAt: WaterClassifier,
    centerWater: boolean,
  ): Tile {
    const size = Math.min(this.water[0]!.width, this.paving[0]!.width);
    const pixels: PixelGrid = [];
    const materialMask: MaterialMask = [];
    const corner00 = cornerCoverage(isWaterAt, tileX, tileY);
    const corner10 = cornerCoverage(isWaterAt, tileX + 1, tileY);
    const corner01 = cornerCoverage(isWaterAt, tileX, tileY + 1);
    const corner11 = cornerCoverage(isWaterAt, tileX + 1, tileY + 1);
    const waterSample = new Float64Array(3);
    const pavingSample = new Float64Array(3);
    const edgeSample = new Float64Array(3);

    for (let y = 0; y < size; y++) {
      const row: RGB[] = [];
      const materialRow = new Uint8Array(size);
      const v = (y + 0.5) / size;
      const smoothV = smoothstep01(v);
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const smoothU = smoothstep01(u);
        const worldX = tileX + u;
        const worldY = tileY + v;
        const top = lerp(corner00, corner10, smoothU);
        const bottom = lerp(corner01, corner11, smoothU);
        const latticeCoverage = lerp(top, bottom, smoothV);
        const boundaryInfluence = 4 * latticeCoverage * (1 - latticeCoverage);
        const perturbation = (
          this.valueNoise(worldX * 1.7, worldY * 1.7, 0x51f15e) * 0.10 +
          this.valueNoise(worldX * 4.9, worldY * 4.9, 0x9e3779) * 0.035
        ) * boundaryInfluence;
        const field = clamp01(latticeCoverage + perturbation);
        // Geometry should be organic, not airbrushed. Keep the material handoff
        // narrow and let a distinct curb band own the edge, matching the target
        // reference's crisp constructed waterfronts.
        const waterCoverage = smoothstep(
          0.5 - this.materialTransitionWidth / 2,
          0.5 + this.materialTransitionWidth / 2,
          field,
        );
        const signedDistance = field - 0.5;
        const edgeCoverage = this.edge.length === 0
          ? 0
          : this.edgeStrength * (1 - smoothstep(
              this.edgeBandWidth * 0.24,
              this.edgeBandWidth,
              this.constructedEdgeDetail
                ? Math.max(0, -signedDistance)
                : Math.abs(signedDistance),
            )) * (this.constructedEdgeDetail ? Number(signedDistance <= 0) : 1);

        this.sampleTextureField(this.water, worldX, worldY, 0x8da6b3, waterSample);
        this.sampleTextureField(this.paving, worldX, worldY, 0xd81638, pavingSample);
        if (edgeCoverage > 0) {
          this.sampleTextureField(this.edge, worldX, worldY, 0xcb1ab3, edgeSample);
        }

        const landWeight = 1 - waterCoverage;
        const baseR = pavingSample[0]! * landWeight + waterSample[0]! * waterCoverage;
        const baseG = pavingSample[1]! * landWeight + waterSample[1]! * waterCoverage;
        const baseB = pavingSample[2]! * landWeight + waterSample[2]! * waterCoverage;
        let finalR = lerp(baseR, edgeSample[0]!, edgeCoverage);
        let finalG = lerp(baseG, edgeSample[1]!, edgeCoverage);
        let finalB = lerp(baseB, edgeSample[2]!, edgeCoverage);
        if (this.constructedEdgeDetail) {
          // The interpolated semantic field supplies a stable local tangent.
          // Ignore the high-frequency perturbation here: joints should follow
          // the waterfront rather than jitter with every chipped edge texel.
          const derivativeU = lerp(corner10 - corner00, corner11 - corner01, smoothV) * 6 * u * (1 - u);
          const derivativeV = (bottom - top) * 6 * v * (1 - v);
          const gradientLength = Math.hypot(derivativeU, derivativeV);
          const tangentX = gradientLength > 1e-5 ? -derivativeV / gradientLength : 1;
          const tangentY = gradientLength > 1e-5 ? derivativeU / gradientLength : 0;
          const tangentCoordinate = worldX * tangentX + worldY * tangentY;
          const jointPhase = fract(
            tangentCoordinate * 5.25 +
            this.valueNoise(worldX * 0.31, worldY * 0.31, 0x7214a3) * 0.33,
          );
          const jointDistance = Math.min(jointPhase, 1 - jointPhase);
          const joint = 1 - smoothstep(0.025, 0.09, jointDistance);
          const landBand = Number(signedDistance <= 0) *
            (1 - smoothstep(this.edgeBandWidth * 0.45, this.edgeBandWidth, -signedDistance));
          const jointStrength = landBand * joint * 0.48;
          finalR *= 1 - jointStrength;
          finalG *= 1 - jointStrength;
          finalB *= 1 - jointStrength;

          // A light stone lip and dark wet contact line survive the aggressive
          // 96px -> terminal-cell reduction far better than a symmetric beige
          // crossfade. Both are continuous functions of the shared field.
          const lip = Number(signedDistance <= 0) *
            (1 - smoothstep(0.016, 0.060, -signedDistance)) * 0.62;
          finalR = lerp(finalR, srgbToLinear(224), lip);
          finalG = lerp(finalG, srgbToLinear(205), lip);
          finalB = lerp(finalB, srgbToLinear(165), lip);

          const wetContact = Number(signedDistance > 0) *
            (1 - smoothstep(0.012, 0.078, signedDistance)) * 0.84;
          finalR = lerp(finalR, srgbToLinear(28), wetContact);
          finalG = lerp(finalG, srgbToLinear(73), wetContact);
          finalB = lerp(finalB, srgbToLinear(76), wetContact);

          const reflectionBand = Number(signedDistance > 0) *
            bandPulse(signedDistance, 0.075, 0.115) *
            (0.18 + 0.18 * Math.max(0, this.valueNoise(worldX * 3.1, worldY * 3.1, 0x19f37d)));
          finalR = lerp(finalR, srgbToLinear(151), reflectionBand);
          finalG = lerp(finalG, srgbToLinear(218), reflectionBand);
          finalB = lerp(finalB, srgbToLinear(210), reflectionBand);
        }
        row.push({
          r: linearToSrgb(finalR),
          g: linearToSrgb(finalG),
          b: linearToSrgb(finalB),
        });
        if (waterCoverage >= 0.5) materialRow[x] = 1;
      }
      pixels.push(row);
      materialMask.push(materialRow);
    }

    return {
      id: `canal-material-blend:${tileX},${tileY}`,
      name: 'Continuous canal material transition',
      pixels,
      materialMask,
      walkable: !centerWater,
      resolutions: { [String(size)]: pixels },
    };
  }

  private composeGardenTile(
    tileX: number,
    tileY: number,
    isGardenAt: MaterialClassifier,
  ): Tile {
    const size = Math.min(this.garden[0]!.width, this.paving[0]!.width);
    const pixels: PixelGrid = [];
    const corner00 = cornerCoverage(isGardenAt, tileX, tileY);
    const corner10 = cornerCoverage(isGardenAt, tileX + 1, tileY);
    const corner01 = cornerCoverage(isGardenAt, tileX, tileY + 1);
    const corner11 = cornerCoverage(isGardenAt, tileX + 1, tileY + 1);
    const pavingSample = new Float64Array(3);
    const gardenSample = new Float64Array(3);
    for (let y = 0; y < size; y++) {
      const row: RGB[] = [];
      const v = (y + 0.5) / size;
      const smoothV = smoothstep01(v);
      for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size;
        const smoothU = smoothstep01(u);
        const worldX = tileX + u;
        const worldY = tileY + v;
        const top = lerp(corner00, corner10, smoothU);
        const bottom = lerp(corner01, corner11, smoothU);
        const latticeCoverage = lerp(top, bottom, smoothV);
        const boundaryInfluence = 4 * latticeCoverage * (1 - latticeCoverage);
        const field = clamp01(latticeCoverage + (
          this.valueNoise(worldX * 1.2, worldY * 1.2, 0x48a129) * 0.13 +
          this.valueNoise(worldX * 4.1, worldY * 4.1, 0x7c91d3) * 0.045
        ) * boundaryInfluence);
        const gardenCoverage = smoothstep(0.39, 0.61, field);
        this.sampleTextureField(this.paving, worldX, worldY, 0xd81638, pavingSample);
        this.sampleTextureField(this.garden, worldX, worldY, 0x61d24b, gardenSample);
        row.push({
          r: linearToSrgb(lerp(pavingSample[0]!, gardenSample[0]!, gardenCoverage)),
          g: linearToSrgb(lerp(pavingSample[1]!, gardenSample[1]!, gardenCoverage)),
          b: linearToSrgb(lerp(pavingSample[2]!, gardenSample[2]!, gardenCoverage)),
        });
      }
      pixels.push(row);
    }
    return {
      id: `canal-garden-blend:${tileX},${tileY}`,
      name: 'Continuous garden and paving transition',
      pixels,
      walkable: true,
      resolutions: { [String(size)]: pixels },
    };
  }

  private sampleTextureField(
    textures: PreparedTexture[],
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
      const wy = dy === 0 ? 1 - blendY : blendY;
      for (let dx = 0; dx <= 1; dx++) {
        const weight = (dx === 0 ? 1 - blendX : blendX) * wy;
        const hash = this.hash(cellX + dx, cellY + dy, salt);
        const texture = textures[hash % textures.length]!;
        const phaseX = (hash >>> 8) % texture.width;
        const phaseY = (hash >>> 17) % texture.height;
        const sampleX = mirrorIndex(
          Math.floor(worldX * texture.width + phaseX),
          texture.width,
        );
        const sampleY = mirrorIndex(
          Math.floor(worldY * texture.height + phaseY),
          texture.height,
        );
        const index = (sampleY * texture.width + sampleX) * 3;
        out[0] = out[0]! + texture.linear[index]! * weight;
        out[1] = out[1]! + texture.linear[index + 1]! * weight;
        out[2] = out[2]! + texture.linear[index + 2]! * weight;
      }
    }
  }

  private valueNoise(x: number, y: number, salt: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = smoothstep01(x - x0);
    const ty = smoothstep01(y - y0);
    const n00 = hashUnit(this.hash(x0, y0, salt));
    const n10 = hashUnit(this.hash(x0 + 1, y0, salt));
    const n01 = hashUnit(this.hash(x0, y0 + 1, salt));
    const n11 = hashUnit(this.hash(x0 + 1, y0 + 1, salt));
    return lerp(lerp(n00, n10, tx), lerp(n01, n11, tx), ty);
  }

  private hash(x: number, y: number, salt: number): number {
    let h = (this.seed32 ^ salt) | 0;
    h = Math.imul(h ^ x, 0x45d9f3b);
    h = Math.imul(h ^ y, 0x119de1f3);
    h ^= h >>> 16;
    return h >>> 0;
  }
}

function prepareTexture(tile: Tile): PreparedTexture {
  const height = tile.pixels.length;
  const width = tile.pixels[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new Error(`Empty material texture: ${tile.id}`);
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

/** Coverage at a material-lattice corner is the average of the four cells
 * sharing it. Adjacent tiles therefore reconstruct the exact same edge. */
function cornerCoverage(isWaterAt: MaterialClassifier, cornerX: number, cornerY: number): number {
  return (
    Number(isWaterAt(cornerX - 1, cornerY - 1)) +
    Number(isWaterAt(cornerX, cornerY - 1)) +
    Number(isWaterAt(cornerX - 1, cornerY)) +
    Number(isWaterAt(cornerX, cornerY))
  ) / 4;
}

function srgbToLinear(value: number): number {
  const channel = value / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number): number {
  const channel = clamp01(value);
  const srgb = channel <= 0.0031308
    ? channel * 12.92
    : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function mirrorIndex(value: number, size: number): number {
  if (size <= 1) return 0;
  const period = (size - 1) * 2;
  const wrapped = ((value % period) + period) % period;
  return wrapped < size ? wrapped : period - wrapped;
}

function hashUnit(hash: number): number {
  return (hash / 0xffffffff) * 2 - 1;
}

function fract(value: number): number {
  return value - Math.floor(value);
}

function bandPulse(value: number, centre: number, halfWidth: number): number {
  return 1 - smoothstep(halfWidth * 0.35, halfWidth, Math.abs(value - centre));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  return smoothstep01((value - edge0) / (edge1 - edge0));
}

function smoothstep01(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
