import type { MaterialMask, PixelGrid, RGB, Tile } from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type BiomeWeights,
  type BiomeWorldSample,
  type ConstructedWaterwayDescriptor,
  type ConstructedWaterwaySample,
} from '../biomes/biome-world-field.js';
import type {
  RegionalCrossingKind,
  RegionalRouteKind,
  RegionalRouteSample,
} from '../routes/regional-route-field.js';
import {
  sampleRegionalParcelLayout,
  type RegionalParcelLayout,
} from './regional-parcel-layout.js';
import {
  distanceToRegionalParcelPath,
  type RegionalParcelPath,
} from './regional-parcel-path.js';
import {
  sampleRegionalWaterfrontLayout,
  type RegionalWaterfrontLayout,
} from './regional-waterfront-layout.js';
import {
  sampleRegionalEnvironmentProgramLayout,
  type RegionalEnvironmentProgramLayout,
} from './regional-environment-program-layout.js';
import {
  sampleRegionalLandmarkFabricLayout,
  type RegionalLandmarkFabricLayout,
} from './regional-landmark-fabric-layout.js';
import {
  sampleRegionalQuayLayout,
  type RegionalQuayLayout,
} from './regional-quay-layout.js';

export interface BiomeSampler {
  sample(worldX: number, worldY: number): BiomeWorldSample;
  getConstructedWaterways?(): readonly ConstructedWaterwayDescriptor[];
  sampleConstructedWaterway?(
    worldX: number,
    worldY: number,
    waterwayId?: string,
  ): ConstructedWaterwaySample | null;
}

export interface RegionalRouteSampler {
  sample(worldX: number, worldY: number): RegionalRouteSample;
}

export interface RegionalRouteSurfaceStyle {
  /** World-tile span of the source master at walking scale. */
  textureScaleTiles: number;
  /** Fraction of the authoritative route half-width painted at near scale. */
  detailWidthScale: number;
  /** Narrower semantic cross-section used for district/regional maps. */
  overviewWidthScale: number;
  /** Material ownership at walking/near zoom after place material is retained. */
  detailOpacity: number;
  /** Reduced map-scale ownership so infrastructure does not erase place. */
  overviewOpacity: number;
}

export type RegionalTextureReconstruction =
  | 'square-bilinear'
  | 'triangle-bounded-window'
  | 'hex-contrast'
  | 'hex-laplacian'
  | 'cellular-semantic';

/** Tunable visual grammar for constructed civic infrastructure. Geometry
 * remains owned by the route and waterway fields; these values let research
 * harnesses compare material hierarchy and restrained cross-section changes
 * without forking those physical authorities. */
export interface RegionalInfrastructureVisualProfile {
  civicBridgeDeckMix: number;
  detailCivicStreetMix: number;
  overviewCivicStreetMix: number;
  bridgeLandingFlareScale: number;
  bridgeMidspanWaistScale: number;
  quaySurfaceArticulation: number;
}

/** Scale-aware tonal structure for physically owned water. The source
 * material still supplies colour and authored mass; this continuous field
 * adds long current streaks that survive terminal reduction without becoming
 * a repeated tile stamp. */
export interface RegionalWaterVisualProfile {
  detailCurrentStrength: number;
  overviewCurrentStrength: number;
}

export interface RegionalMaterialCompositorConfig {
  worldSeed: bigint;
  field: BiomeSampler;
  materials: Readonly<Record<BiomeFamily, readonly Tile[]>>;
  /** Separately authored broad-value materials for district/regional zoom.
   * These are not mipmaps of walking art: their semantic detail is different. */
  overviewMaterials?: Readonly<Record<BiomeFamily, readonly Tile[]>>;
  /** Optional family-specific constructed ground for focal settlement fabric.
   * Missing families fall back to their route surface until an authored
   * vocabulary exists. */
  landmarkFabricMaterials?: Readonly<Partial<Record<BiomeFamily, readonly Tile[]>>>;
  routes?: RegionalRouteSampler;
  routeMaterials?: Readonly<Record<RegionalRouteKind, readonly Tile[]>>;
  crossingMaterials?: Readonly<Partial<Record<RegionalCrossingKind, readonly Tile[]>>>;
  routeSurfaceStyles?: Readonly<Record<RegionalRouteKind, RegionalRouteSurfaceStyle>>;
  crossingSurfaceStyles?: Readonly<Partial<Record<RegionalCrossingKind, RegionalRouteSurfaceStyle>>>;
  maxCachedTiles?: number;
  variantPeriodTiles?: number;
  /** World-tile span of one complete source texture. Values above one prevent
   * the source master from becoming a visible stamp on every terrain tile. */
  textureScaleTiles?: number;
  /** World span of a scale-authored overview master. It must be materially
   * larger than walking art; mipmaps filter pixels but do not author scale. */
  overviewTextureScaleTiles?: number;
  overviewVariantPeriodTiles?: number;
  /** Highest semantic raster emitted for one world tile. Authored sampling
   * textures may be larger so walking zoom does not magnify a tiny crop. */
  maxOutputResolution?: number;
  /** Aperiodic reconstruction method used for every authored material. The
   * explicit baseline remains available to research harnesses; production can
   * select a measured candidate without changing asset or biome semantics. */
  textureReconstruction?: RegionalTextureReconstruction;
  infrastructureVisualProfile?: Partial<RegionalInfrastructureVisualProfile>;
  waterVisualProfile?: Partial<RegionalWaterVisualProfile>;
}

/** Evidence-selected walking/near material reconstruction. Keeping this in
 * the engine package gives production and faithful tooling one source of
 * truth while research harnesses can still pass explicit control profiles. */
export const REGIONAL_MATERIAL_TEXTURE_PROFILE = {
  variantPeriodTiles: 3,
  textureScaleTiles: 7,
  textureReconstruction: 'triangle-bounded-window',
} as const satisfies Pick<
  RegionalMaterialCompositorConfig,
  'variantPeriodTiles' | 'textureScaleTiles' | 'textureReconstruction'
>;

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
const DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE: RegionalInfrastructureVisualProfile = {
  civicBridgeDeckMix: 0.64,
  detailCivicStreetMix: 0.62,
  overviewCivicStreetMix: 0.36,
  bridgeLandingFlareScale: 3,
  bridgeMidspanWaistScale: 3.2,
  quaySurfaceArticulation: 1,
};
const DEFAULT_WATER_VISUAL_PROFILE: RegionalWaterVisualProfile = {
  detailCurrentStrength: 0.18,
  overviewCurrentStrength: 0.52,
};

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
  private readonly overviewMaterials?: Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
  private readonly landmarkFabricMaterials?: Readonly<Partial<Record<BiomeFamily, readonly PreparedTexture[]>>>;
  private readonly routeMaterials?: Readonly<Record<RegionalRouteKind, readonly PreparedTexture[]>>;
  private readonly crossingMaterials?: Readonly<Partial<Record<RegionalCrossingKind, readonly PreparedTexture[]>>>;
  private readonly routeSurfaceStyles?: Readonly<Record<RegionalRouteKind, RegionalRouteSurfaceStyle>>;
  private readonly crossingSurfaceStyles?: Readonly<Partial<Record<RegionalCrossingKind, RegionalRouteSurfaceStyle>>>;
  private readonly maxCachedTiles: number;
  private readonly variantPeriodTiles: number;
  private readonly textureScaleTiles: number;
  private readonly overviewTextureScaleTiles: number;
  private readonly overviewVariantPeriodTiles: number;
  private readonly textureReconstruction: RegionalTextureReconstruction;
  private readonly infrastructureVisualProfile: RegionalInfrastructureVisualProfile;
  private readonly waterVisualProfile: RegionalWaterVisualProfile;
  private readonly sourceSize: number;
  private readonly cache = new Map<string, Tile>();
  private readonly triangleWeights = new Float64Array(3);
  private readonly triangleVertices = new Int32Array(6);
  private readonly hexSamples = new Float64Array(27);
  private readonly cellularDistances = new Float64Array(4);
  private readonly cellularHashes = new Uint32Array(4);
  private readonly cellularWeights = new Float64Array(4);

  constructor(config: RegionalMaterialCompositorConfig) {
    this.seed32 = Number(BigInt.asUintN(32, config.worldSeed));
    this.field = config.field;
    this.routes = config.routes;
    this.maxCachedTiles = Math.max(8, config.maxCachedTiles ?? 128);
    this.variantPeriodTiles = Math.max(2, config.variantPeriodTiles ?? 5);
    this.textureScaleTiles = Math.max(2, config.textureScaleTiles ?? 7);
    this.overviewTextureScaleTiles = Math.max(
      this.textureScaleTiles * 2,
      config.overviewTextureScaleTiles ?? 42,
    );
    this.overviewVariantPeriodTiles = Math.max(
      this.variantPeriodTiles * 2,
      config.overviewVariantPeriodTiles ?? 31,
    );
    this.textureReconstruction = config.textureReconstruction ?? 'square-bilinear';
    this.infrastructureVisualProfile = {
      civicBridgeDeckMix: clamp01(
        config.infrastructureVisualProfile?.civicBridgeDeckMix ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.civicBridgeDeckMix,
      ),
      detailCivicStreetMix: clamp01(
        config.infrastructureVisualProfile?.detailCivicStreetMix ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.detailCivicStreetMix,
      ),
      overviewCivicStreetMix: clamp01(
        config.infrastructureVisualProfile?.overviewCivicStreetMix ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.overviewCivicStreetMix,
      ),
      bridgeLandingFlareScale: Math.max(
        0,
        config.infrastructureVisualProfile?.bridgeLandingFlareScale ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.bridgeLandingFlareScale,
      ),
      bridgeMidspanWaistScale: Math.max(
        0,
        config.infrastructureVisualProfile?.bridgeMidspanWaistScale ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.bridgeMidspanWaistScale,
      ),
      quaySurfaceArticulation: clamp01(
        config.infrastructureVisualProfile?.quaySurfaceArticulation ??
          DEFAULT_INFRASTRUCTURE_VISUAL_PROFILE.quaySurfaceArticulation,
      ),
    };
    this.waterVisualProfile = {
      detailCurrentStrength: clamp01(
        config.waterVisualProfile?.detailCurrentStrength ??
          DEFAULT_WATER_VISUAL_PROFILE.detailCurrentStrength,
      ),
      overviewCurrentStrength: clamp01(
        config.waterVisualProfile?.overviewCurrentStrength ??
          DEFAULT_WATER_VISUAL_PROFILE.overviewCurrentStrength,
      ),
    };
    this.materials = Object.fromEntries(BIOME_FAMILIES.map((family) => {
      const sources = config.materials[family];
      if (sources.length === 0) throw new Error(`Regional material family is empty: ${family}`);
      return [family, sources.map(prepareTexture)];
    })) as unknown as Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
    if (config.overviewMaterials) {
      this.overviewMaterials = Object.fromEntries(BIOME_FAMILIES.map((family) => {
        const sources = config.overviewMaterials![family];
        if (sources.length === 0) throw new Error(`Regional overview material family is empty: ${family}`);
        return [family, sources.map(prepareTexture)];
      })) as unknown as Readonly<Record<BiomeFamily, readonly PreparedTexture[]>>;
    }
    if (config.landmarkFabricMaterials) {
      this.landmarkFabricMaterials = Object.fromEntries(
        Object.entries(config.landmarkFabricMaterials).map(([family, sources]) => {
          if (!sources || sources.length === 0) {
            throw new Error(`Regional landmark-fabric material family is empty: ${family}`);
          }
          return [family, sources.map(prepareTexture)];
        }),
      ) as Readonly<Partial<Record<BiomeFamily, readonly PreparedTexture[]>>>;
    }
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
    this.routeSurfaceStyles = config.routeSurfaceStyles;
    this.crossingSurfaceStyles = config.crossingSurfaceStyles;
    const prepared = [
      ...BIOME_FAMILIES.flatMap((family) => this.materials[family]),
      ...BIOME_FAMILIES.flatMap((family) => this.overviewMaterials?.[family] ?? []),
      ...BIOME_FAMILIES.flatMap((family) => this.landmarkFabricMaterials?.[family] ?? []),
      ...ROUTE_KINDS.flatMap((kind) => this.routeMaterials?.[kind] ?? []),
      ...Object.values(this.crossingMaterials ?? {}).flatMap((textures) => textures ?? []),
    ];
    const samplingSize = Math.min(...prepared.flatMap((texture) => [texture.width, texture.height]));
    this.sourceSize = Math.min(
      samplingSize,
      Math.max(1, Math.round(config.maxOutputResolution ?? samplingSize)),
    );
    if (this.sourceSize === 0) throw new Error('Regional material textures cannot be empty');
  }

  getTile(tileX: number, tileY: number): Tile {
    return this.getTileAtResolution(tileX, tileY, this.sourceSize);
  }

  /** Reconstruct a one-tile-wide parcel access surface from the same route
   * material field as the regional road graph. Authored masses never own
   * ground pixels: opacity falls to zero at both cross-axis tile boundaries,
   * so the connector meets its biome without a baked apron or square stamp. */
  getAccessTile(
    tileX: number,
    tileY: number,
    accessAxis: 'north-south' | 'east-west',
    routeKind: RegionalRouteKind,
  ): Tile {
    return this.getAccessTileAtResolution(tileX, tileY, this.sourceSize, accessAxis, routeKind);
  }

  getAccessTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    accessAxis: 'north-south' | 'east-west',
    routeKind: RegionalRouteKind,
  ): Tile {
    if (!this.routeMaterials) return this.getTileAtResolution(tileX, tileY, requestedResolution);
    const resolution = this.selectResolution(requestedResolution);
    const key = `access:${tileX},${tileY}@${resolution}:${accessAxis}:${routeKind}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    const pixels: PixelGrid = [];
    const routeTexture = new Float64Array(3);
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        this.sampleTextureField(
          this.routeMaterials[routeKind],
          worldX,
          worldY,
          0x6b91,
          textureScaleTiles,
          resolution,
          routeTexture,
        );
        const crossAxis = accessAxis === 'north-south'
          ? (x + 0.5) / resolution
          : (y + 0.5) / resolution;
        const opacity = smoothstep(0, 0.34, crossAxis) * smoothstep(0, 0.34, 1 - crossAxis);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        row.push({
          r: linearToSrgb(lerp(srgbToLinear(beneath.r), routeTexture[0]!, opacity)),
          g: linearToSrgb(lerp(srgbToLinear(beneath.g), routeTexture[1]!, opacity)),
          b: linearToSrgb(lerp(srgbToLinear(beneath.b), routeTexture[2]!, opacity)),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-access:${tileX},${tileY}@${resolution}:${accessAxis}:${routeKind}`,
      name: 'Blended regional parcel access',
      pixels,
      materialMask: base.materialMask,
      walkable: true,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Reconstruct a continuous route-material path from one shared world-space
   * spline. Every touched tile samples the same distance field, so bends cross
   * tile and cache boundaries without an axis switch or painted square. */
  getPathAccessTile(
    tileX: number,
    tileY: number,
    path: RegionalParcelPath,
    routeKind: RegionalRouteKind,
    core: boolean,
    parcelLayout?: RegionalParcelLayout,
    waterfrontLayout?: RegionalWaterfrontLayout,
  ): Tile {
    return this.getPathAccessTileAtResolution(
      tileX,
      tileY,
      this.sourceSize,
      path,
      routeKind,
      core,
      parcelLayout,
      waterfrontLayout,
    );
  }

  getPathAccessTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    path: RegionalParcelPath,
    routeKind: RegionalRouteKind,
    core: boolean,
    parcelLayout?: RegionalParcelLayout,
    waterfrontLayout?: RegionalWaterfrontLayout,
  ): Tile {
    if (!this.routeMaterials) return this.getTileAtResolution(tileX, tileY, requestedResolution);
    const resolution = this.selectResolution(requestedResolution);
    const groundId = waterfrontLayout?.id ?? parcelLayout?.id ?? 'bare';
    const key = `path-access:${path.id}:${groundId}:${tileX},${tileY}@${resolution}:${routeKind}:${Number(core)}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = waterfrontLayout
      ? this.getWaterfrontGroundTileAtResolution(tileX, tileY, resolution, waterfrontLayout, routeKind)
      : parcelLayout
        ? this.getParcelGroundTileAtResolution(tileX, tileY, resolution, parcelLayout, routeKind)
        : this.getTileAtResolution(tileX, tileY, resolution);
    const pixels: PixelGrid = [];
    const routeTexture = new Float64Array(3);
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const distance = distanceToRegionalParcelPath(worldX, worldY, path);
        const opacity = 1 - smoothstep(
          path.radius - path.feather,
          path.radius + path.feather,
          distance,
        );
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        if (opacity <= 0.0001) {
          row.push(beneath);
          continue;
        }
        this.sampleTextureField(
          this.routeMaterials[routeKind],
          worldX,
          worldY,
          0x6b91,
          textureScaleTiles,
          resolution,
          routeTexture,
        );
        row.push({
          r: linearToSrgb(lerp(srgbToLinear(beneath.r), routeTexture[0]!, opacity)),
          g: linearToSrgb(lerp(srgbToLinear(beneath.g), routeTexture[1]!, opacity)),
          b: linearToSrgb(lerp(srgbToLinear(beneath.b), routeTexture[2]!, opacity)),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-path-access:${path.id}:${tileX},${tileY}@${resolution}`,
      name: 'Continuous curved regional parcel access',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable || core,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Compose a compound as continuous terrain, not a painted footprint. Plot
   * interiors derive from the biome beneath them, civic openings borrow the
   * local route material, and exact shared boundaries use one world-space SDF.
   * The result therefore agrees at tile edges, cache boundaries, and LODs. */
  getParcelGroundTile(
    tileX: number,
    tileY: number,
    layout: RegionalParcelLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    return this.getParcelGroundTileAtResolution(
      tileX,
      tileY,
      this.sourceSize,
      layout,
      routeKind,
    );
  }

  getParcelGroundTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    layout: RegionalParcelLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `parcel-ground:${layout.id}:${tileX},${tileY}@${resolution}:${routeKind}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    const pixels: PixelGrid = [];
    const routeTexture = new Float64Array(3);
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const sample = sampleRegionalParcelLayout(worldX, worldY, layout);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        if (sample.insideWeight <= 0.0001 && sample.boundaryWeight <= 0.0001) {
          row.push(beneath);
          continue;
        }
        let linearR = srgbToLinear(beneath.r);
        let linearG = srgbToLinear(beneath.g);
        let linearB = srgbToLinear(beneath.b);
        const patch = 0.5 + Math.sin(worldX * 0.83 + worldY * 0.47) * 0.5;
        const cultivation = sample.purpose === 'garden' ? 1 : 0.48;
        const yardOpacity = sample.yardWeight * (0.1 + cultivation * 0.14);
        linearR = lerp(linearR, linearR * (0.88 + patch * 0.08), yardOpacity);
        linearG = lerp(
          linearG,
          linearG * (0.98 + patch * 0.11) + 0.008 * cultivation,
          yardOpacity,
        );
        linearB = lerp(linearB, linearB * (0.84 + patch * 0.07), yardOpacity);
        if (sample.civicWeight > 0.0001 && this.routeMaterials) {
          this.sampleTextureField(
            this.routeMaterials[routeKind],
            worldX,
            worldY,
            0x3ed7,
            textureScaleTiles,
            resolution,
            routeTexture,
          );
          const civicOpacity = sample.civicWeight * 0.34;
          linearR = lerp(linearR, routeTexture[0]!, civicOpacity);
          linearG = lerp(linearG, routeTexture[1]!, civicOpacity);
          linearB = lerp(linearB, routeTexture[2]!, civicOpacity);
        }
        const boundaryOpacity = sample.boundaryWeight * 0.64;
        const boundaryScale = 0.58 + patch * 0.08;
        linearR = lerp(linearR, linearR * boundaryScale, boundaryOpacity);
        linearG = lerp(linearG, linearG * boundaryScale, boundaryOpacity);
        linearB = lerp(linearB, linearB * boundaryScale, boundaryOpacity);
        row.push({
          r: linearToSrgb(linearR),
          g: linearToSrgb(linearG),
          b: linearToSrgb(linearB),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-parcel-ground:${layout.id}:${tileX},${tileY}@${resolution}`,
      name: 'Shared-boundary regional parcel terrain',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Join authored settlement entrances to circulation with continuous
   * world-space paving. The focal layout owns geometry; this compositor only
   * reconstructs stone in linear light, retains biome beneath soft edges, and
   * respects water ownership from the composed material mask. */
  getLandmarkFabricGroundTile(
    tileX: number,
    tileY: number,
    layout: RegionalLandmarkFabricLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    return this.getLandmarkFabricGroundTileAtResolution(
      tileX,
      tileY,
      this.sourceSize,
      layout,
      routeKind,
    );
  }

  getLandmarkFabricGroundTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    layout: RegionalLandmarkFabricLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `landmark-fabric:${layout.id}:${tileX},${tileY}@${resolution}:${routeKind}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    if (!this.routeMaterials) {
      this.cache.set(key, base);
      return base;
    }
    const routeTexture = new Float64Array(3);
    const authoredFabric = this.landmarkFabricMaterials?.[layout.materialFamily];
    const fabricTextures = authoredFabric ?? this.routeMaterials[routeKind];
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    // Landmark stone is scale-authored for terminal walking detail. Sampling
    // one deterministic mapping preserves mortar contrast; the general
    // four-corner variant blend is valuable for open terrain but averages four
    // unrelated paver phases into a jointless wash on narrow frontages.
    const fabricTextureScaleTiles = authoredFabric ? 1.6 : textureScaleTiles;
    const authoredFabricHash = authoredFabric
      ? this.hash(Math.floor(layout.siteX), Math.floor(layout.siteY), 0x2d71)
      : 0;
    const authoredFabricTexture = authoredFabric
      ? authoredFabric[authoredFabricHash % authoredFabric.length]!
      : null;
    const authoredFabricLevel = authoredFabricTexture
      ? selectTextureLevelIndex(authoredFabricTexture, resolution, fabricTextureScaleTiles)
      : 0;
    const pixels: PixelGrid = [];
    let maximumPavingWeight = 0;
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const sample = sampleRegionalLandmarkFabricLayout(worldX, worldY, layout);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        const waterOwned = base.materialMask?.[y]?.[x] === 1;
        if (sample.pavingWeight <= 0.0001 || waterOwned) {
          row.push(beneath);
          continue;
        }
        maximumPavingWeight = Math.max(maximumPavingWeight, sample.pavingWeight);
        if (authoredFabricTexture) {
          sampleMappedTexture(
            authoredFabricTexture,
            authoredFabricLevel,
            worldX,
            worldY,
            fabricTextureScaleTiles,
            authoredFabricHash,
            routeTexture,
            0,
          );
        } else {
          this.sampleTextureField(
            fabricTextures,
            worldX,
            worldY,
            0x2d71,
            fabricTextureScaleTiles,
            resolution,
            routeTexture,
          );
        }
        const patch = valueNoise(worldX * 0.63, worldY * 0.63, this.seed32 ^ 0x7b51);
        const grain = valueNoise(worldX * 2.17, worldY * 2.17, this.seed32 ^ 0xc317);
        // Door thresholds read as worn warm limestone while narrow approaches
        // retain more of the terrain beneath. Both originate from the same
        // texture field, so the join cannot become a pasted sprite apron.
        const beneathR = srgbToLinear(beneath.r);
        const beneathG = srgbToLinear(beneath.g);
        const beneathB = srgbToLinear(beneath.b);
        const sourceMix = authoredFabric ? 0.22 - sample.commonWeight * 0.12 : 0.46;
        const warmth = authoredFabric
          ? sample.thresholdWeight * 0.008 + (patch + 1) * 0.0015
          : 0.012 + sample.thresholdWeight * 0.052 + (patch + 1) * 0.005;
        const paverScale = authoredFabric
          ? 0.78 + sample.thresholdWeight * 0.025 + sample.commonWeight * 0.12 + grain * 0.01
          : 1.06 + sample.thresholdWeight * 0.08 + grain * 0.02;
        const paverR = clamp01(lerp(routeTexture[0]!, beneathR, sourceMix) * paverScale + warmth);
        const paverG = clamp01(lerp(routeTexture[1]!, beneathG, sourceMix) * (paverScale + 0.005) + warmth * 0.55);
        const paverB = clamp01(lerp(routeTexture[2]!, beneathB, sourceMix) * (paverScale - 0.02) + warmth * 0.16);
        const opacity = sample.pavingWeight * (authoredFabric
          ? 0.46 + sample.thresholdWeight * 0.27 + sample.approachWeight * 0.03 +
            sample.commonWeight * 0.32
          : 0.7 + sample.thresholdWeight * 0.18);
        let linearR = lerp(beneathR, paverR, opacity);
        let linearG = lerp(beneathG, paverG, opacity);
        let linearB = lerp(beneathB, paverB, opacity);
        const edgeShade = sample.edgeWeight * 0.11;
        linearR *= 1 - edgeShade;
        linearG *= 1 - edgeShade * 0.88;
        linearB *= 1 - edgeShade * 0.72;
        row.push({
          r: linearToSrgb(linearR),
          g: linearToSrgb(linearG),
          b: linearToSrgb(linearB),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-landmark-fabric:${layout.id}:${tileX},${tileY}@${resolution}`,
      name: 'Continuous regional landmark entrance fabric',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable || maximumPavingWeight > 0.08,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Compose the shore program from continuous masks. Dry aprons and work
   * yards borrow local route material; over-water fingers borrow authored
   * bridge timber; slips remain water. Nothing owns a rectangular background. */
  getWaterfrontGroundTile(
    tileX: number,
    tileY: number,
    layout: RegionalWaterfrontLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    return this.getWaterfrontGroundTileAtResolution(
      tileX,
      tileY,
      this.sourceSize,
      layout,
      routeKind,
    );
  }

  getWaterfrontGroundTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    layout: RegionalWaterfrontLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `waterfront-ground:${layout.id}:${tileX},${tileY}@${resolution}:${routeKind}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    const pixels: PixelGrid = [];
    const routeTexture = new Float64Array(3);
    const pierTexture = new Float64Array(3);
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    const bridgeTextures = this.crossingMaterials?.bridge;
    let maximumWalkableSurfaceWeight = 0;
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const sample = sampleRegionalWaterfrontLayout(worldX, worldY, layout);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        const surfaceWeight = Math.max(
          sample.apronWeight,
          sample.workYardWeight,
          sample.pierWeight,
        );
        maximumWalkableSurfaceWeight = Math.max(maximumWalkableSurfaceWeight, surfaceWeight);
        if (surfaceWeight <= 0.0001 && sample.edgeWeight <= 0.0001) {
          row.push(beneath);
          continue;
        }
        let linearR = srgbToLinear(beneath.r);
        let linearG = srgbToLinear(beneath.g);
        let linearB = srgbToLinear(beneath.b);
        if ((sample.apronWeight > 0.0001 || sample.workYardWeight > 0.0001) && this.routeMaterials) {
          this.sampleTextureField(
            this.routeMaterials[routeKind],
            worldX,
            worldY,
            0x4f17,
            textureScaleTiles,
            resolution,
            routeTexture,
          );
          const dryOpacity = sample.apronWeight * 0.62 + sample.workYardWeight * 0.34;
          linearR = lerp(linearR, routeTexture[0]!, dryOpacity);
          linearG = lerp(linearG, routeTexture[1]!, dryOpacity);
          linearB = lerp(linearB, routeTexture[2]!, dryOpacity);
        }
        if (sample.pierWeight > 0.0001 && bridgeTextures) {
          this.sampleTextureField(
            bridgeTextures,
            worldX,
            worldY,
            0x79a3,
            textureScaleTiles,
            resolution,
            pierTexture,
          );
          const pierOpacity = sample.pierWeight * 0.94;
          linearR = lerp(linearR, pierTexture[0]!, pierOpacity);
          linearG = lerp(linearG, pierTexture[1]!, pierOpacity);
          linearB = lerp(linearB, pierTexture[2]!, pierOpacity);
        }
        const edgeOpacity = sample.edgeWeight * 0.56;
        linearR = lerp(linearR, linearR * 0.48, edgeOpacity);
        linearG = lerp(linearG, linearG * 0.5, edgeOpacity);
        linearB = lerp(linearB, linearB * 0.52, edgeOpacity);
        row.push({
          r: linearToSrgb(linearR),
          g: linearToSrgb(linearG),
          b: linearToSrgb(linearB),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-waterfront-ground:${layout.id}:${tileX},${tileY}@${resolution}`,
      name: 'Regional working-waterfront terrain',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable || maximumWalkableSurfaceWeight > 0.08,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Reconstruct a paired stone quay directly from one authoritative
   * constructed-waterway SDF. The dry ribbon is a place-scale material layer;
   * it never repaints water, and both banks share identical geometry at every
   * tile boundary and semantic zoom. */
  getQuayGroundTile(
    tileX: number,
    tileY: number,
    layout: RegionalQuayLayout,
  ): Tile {
    return this.getQuayGroundTileAtResolution(tileX, tileY, this.sourceSize, layout);
  }

  getQuayGroundTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    layout: RegionalQuayLayout,
  ): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `quay-ground:${layout.id}:${tileX},${tileY}@${resolution}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    const textures = this.landmarkFabricMaterials?.[layout.materialFamily] ??
      this.routeMaterials?.['local-road'];
    if (!textures || !this.field.sampleConstructedWaterway) return base;
    const pixels: PixelGrid = [];
    const quayTexture = new Float64Array(3);
    const textureScaleTiles = resolution <= 8 ? 2.4 : this.textureScaleForResolution(resolution);
    let maximumQuayWeight = 0;
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const sample = sampleRegionalQuayLayout(
          this.field.sampleConstructedWaterway(worldX, worldY, layout.waterwayId),
          layout,
        );
        maximumQuayWeight = Math.max(maximumQuayWeight, sample.quayWeight);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        if (sample.quayWeight <= 0.0001 && sample.watersideEdgeWeight <= 0.0001 &&
            sample.landsideEdgeWeight <= 0.0001) {
          row.push(beneath);
          continue;
        }
        this.sampleTextureField(
          textures,
          worldX,
          worldY,
          0x28b7,
          textureScaleTiles,
          resolution,
          quayTexture,
          this.variantPeriodTiles,
          false,
        );
        let linearR = srgbToLinear(beneath.r);
        let linearG = srgbToLinear(beneath.g);
        let linearB = srgbToLinear(beneath.b);
        const articulation = this.infrastructureVisualProfile.quaySurfaceArticulation;
        const articulationDetail = articulation * (resolution <= 8 ? 0.38 : 1);
        const edgeWearNoise = valueNoise(
          sample.progress * 57,
          sample.bankSide * 7.3,
          this.seed32 ^ 0x19c7,
        ) * 0.5 + 0.5;
        const edgeWearWeight = smoothstep(0.52, 0.82, edgeWearNoise) *
          (sample.watersideEdgeWeight * 0.34 + sample.landsideEdgeWeight * 0.16) *
          articulationDetail;
        const materialOpacity = sample.quayWeight * (resolution <= 8 ? 0.84 : 0.92) *
          (1 - edgeWearWeight);
        linearR = lerp(linearR, quayTexture[0]!, materialOpacity);
        linearG = lerp(linearG, quayTexture[1]!, materialOpacity);
        linearB = lerp(linearB, quayTexture[2]!, materialOpacity);
        const edgeVariation = 0.54 + 0.58 * (
          valueNoise(
            sample.progress * 31,
            sample.bankSide * 5.7,
            this.seed32 ^ 0x71e3,
          ) * 0.5 + 0.5
        );
        const edgeOpacity = (
          sample.watersideEdgeWeight * 0.42 + sample.landsideEdgeWeight * 0.14
        ) * lerp(1, edgeVariation, articulationDetail);
        linearR = lerp(linearR, linearR * 0.47, edgeOpacity);
        linearG = lerp(linearG, linearG * 0.5, edgeOpacity);
        linearB = lerp(linearB, linearB * 0.54, edgeOpacity);
        // Quays need enough repeated masonry logic to read as constructed,
        // but a perfectly even edge turns the entire canal into a ruler. The
        // waterway progress coordinate supplies continuous stone courses on
        // both banks; low-frequency world noise shifts individual joints and
        // varies contact wear without moving the physical quay boundary.
        if (articulation > 0.0001 && sample.quayWeight > 0.0001) {
          const jointCoordinate = sample.progress * 37 + valueNoise(
            worldX * 0.16,
            worldY * 0.16,
            this.seed32 ^ 0x36ad,
          ) * 0.13;
          const jointDistance = Math.abs(jointCoordinate - Math.round(jointCoordinate));
          const jointWeight = (1 - smoothstep(
            0.035,
            resolution <= 8 ? 0.16 : 0.095,
            jointDistance,
          )) * sample.quayWeight * articulation;
          const patinaNoise = valueNoise(
            worldX * 0.72 + sample.bankSide * 3.1,
            worldY * 0.72 - sample.bankSide * 2.3,
            this.seed32 ^ 0x4b91,
          ) * 0.5 + 0.5;
          const patinaWeight = smoothstep(0.56, 0.86, patinaNoise) *
            sample.quayWeight * articulation;
          const jointShade = jointWeight * (resolution <= 8 ? 0.035 : 0.085);
          linearR *= 1 - jointShade - patinaWeight * 0.045;
          linearG *= 1 - jointShade * 0.9 - patinaWeight * 0.03;
          linearB *= 1 - jointShade * 0.72 - patinaWeight * 0.055;
        }
        row.push({
          r: linearToSrgb(linearR),
          g: linearToSrgb(linearG),
          b: linearToSrgb(linearB),
        });
      }
      pixels.push(row);
    }
    const tile: Tile = {
      id: `regional-quay-ground:${layout.id}:${tileX},${tileY}@${resolution}`,
      name: 'Continuous regional canal quay',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable || maximumQuayWeight > 0.08,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
  }

  /** Reconstruct traversable terrain programs without a painted background.
   * Trails borrow the local route material; cave floors and rock boundaries
   * transform the already blended terrain in linear light. */
  getEnvironmentProgramGroundTile(
    tileX: number,
    tileY: number,
    layout: RegionalEnvironmentProgramLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    return this.getEnvironmentProgramGroundTileAtResolution(
      tileX,
      tileY,
      this.sourceSize,
      layout,
      routeKind,
    );
  }

  getEnvironmentProgramGroundTileAtResolution(
    tileX: number,
    tileY: number,
    requestedResolution: number,
    layout: RegionalEnvironmentProgramLayout,
    routeKind: RegionalRouteKind,
  ): Tile {
    const resolution = this.selectResolution(requestedResolution);
    const key = `environment-program:${layout.id}:${tileX},${tileY}@${resolution}:${routeKind}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached;
    }
    const base = this.getTileAtResolution(tileX, tileY, resolution);
    const routeTexture = new Float64Array(3);
    const textureScaleTiles = this.textureScaleForResolution(resolution);
    const pixels: PixelGrid = [];
    for (let y = 0; y < resolution; y++) {
      const row: RGB[] = [];
      for (let x = 0; x < resolution; x++) {
        const worldX = tileX + (x + 0.5) / resolution;
        const worldY = tileY + (y + 0.5) / resolution;
        const sample = sampleRegionalEnvironmentProgramLayout(worldX, worldY, layout);
        const beneath = base.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
        const trailWeight = Math.max(sample.accessTrailWeight, sample.highlandTrailWeight);
        if (Math.max(
          trailWeight,
          sample.caveFloorWeight,
          sample.caveWallWeight,
          sample.retainingEdgeWeight,
        ) <= 0.0001) {
          row.push(beneath);
          continue;
        }
        let linearR = srgbToLinear(beneath.r);
        let linearG = srgbToLinear(beneath.g);
        let linearB = srgbToLinear(beneath.b);
        if (trailWeight > 0.0001 && this.routeMaterials) {
          this.sampleTextureField(
            this.routeMaterials[routeKind],
            worldX,
            worldY,
            0x6bd1,
            textureScaleTiles,
            resolution,
            routeTexture,
          );
          const trailOpacity = sample.highlandTrailWeight * 0.68 + sample.accessTrailWeight * 0.56;
          linearR = lerp(linearR, routeTexture[0]!, trailOpacity);
          linearG = lerp(linearG, routeTexture[1]!, trailOpacity);
          linearB = lerp(linearB, routeTexture[2]!, trailOpacity);
        }
        const patch = clamp01(0.5 + (
          valueNoise(worldX * 0.38, worldY * 0.38, this.seed32 ^ 0x4c91) * 0.72 +
          valueNoise(worldX * 1.07, worldY * 1.07, this.seed32 ^ 0xa713) * 0.28
        ) * 0.5);
        if (sample.caveWallWeight > 0.0001) {
          const wallScale = 0.16 + patch * 0.1;
          linearR = lerp(linearR, linearR * wallScale + 0.004, sample.caveWallWeight * 0.9);
          linearG = lerp(linearG, linearG * wallScale + 0.004, sample.caveWallWeight * 0.9);
          linearB = lerp(linearB, linearB * (wallScale + 0.045) + 0.009, sample.caveWallWeight * 0.9);
        }
        if (sample.caveFloorWeight > 0.0001) {
          const beneathLuminance = linearR * 0.2126 + linearG * 0.7152 + linearB * 0.0722;
          const strata = valueNoise(worldX * 0.72, worldY * 0.72, this.seed32 ^ 0x53d1);
          const grain = valueNoise(worldX * 2.85, worldY * 2.85, this.seed32 ^ 0x7ab3);
          const crack = 1 - smoothstep(0.025, 0.095, Math.abs(strata));
          const pebble = smoothstep(0.55, 0.82, grain);
          const floorLuminance = (0.018 + beneathLuminance * (0.2 + patch * 0.12)) *
            (1 - crack * 0.28) + pebble * 0.018;
          const facet = grain * 0.012;
          linearR = lerp(linearR, floorLuminance * 0.76 + facet, sample.caveFloorWeight * 0.91);
          linearG = lerp(linearG, floorLuminance * 0.88 + facet, sample.caveFloorWeight * 0.91);
          linearB = lerp(linearB, floorLuminance * 1.14 + facet * 0.7, sample.caveFloorWeight * 0.91);
        }
        if (sample.retainingEdgeWeight > 0.0001) {
          const edgeOpacity = sample.retainingEdgeWeight * (1 - sample.highlandTrailWeight) * 0.5;
          linearR = lerp(linearR, linearR * 0.5, edgeOpacity);
          linearG = lerp(linearG, linearG * 0.52, edgeOpacity);
          linearB = lerp(linearB, linearB * 0.54, edgeOpacity);
        }
        row.push({
          r: linearToSrgb(linearR),
          g: linearToSrgb(linearG),
          b: linearToSrgb(linearB),
        });
      }
      pixels.push(row);
    }
    const centre = sampleRegionalEnvironmentProgramLayout(tileX + 0.5, tileY + 0.5, layout);
    const tile: Tile = {
      id: `regional-environment-program:${layout.id}:${tileX},${tileY}@${resolution}`,
      name: layout.kind === 'cave-interior' ? 'Regional cave interior' : 'Regional highland ascent',
      pixels,
      materialMask: base.materialMask,
      walkable: base.walkable || Math.max(
        centre.accessTrailWeight,
        centre.caveFloorWeight,
        centre.highlandTrailWeight,
      ) > 0.08,
      resolutions: { [String(resolution)]: pixels },
    };
    this.cache.set(key, tile);
    while (this.cache.size > this.maxCachedTiles) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.cache.delete(oldest);
    }
    return tile;
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
    void resolution;
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
    const quayTexture = new Float64Array(3);
    const routeTexture = new Float64Array(3);
    const routeBaseTexture = new Float64Array(3);
    const bridgeEdgeTexture = new Float64Array(3);
    const bridgeStructureTexture = new Float64Array(3);
    for (let y = 0; y < size; y++) {
      const row: RGB[] = [];
      const materialRow = new Uint8Array(size);
      const smoothV = smoothstep01((y + 0.5) / size);
      for (let x = 0; x < size; x++) {
        const smoothU = smoothstep01((x + 0.5) / size);
        const worldX = tileX + (x + 0.5) / size;
        const worldY = tileY + (y + 0.5) / size;
        const weights = interpolateWeights(samples, smoothU, smoothV);
        const waterCoverage = bilerp(
          Number(samples[0].isWater),
          Number(samples[1].isWater),
          Number(samples[2].isWater),
          Number(samples[3].isWater),
          smoothU,
          smoothV,
        );
        const ecology = strongestEcologicalPair(weights);
        // Cultural families describe constructed dry ground. Hydrology owns
        // wet pixels absolutely: without this separation a strong canal-town
        // weight repaints a physically wet canal as beige paving while the
        // collision mask still calls it water. Fade cultural overlays before
        // the wet boundary and reconstruct visible water from the authored
        // coast/water material instead.
        const dryCoverage = 1 - smoothstep(0.08, 0.72, waterCoverage);
        const waterMaterialWeight = smoothstep(0.12, 0.78, waterCoverage);
        const canalOverlay = smoothstep(0.12, 0.62, weights[0]) * dryCoverage;
        const ruinsOverlay = smoothstep(0.14, 0.68, weights[5]) * dryCoverage;
        const needed = new Set<number>([ecology[0], ecology[1]]);
        if (waterMaterialWeight > 0.001) needed.add(COAST);
        if (canalOverlay > 0.001) needed.add(0);
        if (ruinsOverlay > 0.001) needed.add(5);
        for (const familyIndex of needed) {
          const family = BIOME_FAMILIES[familyIndex]!;
          const useOverview = size <= 8 && this.overviewMaterials !== undefined;
          this.sampleTextureField(
            useOverview ? this.overviewMaterials![family] : this.materials[family],
            worldX,
            worldY,
            0x93d7 + familyIndex * 0x1f123,
            useOverview ? this.overviewTextureScaleTiles : textureScaleTiles,
            size,
            textureSamples[familyIndex]!,
            useOverview ? this.overviewVariantPeriodTiles : this.variantPeriodTiles,
            useOverview,
          );
        }
        const firstWeight = weights[ecology[0]]!;
        const secondWeight = weights[ecology[1]]!;
        const ecologicalTotal = Math.max(1e-9, firstWeight + secondWeight);
        const ecologicalMix = secondWeight / ecologicalTotal;
        const first = textureSamples[ecology[0]]!;
        const second = textureSamples[ecology[1]]!;
        const water = textureSamples[COAST]!;
        const town = textureSamples[0]!;
        const ruins = textureSamples[5]!;
        const groundLinear = [0, 1, 2].map((channel) => {
          const ecological = lerp(first[channel]!, second[channel]!, ecologicalMix);
          const withTown = lerp(ecological, town[channel]!, canalOverlay);
          return lerp(
            withTown,
            ruins[channel]!,
            ruinsOverlay * (0.88 - canalOverlay * 0.2),
          );
        });
        let linear = groundLinear.map((value, channel) => (
          lerp(value, water[channel]!, waterMaterialWeight)
        ));
        const currentStrength = size <= 8
          ? this.waterVisualProfile.overviewCurrentStrength
          : this.waterVisualProfile.detailCurrentStrength;
        if (currentStrength > 0.0001 && waterMaterialWeight > 0.0001) {
          const waterway = this.field.sampleConstructedWaterway?.(worldX, worldY);
          let tangentX: number;
          let tangentY: number;
          if (waterway && waterway.signedDistance < 0.8) {
            tangentX = waterway.tangentX;
            tangentY = waterway.tangentY;
          } else {
            const angle = valueNoise(
              worldX * 0.012,
              worldY * 0.012,
              this.seed32 ^ 0x27f1,
            ) * Math.PI;
            tangentX = Math.cos(angle);
            tangentY = Math.sin(angle);
          }
          const along = worldX * tangentX + worldY * tangentY;
          const across = worldX * -tangentY + worldY * tangentX;
          const broadCurrent = valueNoise(
            along * 0.045,
            across * 0.46,
            this.seed32 ^ 0x5a13,
          );
          const fineCurrent = valueNoise(
            along * 0.13 + broadCurrent * 0.8,
            across * 1.08,
            this.seed32 ^ 0x6ce9,
          );
          const current = broadCurrent * 0.72 + fineCurrent * 0.28;
          const waterStrength = currentStrength * waterMaterialWeight;
          const phaseWarp = valueNoise(
            along * 0.17,
            across * 0.11,
            this.seed32 ^ 0x1d8f,
          ) * 2.7;
          const crestPhase = across * (size <= 8 ? 2.05 : 4.4) +
            along * (size <= 8 ? 0.08 : 0.22) + phaseWarp;
          const crestSignal = Math.sin(crestPhase) * 0.72 +
            Math.sin(crestPhase * 0.47 + broadCurrent * 2.2) * 0.28;
          const crest = smoothstep(0.46, 0.9, crestSignal) * waterStrength;
          const glint = smoothstep(0.42, 0.9, current) * waterStrength;
          const constructedDepth = waterway && waterway.signedDistance < 0
            ? smoothstep(
                0.08,
                0.82,
                -waterway.signedDistance / Math.max(0.1, waterway.halfWidth),
              )
            : 0;
          const bankShallow = waterway && waterway.signedDistance < 0
            ? 1 - constructedDepth
            : 0;
          linear[0] = clamp01(
            linear[0]! * (
              1 + current * waterStrength * 0.32 - constructedDepth * waterStrength * 0.1
            ) + glint * 0.01 + crest * 0.018 + bankShallow * waterStrength * 0.012,
          );
          linear[1] = clamp01(
            linear[1]! * (
              1 + current * waterStrength * 0.46 - constructedDepth * waterStrength * 0.055
            ) + glint * 0.016 + crest * 0.032 + bankShallow * waterStrength * 0.022,
          );
          linear[2] = clamp01(
            linear[2]! * (
              1 + current * waterStrength * 0.62 + constructedDepth * waterStrength * 0.025
            ) + glint * 0.022 + crest * 0.044 + bankShallow * waterStrength * 0.018,
          );
        }
        // A strong canal-town field turns the physically reconstructed shore
        // into a civic edge on its dry side. This is not a rectangular quay
        // sprite: the band follows the same continuous hydrology ownership as
        // the collision mask, samples scale-authored limestone in world space,
        // and leaves the wet side under water ownership. The adjacent narrow
        // contact shadow keeps the quay legible after ANSI reduction.
        const detailQuayTextures = this.landmarkFabricMaterials?.['canal-town'];
        const quayTextures = size <= 8 ? this.materials['canal-town'] : detailQuayTextures;
        const townConstruction = smoothstep(0.42, 0.78, weights[0]);
        const quayWeight = townConstruction *
          smoothstep(0.16, 0.34, waterCoverage) *
          (1 - smoothstep(0.43, 0.54, waterCoverage));
        if (quayTextures && quayWeight > 0.0001) {
          this.sampleTextureField(
            quayTextures,
            worldX,
            worldY,
            0x51a7,
            size <= 8 ? textureScaleTiles : 1.6,
            size,
            quayTexture,
            this.variantPeriodTiles,
            false,
          );
          const quayOpacity = size <= 8 ? 0.44 : 0.72;
          linear = linear.map((value, channel) => (
            lerp(value, quayTexture[channel]!, quayWeight * quayOpacity)
          ));
        }
        const wetContactWeight = townConstruction *
          smoothstep(0.46, 0.54, waterCoverage) *
          (1 - smoothstep(0.66, 0.78, waterCoverage));
        if (wetContactWeight > 0.0001) {
          const contactOpacity = size <= 8 ? 0.12 : 0.2;
          linear = linear.map((value) => value * (1 - wetContactWeight * contactOpacity));
        }
        const routeLayer = routeSamples
          ? selectRouteLayer(routeSamples, smoothU, smoothV)
          : null;
        const visualCrossingKind = routeLayer?.sample.crossingKind === 'bridge' ||
            routeLayer?.sample.crossingInfluenceKind === 'bridge'
          ? 'bridge'
          : routeLayer?.sample.crossingKind ?? null;
        if (routeLayer && visualCrossingKind !== 'ferry' && this.routeMaterials) {
          // At overview scales a narrow, physically dry shore corridor can be
          // visually submerged by bilinear water reconstruction even though
          // route routing and collision correctly see land. Restore a soft
          // shoulder from the same local ground reconstruction before laying
          // the road. Crossing semantics stay authoritative: no shoulder is
          // applied to a physically wet bridge/ford/ferry core, and the water
          // material mask below is untouched.
          if (routeLayer.sample.crossingKind === null && waterMaterialWeight > 0.0001) {
            const shoulderSection = 1 - smoothstep(
              size <= 8 ? 0.58 : 0.72,
              size <= 8 ? 1.28 : 1.16,
              routeLayer.normalizedDistance,
            );
            const shoulderCoverage = smoothstep(0.04, 0.42, routeLayer.opacity) *
              shoulderSection * waterMaterialWeight * (size <= 8 ? 0.78 : 0.48);
            linear = linear.map((value, channel) => (
              lerp(value, groundLinear[channel]!, shoulderCoverage)
            ));
          }
          const crossingTextures = visualCrossingKind
            ? this.crossingMaterials?.[visualCrossingKind]
            : undefined;
          const routeTextures = crossingTextures ?? this.routeMaterials[routeLayer.sample.routeKind!];
          const surfaceStyle = visualCrossingKind
            ? this.crossingSurfaceStyles?.[visualCrossingKind]
            : this.routeSurfaceStyles?.[routeLayer.sample.routeKind!];
          const routeBaseStyle = routeLayer.sample.routeKind
            ? this.routeSurfaceStyles?.[routeLayer.sample.routeKind]
            : undefined;
          const isBridge = visualCrossingKind === 'bridge';
          const bridgeProgress = isBridge && Number.isFinite(routeLayer.sample.crossingProgress)
            ? Math.abs(routeLayer.sample.crossingProgress)
            : 0;
          const approachBlend = isBridge
            ? smoothstep(0.94, 1.62, bridgeProgress)
            : 0;
          let textureX = worldX;
          let textureY = worldY;
          let routeTangentX = 0;
          let routeTangentY = 0;
          if (isBridge) {
            const directionLength = Math.hypot(
              routeLayer.sample.directionX,
              routeLayer.sample.directionY,
            );
            if (directionLength > 0.1) {
              routeTangentX = routeLayer.sample.directionX / directionLength;
              routeTangentY = routeLayer.sample.directionY / directionLength;
              textureX = worldX * -routeTangentY + worldY * routeTangentX;
              textureY = worldX * routeTangentX + worldY * routeTangentY;
            }
          }
          this.sampleTextureField(
            routeTextures,
            textureX,
            textureY,
            0x4d71,
            surfaceStyle?.textureScaleTiles ?? textureScaleTiles,
            size,
            routeTexture,
          );
          if (isBridge && approachBlend > 0.0001 && routeLayer.sample.routeKind) {
            const routeBaseTextures = this.routeMaterials[routeLayer.sample.routeKind];
            this.sampleTextureField(
              routeBaseTextures,
              worldX,
              worldY,
              0x4d71,
              routeBaseStyle?.textureScaleTiles ?? textureScaleTiles,
              size,
              routeBaseTexture,
            );
            for (let channel = 0; channel < 3; channel++) {
              routeTexture[channel] = lerp(
                routeTexture[channel]!,
                routeBaseTexture[channel]!,
                approachBlend,
              );
            }
          }
          // Constructed streets inside a strong canal-town fabric should read
          // as part of that place rather than as the same dark earth ribbon
          // used between settlements. Borrow a restrained amount of the
          // authored limestone vocabulary for local roads and arterials. The
          // continuous route SDF still owns geometry and collision, while the
          // biome field owns where this contextual material is eligible.
          const civicStreetWeight = visualCrossingKind === null &&
              routeLayer.sample.routeKind !== 'trail'
            ? townConstruction * (size <= 8
              ? this.infrastructureVisualProfile.overviewCivicStreetMix
              : this.infrastructureVisualProfile.detailCivicStreetMix)
            : 0;
          if (civicStreetWeight > 0.0001 && quayTextures) {
            this.sampleTextureField(
              quayTextures,
              worldX,
              worldY,
              0x6ad3,
              size <= 8 ? textureScaleTiles : 1.6,
              size,
              quayTexture,
              this.variantPeriodTiles,
              false,
            );
            for (let channel = 0; channel < 3; channel++) {
              routeTexture[channel] = lerp(
                routeTexture[channel]!,
                quayTexture[channel]!,
                civicStreetWeight,
              );
            }
          }
          // Preserve timber identity but lift it out of the road shadow band.
          // The values are linear-light channel lifts, deliberately warmer at
          // walking scale and quieter in overview LODs.
          if (isBridge) {
            const timberLift = size <= 8
              ? [0.022, 0.012, 0.003]
              : [0.055, 0.03, 0.008];
            for (let channel = 0; channel < 3; channel++) {
              routeTexture[channel] = Math.min(
                1,
                routeTexture[channel]! * (channel === 0 ? 1.08 : channel === 1 ? 1.05 : 1.02) +
                  timberLift[channel]!,
              );
              bridgeEdgeTexture[channel] = routeTexture[channel]!;
            }
            const civicBridgeWeight = townConstruction *
              this.infrastructureVisualProfile.civicBridgeDeckMix *
              (size <= 8 ? 0.72 : 1) *
              (1 - approachBlend);
            if (civicBridgeWeight > 0.0001 && quayTextures) {
              this.sampleTextureField(
                quayTextures,
                textureX,
                textureY,
                0x7b19,
                size <= 8 ? 3.8 : 2.2,
                size,
                quayTexture,
                this.variantPeriodTiles,
                false,
              );
              for (let channel = 0; channel < 3; channel++) {
                routeTexture[channel] = lerp(
                  routeTexture[channel]!,
                  quayTexture[channel]!,
                  civicBridgeWeight,
                );
              }
            }
          }
          const crossingOpacity = visualCrossingKind === 'ford' ? 0.48 : 1;
          const crossingAuthoredOpacity = surfaceStyle
            ? (size <= 8 ? surfaceStyle.overviewOpacity : surfaceStyle.detailOpacity)
            : 1;
          const routeAuthoredOpacity = routeBaseStyle
            ? (size <= 8 ? routeBaseStyle.overviewOpacity : routeBaseStyle.detailOpacity)
            : crossingAuthoredOpacity;
          const authoredOpacity = lerp(
            crossingAuthoredOpacity,
            routeAuthoredOpacity,
            approachBlend,
          );
          const crossingAuthoredWidth = surfaceStyle
            ? (size <= 8 ? surfaceStyle.overviewWidthScale : surfaceStyle.detailWidthScale)
            : 1;
          const routeAuthoredWidth = routeBaseStyle
            ? (size <= 8 ? routeBaseStyle.overviewWidthScale : routeBaseStyle.detailWidthScale)
            : crossingAuthoredWidth;
          const authoredWidth = lerp(
            crossingAuthoredWidth,
            routeAuthoredWidth,
            approachBlend,
          );
          const bankContact = isBridge
            ? bridgeBankContact(waterCoverage)
            : 0;
          const shapedCoverage = isBridge
            ? bridgeShapeCoverage(
                routeLayer.opacity,
                routeLayer.normalizedDistance,
                bankContact,
                authoredWidth,
                bridgeProgress,
                this.infrastructureVisualProfile.bridgeLandingFlareScale,
                this.infrastructureVisualProfile.bridgeMidspanWaistScale,
              )
            : routeShapeCoverage(
                routeLayer.opacity,
                routeLayer.normalizedDistance,
                authoredWidth,
              );
          const coastalSubgrade = visualCrossingKind === null
            ? smoothstep(0.18, 0.62, weights[COAST]) *
              smoothstep(0.04, 0.42, routeLayer.opacity) *
              (1 - smoothstep(
                authoredWidth * 0.72,
                authoredWidth * (size <= 8 ? 1.58 : 1.34),
                routeLayer.normalizedDistance,
              )) * (size <= 8 ? 0.34 : 0.18)
            : 0;
          if (coastalSubgrade > 0.0001) {
            linear = linear.map((value, channel) => lerp(
              value,
              Math.min(1, routeTexture[channel]! * 1.08 + 0.012),
              coastalSubgrade,
            ));
          }
          const opacity = shapedCoverage * crossingOpacity * authoredOpacity;
          linear = linear.map((value, channel) => lerp(value, routeTexture[channel]!, opacity));
          if (isBridge) {
            // A bridge is a deck plus load-bearing substructure, not a timber-
            // filled route rectangle. Continuous hydrology locates both bank
            // seats; normalized route distance owns the transverse section;
            // the route-aligned longitudinal frame places sparse pier rhythm.
            // The same deck coverage below remains the walkability authority.
            const structurePresence = 1 - smoothstep(0.98, 1.38, bridgeProgress);
            const deckInterior = shapedCoverage * structurePresence *
              (1 - smoothstep(0.56, 0.72, routeLayer.normalizedDistance));
            const deckLift = size <= 8
              ? [0.018, 0.01, 0.003]
              : [0.052, 0.028, 0.009];
            linear = linear.map((value, channel) => Math.min(
              1,
              value + deckInterior * deckLift[channel]!,
            ));
            const edgeBeam = smoothstep(0.74, 0.8, routeLayer.normalizedDistance) *
              (1 - smoothstep(0.88, 0.94, routeLayer.normalizedDistance)) *
              structurePresence;
            const span = Math.max(0, routeLayer.sample.crossingSpan);
            const panelCount = Math.max(2, Math.round(span / 2.6));
            const panelPosition = (routeLayer.sample.crossingProgress + 1) * panelCount / 2;
            const postDistance = Math.abs(panelPosition - Math.round(panelPosition));
            const postBeam = Number.isFinite(postDistance)
              ? 1 - smoothstep(0.08, 0.22, postDistance)
              : 0;
            const supportTarget = span >= 9 ? 0.46 : 0;
            const supportDistance = supportTarget > 0
              ? Math.min(
                  Math.abs(routeLayer.sample.crossingProgress - supportTarget),
                  Math.abs(routeLayer.sample.crossingProgress + supportTarget),
                )
              : Math.abs(routeLayer.sample.crossingProgress);
            const supportBeam = span >= 6
              ? 1 - smoothstep(0.055, 0.14, supportDistance)
              : 0;
            const wetStructure = smoothstep(0.38, 0.78, waterCoverage);
            const outerSupportZone = smoothstep(0.82, 0.94, routeLayer.normalizedDistance) *
              (1 - smoothstep(1.08, 1.24, routeLayer.normalizedDistance));
            const abutmentWeight = bridgeAbutmentCoverage(
              routeLayer.opacity,
              routeLayer.normalizedDistance,
              bankContact,
              bridgeProgress,
            );
            const pierWeight = routeLayer.opacity * wetStructure * outerSupportZone * supportBeam;
            const structureWeight = abutmentWeight;
            const structureTextures = this.routeMaterials.arterial;
            if (structureWeight > 0.0001 && structureTextures) {
              const structureStyle = this.routeSurfaceStyles?.arterial;
              this.sampleTextureField(
                structureTextures,
                textureX,
                textureY,
                0x2ab7,
                structureStyle?.textureScaleTiles ?? textureScaleTiles,
                size,
                bridgeStructureTexture,
              );
              linear = linear.map((value, channel) => (
                lerp(
                  value,
                  Math.min(1, bridgeStructureTexture[channel]! * 1.15 + 0.025),
                  structureWeight * 0.96,
                )
              ));
            }
            const normalX = -routeTangentY;
            const normalY = routeTangentX;
            const lightNormal = normalX * -0.58 + normalY * -0.82;
            const signedSide = Math.max(
              -1,
              Math.min(1, routeLayer.normalizedSignedDistance / 0.45),
            );
            const lightFacing = signedSide * lightNormal;
            const railZone = smoothstep(0.74, 0.8, routeLayer.normalizedDistance) *
              (1 - smoothstep(0.88, 0.94, routeLayer.normalizedDistance));
            const railWeight = routeLayer.opacity * railZone * structurePresence *
              (0.22 + postBeam * 0.7);
            linear = linear.map((value, channel) => (
              lerp(value, bridgeEdgeTexture[channel]!, railWeight * 0.84)
            ));
            if (lightFacing < 0) {
              linear = linear.map((value) => value * (1 - railWeight * -lightFacing * 0.1));
            }
            const shadowSide = smoothstep(0.08, 0.72, -lightFacing);
            const sideShadow = routeLayer.opacity * wetStructure * shadowSide *
              smoothstep(0.84, 0.96, routeLayer.normalizedDistance) *
              (1 - smoothstep(1.12, 1.34, routeLayer.normalizedDistance));
            const constructionShade = Math.min(
              0.28,
                edgeBeam * 0.16 +
                supportBeam * shapedCoverage * (size <= 8 ? 0.04 : 0.08) +
                pierWeight * (size <= 8 ? 0.08 : 0.16) +
                sideShadow * (size <= 8 ? 0.1 : 0.16),
            );
            linear = linear.map((value) => value * (1 - constructionShade));
          }
        }
        row.push({
          r: linearToSrgb(linear[0]!),
          g: linearToSrgb(linear[1]!),
          b: linearToSrgb(linear[2]!),
        });
        const bridgeBankWeight = bridgeBankContact(waterCoverage);
        const bridgeSurfaceStyle = routeLayer?.sample.crossingKind === 'bridge'
          ? this.crossingSurfaceStyles?.bridge
          : undefined;
        const bridgeWidthScale = bridgeSurfaceStyle
          ? (size <= 8
              ? bridgeSurfaceStyle.overviewWidthScale
              : bridgeSurfaceStyle.detailWidthScale)
          : 1;
        const bridgeCoverage = routeLayer?.sample.crossingKind === 'bridge'
          ? bridgeShapeCoverage(
              routeLayer.opacity,
              routeLayer.normalizedDistance,
              bridgeBankWeight,
              bridgeWidthScale,
              Number.isFinite(routeLayer.sample.crossingProgress)
                ? Math.abs(routeLayer.sample.crossingProgress)
                : 0,
              this.infrastructureVisualProfile.bridgeLandingFlareScale,
              this.infrastructureVisualProfile.bridgeMidspanWaistScale,
            )
          : 0;
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
    variantPeriodTiles = this.variantPeriodTiles,
    interpolateSource = false,
  ): void {
    if (this.textureReconstruction === 'triangle-bounded-window') {
      const reference = selectTextureLevel(textures[0]!, outputSize, textureScaleTiles);
      if (!interpolateSource && boundedWindowFits(
        reference,
        variantPeriodTiles,
        textureScaleTiles,
      )) {
        this.sampleTriangleBoundedWindow(
          textures,
          worldX,
          worldY,
          salt,
          textureScaleTiles,
          outputSize,
          out,
          variantPeriodTiles,
        );
        return;
      }
    }
    if (this.textureReconstruction === 'hex-contrast') {
      this.sampleHexContrast(
        textures,
        worldX,
        worldY,
        salt,
        textureScaleTiles,
        outputSize,
        out,
        variantPeriodTiles,
      );
      return;
    }
    if (this.textureReconstruction === 'hex-laplacian') {
      this.sampleHexLaplacian(
        textures,
        worldX,
        worldY,
        salt,
        textureScaleTiles,
        outputSize,
        out,
        variantPeriodTiles,
      );
      return;
    }
    if (this.textureReconstruction === 'cellular-semantic') {
      this.sampleCellularSemantic(
        textures,
        worldX,
        worldY,
        salt,
        textureScaleTiles,
        outputSize,
        out,
        variantPeriodTiles,
      );
      return;
    }
    this.sampleSquareBilinear(
      textures,
      worldX,
      worldY,
      salt,
      textureScaleTiles,
      outputSize,
      out,
      variantPeriodTiles,
      interpolateSource,
    );
  }

  private sampleTriangleBoundedWindow(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
    variantPeriodTiles: number,
  ): void {
    triangleGrid(
      worldX,
      worldY,
      variantPeriodTiles,
      this.triangleWeights,
      this.triangleVertices,
    );
    for (let vertex = 0; vertex < 3; vertex++) {
      const vertexX = this.triangleVertices[vertex * 2]!;
      const vertexY = this.triangleVertices[vertex * 2 + 1]!;
      const hash = this.hash(vertexX, vertexY, salt ^ 0x41c64e6d);
      const texture = textures[hash % textures.length]!;
      const level = selectTextureLevel(texture, outputSize, textureScaleTiles);
      const support = variantPeriodTiles * level.width / textureScaleTiles;
      const vertexWorldX = (vertexX + vertexY * 0.5) * variantPeriodTiles;
      const vertexWorldY = vertexY * Math.sqrt(3) * 0.5 * variantPeriodTiles;
      let localX = (worldX - vertexWorldX) * level.width / textureScaleTiles;
      let localY = (worldY - vertexWorldY) * level.height / textureScaleTiles;
      switch ((hash >>> 27) & 7) {
        case 1: [localX, localY] = [-localY, localX]; break;
        case 2: [localX, localY] = [-localX, -localY]; break;
        case 3: [localX, localY] = [localY, -localX]; break;
        case 4: localX = -localX; break;
        case 5: localY = -localY; break;
        case 6: [localX, localY] = [localY, localX]; break;
        case 7: [localX, localY] = [-localY, -localX]; break;
      }
      const centreRangeX = Math.max(0, level.width - 1 - support * 2);
      const centreRangeY = Math.max(0, level.height - 1 - support * 2);
      const sampleX = support + centreRangeX * ((hash >>> 8) & 0xff) / 255 + localX;
      const sampleY = support + centreRangeY * ((hash >>> 16) & 0xff) / 255 + localY;
      const sourceX = Math.max(0, Math.min(level.width - 1, Math.floor(sampleX)));
      const sourceY = Math.max(0, Math.min(level.height - 1, Math.floor(sampleY)));
      const source = (sourceY * level.width + sourceX) * 3;
      const target = vertex * 3;
      this.hexSamples[target] = level.linear[source]!;
      this.hexSamples[target + 1] = level.linear[source + 1]!;
      this.hexSamples[target + 2] = level.linear[source + 2]!;
    }
    blendHexSamples(
      this.hexSamples,
      0,
      this.triangleWeights,
      1,
      0,
      out,
    );
  }

  private sampleSquareBilinear(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
    variantPeriodTiles: number,
    interpolateSource: boolean,
  ): void {
    out.fill(0);
    const fieldX = worldX / variantPeriodTiles;
    const fieldY = worldY / variantPeriodTiles;
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
        const sampleX = mirrorCoordinate(
          worldX * level.width / textureScaleTiles + phaseX,
          level.width,
        );
        const sampleY = mirrorCoordinate(
          worldY * level.height / textureScaleTiles + phaseY,
          level.height,
        );
        const x0 = Math.floor(sampleX);
        const y0 = Math.floor(sampleY);
        if (!interpolateSource) {
          const index = (y0 * level.width + x0) * 3;
          out[0] = out[0]! + level.linear[index]! * weight;
          out[1] = out[1]! + level.linear[index + 1]! * weight;
          out[2] = out[2]! + level.linear[index + 2]! * weight;
          continue;
        }
        const x1 = Math.min(level.width - 1, x0 + 1);
        const y1 = Math.min(level.height - 1, y0 + 1);
        const u = sampleX - x0;
        const v = sampleY - y0;
        for (let channel = 0; channel < 3; channel++) {
          const top = lerp(
            level.linear[(y0 * level.width + x0) * 3 + channel]!,
            level.linear[(y0 * level.width + x1) * 3 + channel]!,
            u,
          );
          const bottom = lerp(
            level.linear[(y1 * level.width + x0) * 3 + channel]!,
            level.linear[(y1 * level.width + x1) * 3 + channel]!,
            u,
          );
          out[channel] = out[channel]! + lerp(top, bottom, v) * weight;
        }
      }
    }
  }

  /** Three randomized source mappings over a triangular lattice, adapted from
   * Mikkelsen's practical real-time hex tiling. Sharpened barycentric weights
   * retain authored features while the oblique lattice removes the square
   * cadence of the original four-corner blend. */
  private sampleHexContrast(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
    variantPeriodTiles: number,
  ): void {
    triangleGrid(
      worldX,
      worldY,
      variantPeriodTiles,
      this.triangleWeights,
      this.triangleVertices,
    );
    for (let vertex = 0; vertex < 3; vertex++) {
      const vertexX = this.triangleVertices[vertex * 2]!;
      const vertexY = this.triangleVertices[vertex * 2 + 1]!;
      const hash = this.hash(vertexX, vertexY, salt);
      const texture = textures[hash % textures.length]!;
      const levelIndex = selectTextureLevelIndex(texture, outputSize, textureScaleTiles);
      sampleMappedTexture(
        texture,
        levelIndex,
        worldX,
        worldY,
        textureScaleTiles,
        hash,
        this.hexSamples,
        vertex * 3,
      );
    }
    blendHexSamples(
      this.hexSamples,
      0,
      this.triangleWeights,
      7,
      0.6,
      out,
    );
  }

  /** Two-band reconstruction inspired by Laplacian texture blending. Broad
   * colour masses use a three-times larger independently randomized field;
   * only the fine high-pass residual repeats at the authored detail scale.
   * Fine weights are sharpened, so local stones, leaves, and brush marks do
   * not dissolve into the ghosted average produced by ordinary blending. */
  private sampleHexLaplacian(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
    variantPeriodTiles: number,
  ): void {
    const broadScale = textureScaleTiles * 3;
    triangleGrid(
      worldX,
      worldY,
      variantPeriodTiles * 3,
      this.triangleWeights,
      this.triangleVertices,
    );
    for (let vertex = 0; vertex < 3; vertex++) {
      const vertexX = this.triangleVertices[vertex * 2]!;
      const vertexY = this.triangleVertices[vertex * 2 + 1]!;
      const hash = this.hash(vertexX, vertexY, salt ^ 0x62f39a17);
      const texture = textures[hash % textures.length]!;
      const selected = selectTextureLevelIndex(texture, outputSize, broadScale);
      const broadLevel = Math.min(texture.levels.length - 1, selected + 2);
      sampleMappedTexture(
        texture,
        broadLevel,
        worldX,
        worldY,
        broadScale,
        hash,
        this.hexSamples,
        vertex * 3,
      );
    }
    blendHexSamples(
      this.hexSamples,
      0,
      this.triangleWeights,
      2,
      0,
      out,
    );

    triangleGrid(
      worldX,
      worldY,
      variantPeriodTiles,
      this.triangleWeights,
      this.triangleVertices,
    );
    for (let vertex = 0; vertex < 3; vertex++) {
      const vertexX = this.triangleVertices[vertex * 2]!;
      const vertexY = this.triangleVertices[vertex * 2 + 1]!;
      const hash = this.hash(vertexX, vertexY, salt ^ 0x39d17b5d);
      const texture = textures[hash % textures.length]!;
      const fineLevel = selectTextureLevelIndex(texture, outputSize, textureScaleTiles);
      const coarseLevel = Math.min(texture.levels.length - 1, fineLevel + 2);
      sampleMappedTexture(
        texture,
        fineLevel,
        worldX,
        worldY,
        textureScaleTiles,
        hash,
        this.hexSamples,
        9 + vertex * 3,
      );
      sampleMappedTexture(
        texture,
        coarseLevel,
        worldX,
        worldY,
        textureScaleTiles,
        hash,
        this.hexSamples,
        18 + vertex * 3,
      );
      for (let channel = 0; channel < 3; channel++) {
        this.hexSamples[9 + vertex * 3 + channel] =
          this.hexSamples[9 + vertex * 3 + channel]! -
          this.hexSamples[18 + vertex * 3 + channel]!;
      }
    }
    const detail = this.hexSamples.subarray(0, 3);
    blendHexSamples(
      this.hexSamples,
      9,
      this.triangleWeights,
      7,
      0,
      detail,
    );
    out[0] = out[0]! + detail[0]!;
    out[1] = out[1]! + detail[1]!;
    out[2] = out[2]! + detail[2]!;
  }

  /** Four nearest sites from a coordinate-stable jittered lattice provide an
   * irregular patch neighborhood without square or hex boundaries. District
   * zoom adds two mip levels and regional zoom adds one: foliage, pebbles, and
   * grout remain authored at walking scale but become broad material value and
   * hue at map scale instead of aliasing into decorative tapestry. */
  private sampleCellularSemantic(
    textures: readonly PreparedTexture[],
    worldX: number,
    worldY: number,
    salt: number,
    textureScaleTiles: number,
    outputSize: number,
    out: Float64Array,
    variantPeriodTiles: number,
  ): void {
    const cellSpan = variantPeriodTiles * 2;
    const cellX = Math.floor(worldX / cellSpan);
    const cellY = Math.floor(worldY / cellSpan);
    this.cellularDistances.fill(Number.POSITIVE_INFINITY);
    this.cellularHashes.fill(0);
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const candidateX = cellX + offsetX;
        const candidateY = cellY + offsetY;
        const hash = this.hash(candidateX, candidateY, salt ^ 0x7f4a7c15);
        const jitterX = 0.14 + (hash & 0xffff) / 0xffff * 0.72;
        const jitterY = 0.14 + (hash >>> 16) / 0xffff * 0.72;
        const siteX = (candidateX + jitterX) * cellSpan;
        const siteY = (candidateY + jitterY) * cellSpan;
        const distance = ((worldX - siteX) ** 2 + (worldY - siteY) ** 2) /
          (cellSpan * cellSpan);
        for (let rank = 0; rank < 4; rank++) {
          if (distance >= this.cellularDistances[rank]!) continue;
          for (let shift = 3; shift > rank; shift--) {
            this.cellularDistances[shift] = this.cellularDistances[shift - 1]!;
            this.cellularHashes[shift] = this.cellularHashes[shift - 1]!;
          }
          this.cellularDistances[rank] = distance;
          this.cellularHashes[rank] = hash;
          break;
        }
      }
    }
    const lodBias = outputSize <= 4 ? 2 : outputSize <= 8 ? 1 : 0;
    let total = 0;
    for (let rank = 0; rank < 4; rank++) {
      const hash = this.cellularHashes[rank]!;
      const texture = textures[hash % textures.length]!;
      const selected = selectTextureLevelIndex(texture, outputSize, textureScaleTiles);
      sampleMappedTexture(
        texture,
        Math.min(texture.levels.length - 1, selected + lodBias),
        worldX,
        worldY,
        textureScaleTiles,
        hash,
        this.hexSamples,
        rank * 3,
      );
      const weight = 1 / Math.pow(0.16 + this.cellularDistances[rank]!, 2.4);
      this.cellularWeights[rank] = weight;
      total += weight;
    }
    out.fill(0);
    for (let rank = 0; rank < 4; rank++) {
      const weight = this.cellularWeights[rank]! / Math.max(1e-12, total);
      out[0] = out[0]! + this.hexSamples[rank * 3]! * weight;
      out[1] = out[1]! + this.hexSamples[rank * 3 + 1]! * weight;
      out[2] = out[2]! + this.hexSamples[rank * 3 + 2]! * weight;
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
): {
  sample: RegionalRouteSample;
  opacity: number;
  normalizedDistance: number;
  normalizedSignedDistance: number;
} | null {
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
  const normalizedDistance = bilerp(
    normalizedRouteDistance(samples[0]),
    normalizedRouteDistance(samples[1]),
    normalizedRouteDistance(samples[2]),
    normalizedRouteDistance(samples[3]),
    u,
    v,
  );
  const normalizedSignedDistance = bilerp(
    normalizedRouteSignedDistance(samples[0]),
    normalizedRouteSignedDistance(samples[1]),
    normalizedRouteSignedDistance(samples[2]),
    normalizedRouteSignedDistance(samples[3]),
    u,
    v,
  );
  return {
    sample: samples[selectedIndex]!,
    opacity: smoothstep(0.02, 0.42, coverage),
    normalizedDistance,
    normalizedSignedDistance,
  };
}

function normalizedRouteDistance(sample: RegionalRouteSample): number {
  if (sample.halfWidth <= 0 || !Number.isFinite(sample.distance)) return 2;
  return sample.distance / sample.halfWidth;
}

function normalizedRouteSignedDistance(sample: RegionalRouteSample): number {
  if (sample.halfWidth <= 0 || !Number.isFinite(sample.signedDistance)) return 2;
  return sample.signedDistance / sample.halfWidth;
}

function bridgeBankContact(waterCoverage: number): number {
  return smoothstep(0.08, 0.32, waterCoverage) *
    (1 - smoothstep(0.68, 0.92, waterCoverage));
}

function bridgeShapeCoverage(
  routeCoverage: number,
  normalizedDistance: number,
  bankContact = 0,
  widthScale = 1,
  longitudinalProgress = 0,
  landingFlareScale = 1,
  midspanWaistScale = 1,
): number {
  const landingFlare = smoothstep(0.72, 0.98, longitudinalProgress) *
    (1 - smoothstep(1.04, 1.48, longitudinalProgress));
  const midspanWaist = 1 - smoothstep(0.16, 0.7, longitudinalProgress);
  const sectionCore = lerp(0.76, 0.98, bankContact) * widthScale +
    landingFlare * 0.13 * landingFlareScale - midspanWaist * 0.055 * midspanWaistScale;
  const sectionEdge = lerp(0.94, 1.2, bankContact) * widthScale +
    landingFlare * 0.2 * landingFlareScale - midspanWaist * 0.085 * midspanWaistScale;
  const crossSection = 1 - smoothstep(sectionCore, sectionEdge, normalizedDistance);
  return smoothstep(0.18, 0.7, routeCoverage) * crossSection;
}

function routeShapeCoverage(
  routeCoverage: number,
  normalizedDistance: number,
  widthScale: number,
): number {
  const core = widthScale * 0.76;
  const edge = widthScale;
  return smoothstep(0.04, 0.46, routeCoverage) *
    (1 - smoothstep(core, edge, normalizedDistance));
}

function bridgeAbutmentCoverage(
  routeCoverage: number,
  normalizedDistance: number,
  bankContact: number,
  longitudinalProgress: number,
): number {
  const transverseSeat = 1 - smoothstep(1.04, 1.4, normalizedDistance);
  const bankStation = 1 - smoothstep(
    0.12,
    0.44,
    Math.abs(Math.abs(longitudinalProgress) - 1),
  );
  return smoothstep(0.16, 0.62, routeCoverage) * transverseSeat * bankContact * bankStation;
}

function prepareTexture(tile: Tile): PreparedTexture {
  const height = tile.packedPixels?.height ?? tile.pixels.length;
  const width = tile.packedPixels?.width ?? tile.pixels[0]?.length ?? 0;
  if (width === 0 || height === 0) throw new Error(`Empty regional material texture: ${tile.id}`);
  if (tile.packedPixels && tile.packedPixels.data.length !== width * height * 4) {
    throw new Error(`Packed regional material texture dimensions do not match RGBA data: ${tile.id}`);
  }
  const linear = new Float32Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const packedOffset = (y * width + x) * 4;
      const pixel = tile.packedPixels
        ? {
          r: tile.packedPixels.data[packedOffset]!,
          g: tile.packedPixels.data[packedOffset + 1]!,
          b: tile.packedPixels.data[packedOffset + 2]!,
        }
        : tile.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
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
  return texture.levels[selectTextureLevelIndex(texture, outputSize, textureScaleTiles)]!;
}

function selectTextureLevelIndex(
  texture: PreparedTexture,
  outputSize: number,
  textureScaleTiles: number,
): number {
  const texelsPerOutputPixel = Math.max(texture.width, texture.height) /
    Math.max(1, outputSize * textureScaleTiles);
  return Math.max(0, Math.min(
    texture.levels.length - 1,
    Math.round(Math.log2(Math.max(1, texelsPerOutputPixel))),
  ));
}

function boundedWindowFits(
  level: PreparedTextureLevel,
  variantPeriodTiles: number,
  textureScaleTiles: number,
): boolean {
  if (level.width !== level.height) return false;
  const supportX = variantPeriodTiles * level.width / textureScaleTiles;
  const supportY = variantPeriodTiles * level.height / textureScaleTiles;
  return supportX <= (level.width - 1) / 2 && supportY <= (level.height - 1) / 2;
}

function triangleGrid(
  worldX: number,
  worldY: number,
  cellSpan: number,
  weights: Float64Array,
  vertices: Int32Array,
): void {
  const skewedX = worldX / cellSpan - worldY / (Math.sqrt(3) * cellSpan);
  const skewedY = worldY * 2 / (Math.sqrt(3) * cellSpan);
  const baseX = Math.floor(skewedX);
  const baseY = Math.floor(skewedY);
  const fractionX = skewedX - baseX;
  const fractionY = skewedY - baseY;
  const third = 1 - fractionX - fractionY;
  const upper = third <= 0 ? 1 : 0;
  const sign = upper * 2 - 1;
  weights[0] = -third * sign;
  weights[1] = upper - fractionY * sign;
  weights[2] = upper - fractionX * sign;
  vertices[0] = baseX + upper;
  vertices[1] = baseY + upper;
  vertices[2] = baseX + upper;
  vertices[3] = baseY + 1 - upper;
  vertices[4] = baseX + 1 - upper;
  vertices[5] = baseY + upper;
}

function sampleMappedTexture(
  texture: PreparedTexture,
  levelIndex: number,
  worldX: number,
  worldY: number,
  textureScaleTiles: number,
  hash: number,
  output: Float64Array,
  outputOffset: number,
): void {
  const level = texture.levels[levelIndex]!;
  let mappedX = worldX * texture.width / textureScaleTiles;
  let mappedY = worldY * texture.height / textureScaleTiles;
  switch ((hash >>> 27) & 7) {
    case 1: [mappedX, mappedY] = [-mappedY, mappedX]; break;
    case 2: [mappedX, mappedY] = [-mappedX, -mappedY]; break;
    case 3: [mappedX, mappedY] = [mappedY, -mappedX]; break;
    case 4: mappedX = -mappedX; break;
    case 5: mappedY = -mappedY; break;
    case 6: [mappedX, mappedY] = [mappedY, mappedX]; break;
    case 7: [mappedX, mappedY] = [-mappedY, -mappedX]; break;
  }
  const scaleX = level.width / texture.width;
  const scaleY = level.height / texture.height;
  const phaseX = ((hash >>> 7) % texture.width) * scaleX;
  const phaseY = ((hash >>> 16) % texture.height) * scaleY;
  const sourceX = mirrorCoordinate(mappedX * scaleX + phaseX, level.width);
  const sourceY = mirrorCoordinate(mappedY * scaleY + phaseY, level.height);
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = Math.min(level.width - 1, x0 + 1);
  const y1 = Math.min(level.height - 1, y0 + 1);
  const u = sourceX - x0;
  const v = sourceY - y0;
  for (let channel = 0; channel < 3; channel++) {
    const top = lerp(
      level.linear[(y0 * level.width + x0) * 3 + channel]!,
      level.linear[(y0 * level.width + x1) * 3 + channel]!,
      u,
    );
    const bottom = lerp(
      level.linear[(y1 * level.width + x0) * 3 + channel]!,
      level.linear[(y1 * level.width + x1) * 3 + channel]!,
      u,
    );
    output[outputOffset + channel] = lerp(top, bottom, v);
  }
}

function blendHexSamples(
  samples: Float64Array,
  sampleOffset: number,
  barycentric: Float64Array,
  exponent: number,
  luminanceInfluence: number,
  output: Float64Array,
): void {
  let total = 0;
  const weights = [0, 0, 0];
  for (let vertex = 0; vertex < 3; vertex++) {
    const offset = sampleOffset + vertex * 3;
    const luminance = samples[offset]! * 0.2126 +
      samples[offset + 1]! * 0.7152 + samples[offset + 2]! * 0.0722;
    const contrast = 1 - luminanceInfluence + luminance * luminanceInfluence;
    const weight = Math.pow(Math.max(0, barycentric[vertex]!), exponent) * contrast;
    weights[vertex] = weight;
    total += weight;
  }
  output.fill(0);
  const normalizer = 1 / Math.max(1e-12, total);
  for (let vertex = 0; vertex < 3; vertex++) {
    const weight = weights[vertex]! * normalizer;
    const offset = sampleOffset + vertex * 3;
    output[0] = output[0]! + samples[offset]! * weight;
    output[1] = output[1]! + samples[offset + 1]! * weight;
    output[2] = output[2]! + samples[offset + 2]! * weight;
  }
}

function bilerp(a: number, b: number, c: number, d: number, u: number, v: number): number {
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

function mirrorCoordinate(value: number, size: number): number {
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

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const u = smoothstep01(x - x0);
  const v = smoothstep01(y - y0);
  const top = lerp(hashSigned(x0, y0, seed), hashSigned(x0 + 1, y0, seed), u);
  const bottom = lerp(hashSigned(x0, y0 + 1, seed), hashSigned(x0 + 1, y0 + 1, seed), u);
  return lerp(top, bottom, v);
}

function hashSigned(x: number, y: number, seed: number): number {
  let value = Math.imul(x ^ seed, 0x9e3779b1) ^ Math.imul(y ^ (seed >>> 1), 0x85ebca77);
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (((value ^ (value >>> 16)) >>> 0) / 2147483648) - 1;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
