import fs from 'node:fs';
import path from 'node:path';
import type { BuildingSprite, BuildingTile, PackedPixelGrid, Tile } from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type RegionalAmbientAsset,
  type RegionalEnvironmentConstraints,
  type RegionalEnvironmentContactAsset,
  type RegionalEnvironmentProgramKind,
  type RegionalLandmarkAsset,
  type RegionalParcelComponentAsset,
  type RegionalParcelProgram,
  type RegionalWaterfrontFunction,
  type RegionalRouteContactAsset,
  type RegionalRouteContactAxis,
  type RegionalLandmarkKind,
  type RegionalCrossingKind,
  type RegionalRouteKind,
  type RegionalRouteSurfaceStyle,
} from '@maldoror/world';
import sharp from 'sharp';

export interface RegionalBiomeMaterialKit {
  manifestPath: string;
  sourceTileSize: number;
  tiles: Tile[];
  materials: Record<BiomeFamily, Tile[]>;
  overviewMaterials: Record<BiomeFamily, Tile[]>;
  landmarkFabricMaterials: Partial<Record<BiomeFamily, Tile[]>>;
}

export interface RegionalRouteMaterialKit {
  manifestPath: string;
  sourceTileSize: number;
  tiles: Tile[];
  routeMaterials: Record<RegionalRouteKind, Tile[]>;
  crossingMaterials: Partial<Record<RegionalCrossingKind, Tile[]>>;
  routeSurfaceStyles: Record<RegionalRouteKind, RegionalRouteSurfaceStyle>;
  crossingSurfaceStyles: Partial<Record<RegionalCrossingKind, RegionalRouteSurfaceStyle>>;
}

export interface RegionalLandmarkKit {
  manifestPath: string;
  sourceTileSize: number;
  blockSize: number;
  assets: RegionalLandmarkAsset[];
}

export interface RegionalAmbientKit {
  manifestPath: string;
  sourceTileSize: number;
  blockSize: number;
  cellSize: number;
  density: number;
  landmarkClearance: number;
  assets: RegionalAmbientAsset[];
}

export interface RegionalRouteContactKit {
  manifestPath: string;
  sourceTileSize: number;
  blockSize: number;
  cellSize: number;
  density: number;
  landmarkClearance: number;
  assets: RegionalRouteContactAsset[];
}

export interface RegionalParcelComponentKit {
  manifestPath: string;
  sourceTileSize: number;
  minimumLayers: number;
  maximumLayers: number;
  layerSpacing: number;
  assets: RegionalParcelComponentAsset[];
}

export interface RegionalEnvironmentContactKit {
  manifestPath: string;
  sourceTileSize: number;
  cellSize: number;
  density: number;
  landmarkClearance: number;
  assets: RegionalEnvironmentContactAsset[];
}

interface BaseMaterialEntry {
  id: string;
  file: string;
  variants: number;
  walkable: boolean;
  material?: Tile['material'];
}

interface MaterialEntry extends BaseMaterialEntry {
  family: BiomeFamily;
  overviewFile: string;
  overviewVariants: number;
  landmarkFabricFile?: string;
  landmarkFabricVariants?: number;
}

interface RouteMaterialEntry extends BaseMaterialEntry {
  routeKind?: RegionalRouteKind;
  crossingKind?: RegionalCrossingKind;
  textureScaleTiles: number;
  detailWidthScale: number;
  overviewWidthScale: number;
  detailOpacity: number;
  overviewOpacity: number;
}

interface LandmarkEntry {
  id: string;
  file: string;
  family: BiomeFamily;
  landmarkKinds: RegionalLandmarkKind[];
  scale: number;
  spriteTiles: [number, number];
  collision: Array<[number, number]>;
  emitsLight?: boolean;
}

interface AmbientEntry {
  id: string;
  file: string;
  family: BiomeFamily;
  routeDistance: [number, number];
  scale: number;
  spriteTiles: [number, number];
  collision: Array<[number, number]>;
  emitsLight?: boolean;
}

interface RouteContactEntry extends AmbientEntry {
  accessAxis: RegionalRouteContactAxis;
  anchorTile: [number, number];
}

interface ParcelComponentEntry {
  id: string;
  file: string;
  family: BiomeFamily;
  role: 'mass';
  compositionRole?: 'focal';
  frontageAxis?: RegionalRouteContactAxis;
  compositionSide?: -1 | 1;
  frontageStations?: number[];
  scale: number;
  spriteTiles: [number, number];
  collision: Array<[number, number]>;
  programs?: RegionalParcelProgram[];
  waterfrontFunction?: RegionalWaterfrontFunction;
  quayBankSide?: -1 | 1;
  emitsLight?: boolean;
}

interface EnvironmentContactEntry {
  id: string;
  file: string;
  families: BiomeFamily[];
  role: 'environment-contact';
  scale: number;
  spriteTiles: [number, number];
  collision: Array<[number, number]>;
  constraints: RegionalEnvironmentConstraints;
  program?: RegionalEnvironmentProgramKind;
  emitsLight?: boolean;
}

const ROUTE_KINDS: readonly RegionalRouteKind[] = ['trail', 'local-road', 'arterial'];
const CROSSING_KINDS: readonly RegionalCrossingKind[] = ['ford', 'bridge', 'ferry'];
const LANDMARK_KINDS: readonly RegionalLandmarkKind[] = ['arrival', 'settlement', 'ruin', 'waystation'];
const ROUTE_CONTACT_AXES: readonly RegionalRouteContactAxis[] = ['north-south', 'east-west'];
const PARCEL_PROGRAMS: readonly RegionalParcelProgram[] = ['waterfront'];
const WATERFRONT_FUNCTIONS: readonly RegionalWaterfrontFunction[] = [
  'boat-shed',
  'fish-processing',
  'market',
  'shelter',
  'workshop',
];
const ENVIRONMENT_PROGRAMS: readonly RegionalEnvironmentProgramKind[] = [
  'cave-interior',
  'highland-ascent',
];

/** Load the authored six-family manifest without inferring semantics from file
 * names or pixels. Source masters are cropped into repeatable variants once at
 * worker boot; every session shares the resulting immutable tile objects. */
export async function loadRegionalBiomeMaterialKit(manifestPath: string): Promise<RegionalBiomeMaterialKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || !Number.isInteger(raw.sourceTileSize) || !Array.isArray(raw.materialMasters)) {
    throw new Error(`Invalid regional biome manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  if (sourceTileSize < 16 || sourceTileSize > 256) {
    throw new Error(`Regional biome sourceTileSize is outside 16..256: ${sourceTileSize}`);
  }
  const samplingTextureSize = parseSamplingTextureSize(raw, sourceTileSize, absoluteManifest);
  const overviewSamplingTextureSize = parseNamedTextureSize(
    raw,
    'overviewSamplingTextureSize',
    sourceTileSize,
    samplingTextureSize,
    absoluteManifest,
  );
  const entries = raw.materialMasters.map((value, index) => parseEntry(value, index));
  const families = new Set(entries.map((entry) => entry.family));
  for (const family of BIOME_FAMILIES) {
    if (!families.has(family)) throw new Error(`Regional biome manifest is missing family: ${family}`);
  }
  if (entries.length !== families.size) throw new Error('Regional biome manifest contains duplicate families');

  const materials: Record<BiomeFamily, Tile[]> = {
    'canal-town': [],
    forest: [],
    coast: [],
    rural: [],
    mountain: [],
    ruins: [],
  };
  const overviewMaterials: Record<BiomeFamily, Tile[]> = {
    'canal-town': [],
    forest: [],
    coast: [],
    rural: [],
    mountain: [],
    ruins: [],
  };
  const landmarkFabricMaterials: Partial<Record<BiomeFamily, Tile[]>> = {};
  const tiles: Tile[] = [];
  for (const entry of entries) {
    const imagePath = resolveAssetPath(manifestDirectory, entry.file);
    const variants = await loadTerrainMasterVariants(imagePath, samplingTextureSize, entry);
    const overviewPath = resolveAssetPath(manifestDirectory, entry.overviewFile);
    const overviewVariants = await loadTerrainMasterVariants(overviewPath, overviewSamplingTextureSize, {
      ...entry,
      id: `${entry.id}-overview`,
      file: entry.overviewFile,
      variants: entry.overviewVariants,
    });
    materials[entry.family].push(...variants);
    overviewMaterials[entry.family].push(...overviewVariants);
    tiles.push(...variants, ...overviewVariants);
    if (entry.landmarkFabricFile && entry.landmarkFabricVariants) {
      const landmarkFabricPath = resolveAssetPath(manifestDirectory, entry.landmarkFabricFile);
      const landmarkFabricVariants = await loadTerrainMasterVariants(
        landmarkFabricPath,
        samplingTextureSize,
        {
          ...entry,
          id: `${entry.id}-landmark-fabric`,
          file: entry.landmarkFabricFile,
          variants: entry.landmarkFabricVariants,
        },
      );
      landmarkFabricMaterials[entry.family] = landmarkFabricVariants;
      tiles.push(...landmarkFabricVariants);
    }
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    tiles,
    materials,
    overviewMaterials,
    landmarkFabricMaterials,
  };
}

/** Load authored route surfaces from explicit route/crossing semantics. */
export async function loadRegionalRouteMaterialKit(manifestPath: string): Promise<RegionalRouteMaterialKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || !Number.isInteger(raw.sourceTileSize) ||
      !Array.isArray(raw.routeMaterialMasters) || !Array.isArray(raw.crossingMaterialMasters)) {
    throw new Error(`Invalid regional route manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  if (sourceTileSize < 16 || sourceTileSize > 256) {
    throw new Error(`Regional route sourceTileSize is outside 16..256: ${sourceTileSize}`);
  }
  const samplingTextureSize = parseSamplingTextureSize(raw, sourceTileSize, absoluteManifest);
  const routeEntries = raw.routeMaterialMasters.map((value, index) =>
    parseRouteEntry(value, index, 'route'));
  const crossingEntries = raw.crossingMaterialMasters.map((value, index) =>
    parseRouteEntry(value, index, 'crossing'));
  const routeKinds = new Set(routeEntries.map((entry) => entry.routeKind));
  for (const kind of ROUTE_KINDS) {
    if (!routeKinds.has(kind)) throw new Error(`Regional route manifest is missing route kind: ${kind}`);
  }
  if (routeEntries.length !== routeKinds.size) throw new Error('Regional route manifest contains duplicate route kinds');

  const routeMaterials: Record<RegionalRouteKind, Tile[]> = {
    trail: [],
    'local-road': [],
    arterial: [],
  };
  const crossingMaterials: Partial<Record<RegionalCrossingKind, Tile[]>> = {};
  const routeSurfaceStyles = {} as Record<RegionalRouteKind, RegionalRouteSurfaceStyle>;
  const crossingSurfaceStyles: Partial<Record<RegionalCrossingKind, RegionalRouteSurfaceStyle>> = {};
  const tiles: Tile[] = [];
  for (const entry of [...routeEntries, ...crossingEntries]) {
    const imagePath = resolveAssetPath(manifestDirectory, entry.file);
    const variants = await loadTerrainMasterVariants(imagePath, samplingTextureSize, entry);
    const style = {
      textureScaleTiles: entry.textureScaleTiles,
      detailWidthScale: entry.detailWidthScale,
      overviewWidthScale: entry.overviewWidthScale,
      detailOpacity: entry.detailOpacity,
      overviewOpacity: entry.overviewOpacity,
    };
    if (entry.routeKind) {
      routeMaterials[entry.routeKind].push(...variants);
      routeSurfaceStyles[entry.routeKind] = style;
    }
    if (entry.crossingKind) {
      crossingMaterials[entry.crossingKind] = variants;
      crossingSurfaceStyles[entry.crossingKind] = style;
    }
    tiles.push(...variants);
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    tiles,
    routeMaterials,
    crossingMaterials,
    routeSurfaceStyles,
    crossingSurfaceStyles,
  };
}

/** Load the bounded landmark research kit from explicit family, route-site,
 * collision, and sprite-layout semantics. Alpha is consumed from derived PNGs;
 * filenames and colour values never decide world placement. */
export async function loadRegionalLandmarkKit(manifestPath: string): Promise<RegionalLandmarkKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.sourceTileSize) ||
      !Number.isInteger(raw.blockSize) || !Array.isArray(raw.assets)) {
    throw new Error(`Invalid regional landmark manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  const blockSize = Number(raw.blockSize);
  if (sourceTileSize < 16 || sourceTileSize > 192 || blockSize < 16 || blockSize > 128) {
    throw new Error(`Regional landmark dimensions are invalid: tile=${sourceTileSize} block=${blockSize}`);
  }
  const entries = raw.assets.map((value, index) => parseLandmarkEntry(value, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error('Regional landmark manifest contains duplicate IDs');
  const families = new Set(entries.map((entry) => entry.family));
  for (const family of BIOME_FAMILIES) {
    if (!families.has(family)) throw new Error(`Regional landmark manifest is missing family: ${family}`);
  }
  const assets: RegionalLandmarkAsset[] = [];
  for (const entry of entries) {
    assets.push({
      id: entry.id,
      families: [entry.family],
      landmarkKinds: entry.landmarkKinds,
      collision: entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadRegionalSprite(
        resolveAssetPath(manifestDirectory, entry.file),
        sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }
  return { manifestPath: absoluteManifest, sourceTileSize, blockSize, assets };
}

/** Load the medium-scale ambient mass kit. The manifest owns density, route
 * bands, family compatibility, and collision; the generated pixels do not. */
export async function loadRegionalAmbientKit(manifestPath: string): Promise<RegionalAmbientKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.sourceTileSize) ||
      !Number.isInteger(raw.blockSize) || !Number.isInteger(raw.cellSize) ||
      typeof raw.density !== 'number' || typeof raw.landmarkClearance !== 'number' ||
      !Array.isArray(raw.assets)) {
    throw new Error(`Invalid regional ambient manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  const blockSize = Number(raw.blockSize);
  const cellSize = Number(raw.cellSize);
  const density = Number(raw.density);
  const landmarkClearance = Number(raw.landmarkClearance);
  if (sourceTileSize < 16 || sourceTileSize > 192 || blockSize < 16 || blockSize > 128 ||
      cellSize < 3 || cellSize > 32 || density < 0 || density > 1 ||
      landmarkClearance < 4 || landmarkClearance > 64) {
    throw new Error(`Regional ambient dimensions are invalid: ${absoluteManifest}`);
  }
  const entries = raw.assets.map((value, index) => parseAmbientEntry(value, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error('Regional ambient manifest contains duplicate IDs');
  const families = new Set(entries.map((entry) => entry.family));
  for (const family of BIOME_FAMILIES) {
    if (!families.has(family)) throw new Error(`Regional ambient manifest is missing family: ${family}`);
  }
  const assets: RegionalAmbientAsset[] = [];
  for (const entry of entries) {
    assets.push({
      id: entry.id,
      families: [entry.family],
      routeDistance: entry.routeDistance,
      collision: entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadRegionalSprite(
        resolveAssetPath(manifestDirectory, entry.file),
        sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    blockSize,
    cellSize,
    density,
    landmarkClearance,
    assets,
  };
}

/** Load paired, genuinely authored route-contact axes. Orientation is manifest
 * semantics rather than pixel inspection; a central sprite anchor lets the
 * threshold straddle its access corridor without abusing bottom-centre
 * building placement. */
export async function loadRegionalRouteContactKit(manifestPath: string): Promise<RegionalRouteContactKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.sourceTileSize) ||
      !Number.isInteger(raw.blockSize) || !Number.isInteger(raw.cellSize) ||
      typeof raw.density !== 'number' || typeof raw.landmarkClearance !== 'number' ||
      !Array.isArray(raw.assets)) {
    throw new Error(`Invalid regional route-contact manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  const blockSize = Number(raw.blockSize);
  const cellSize = Number(raw.cellSize);
  const density = Number(raw.density);
  const landmarkClearance = Number(raw.landmarkClearance);
  if (sourceTileSize < 16 || sourceTileSize > 192 || blockSize < 16 || blockSize > 128 ||
      cellSize < 6 || cellSize > 64 || density < 0 || density > 1 ||
      landmarkClearance < 4 || landmarkClearance > 64) {
    throw new Error(`Regional route-contact dimensions are invalid: ${absoluteManifest}`);
  }
  const entries = raw.assets.map((value, index) => parseRouteContactEntry(value, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error('Regional route-contact manifest contains duplicate IDs');
  for (const family of BIOME_FAMILIES) {
    for (const accessAxis of ROUTE_CONTACT_AXES) {
      if (!entries.some((entry) => entry.family === family && entry.accessAxis === accessAxis)) {
        throw new Error(`Regional route-contact manifest is missing ${family}/${accessAxis}`);
      }
    }
  }
  const assets: RegionalRouteContactAsset[] = [];
  for (const entry of entries) {
    assets.push({
      id: entry.id,
      families: [entry.family],
      accessAxis: entry.accessAxis,
      routeDistance: entry.routeDistance,
      spriteAnchor: entry.anchorTile,
      collision: entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadRegionalSprite(
        resolveAssetPath(manifestDirectory, entry.file),
        sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    blockSize,
    cellSize,
    density,
    landmarkClearance,
    assets,
  };
}

/** Load family-compatible silhouette modules for the parcel grammar. Files may
 * deliberately share provenance with ambient masses, but their parcel role is
 * explicit here; pixels never infer placement, access, or collision. */
export async function loadRegionalParcelComponentKit(
  manifestPath: string,
): Promise<RegionalParcelComponentKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.sourceTileSize) ||
      !Number.isInteger(raw.minimumLayers) || !Number.isInteger(raw.maximumLayers) ||
      !Number.isInteger(raw.layerSpacing) || !Array.isArray(raw.assets)) {
    throw new Error(`Invalid regional parcel component manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  const minimumLayers = Number(raw.minimumLayers);
  const maximumLayers = Number(raw.maximumLayers);
  const layerSpacing = Number(raw.layerSpacing);
  if (sourceTileSize < 16 || sourceTileSize > 192 || minimumLayers < 1 ||
      maximumLayers < minimumLayers || maximumLayers > 5 || layerSpacing < 4 || layerSpacing > 8) {
    throw new Error(`Regional parcel component dimensions are invalid: ${absoluteManifest}`);
  }
  const entries = raw.assets.map((value, index) => parseParcelComponentEntry(value, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) throw new Error('Regional parcel component manifest contains duplicate IDs');
  for (const family of BIOME_FAMILIES) {
    if (!entries.some((entry) => entry.family === family)) {
      throw new Error(`Regional parcel component manifest is missing family: ${family}`);
    }
  }
  const assets: RegionalParcelComponentAsset[] = [];
  for (const entry of entries) {
    assets.push({
      id: entry.id,
      families: [entry.family],
      role: entry.role,
      compositionRole: entry.compositionRole,
      frontageAxis: entry.frontageAxis,
      compositionSide: entry.compositionSide,
      frontageStations: entry.frontageStations,
      programs: entry.programs,
      waterfrontFunction: entry.waterfrontFunction,
      quayBankSide: entry.quayBankSide,
      collision: entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadRegionalSprite(
        resolveAssetPath(manifestDirectory, entry.file),
        sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    minimumLayers,
    maximumLayers,
    layerSpacing,
    assets,
  };
}

/** Load large coast/highland/cave silhouettes with declarative geography.
 * The loader validates every physical range before any worker can place art. */
export async function loadRegionalEnvironmentContactKit(
  manifestPath: string,
): Promise<RegionalEnvironmentContactKit> {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDirectory = path.dirname(absoluteManifest);
  const raw = JSON.parse(await fs.promises.readFile(absoluteManifest, 'utf8')) as unknown;
  if (!isRecord(raw) || raw.version !== 1 || !Number.isInteger(raw.sourceTileSize) ||
      !Number.isInteger(raw.cellSize) || typeof raw.density !== 'number' ||
      !Number.isInteger(raw.landmarkClearance) || !Array.isArray(raw.assets)) {
    throw new Error(`Invalid regional environment-contact manifest: ${absoluteManifest}`);
  }
  const sourceTileSize = Number(raw.sourceTileSize);
  const cellSize = Number(raw.cellSize);
  const density = Number(raw.density);
  const landmarkClearance = Number(raw.landmarkClearance);
  if (sourceTileSize < 16 || sourceTileSize > 192 || cellSize < 10 || cellSize > 128 ||
      density < 0 || density > 1 || landmarkClearance < 4 || landmarkClearance > 64) {
    throw new Error(`Regional environment-contact dimensions are invalid: ${absoluteManifest}`);
  }
  const entries = raw.assets.map((value, index) => parseEnvironmentContactEntry(value, index));
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length || entries.length === 0) {
    throw new Error('Regional environment-contact manifest must contain unique assets');
  }
  const assets: RegionalEnvironmentContactAsset[] = [];
  for (const entry of entries) {
    assets.push({
      id: entry.id,
      families: entry.families,
      role: entry.role,
      constraints: entry.constraints,
      program: entry.program,
      collision: entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadRegionalSprite(
        resolveAssetPath(manifestDirectory, entry.file),
        sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }
  return {
    manifestPath: absoluteManifest,
    sourceTileSize,
    cellSize,
    density,
    landmarkClearance,
    assets,
  };
}

function parseEntry(value: unknown, index: number): MaterialEntry {
  if (!isRecord(value) ||
      !BIOME_FAMILIES.includes(value.family as BiomeFamily) ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      typeof value.overviewFile !== 'string' || value.overviewFile.length === 0 ||
      !Number.isInteger(value.overviewVariants) || Number(value.overviewVariants) < 1 ||
      Number(value.overviewVariants) > 4 ||
      !Number.isInteger(value.variants) || Number(value.variants) < 1 || Number(value.variants) > 16 ||
      typeof value.walkable !== 'boolean') {
    throw new Error(`Invalid regional material entry at index ${index}`);
  }
  const hasLandmarkFabric = value.landmarkFabricFile !== undefined ||
    value.landmarkFabricVariants !== undefined;
  if (hasLandmarkFabric && (
    typeof value.landmarkFabricFile !== 'string' || value.landmarkFabricFile.length === 0 ||
    !Number.isInteger(value.landmarkFabricVariants) ||
    Number(value.landmarkFabricVariants) < 1 || Number(value.landmarkFabricVariants) > 16
  )) {
    throw new Error(`Invalid regional landmark-fabric material at index ${index}`);
  }
  const material = value.material;
  if (material !== undefined && !['water', 'foliage', 'specular', 'fire'].includes(String(material))) {
    throw new Error(`Invalid regional material mask at index ${index}`);
  }
  return {
    family: value.family as BiomeFamily,
    id: value.id,
    file: value.file,
    overviewFile: value.overviewFile,
    overviewVariants: Number(value.overviewVariants),
    landmarkFabricFile: value.landmarkFabricFile as string | undefined,
    landmarkFabricVariants: value.landmarkFabricVariants === undefined
      ? undefined
      : Number(value.landmarkFabricVariants),
    variants: Number(value.variants),
    walkable: value.walkable,
    material: material as Tile['material'],
  };
}

function parseRouteEntry(value: unknown, index: number, role: 'route' | 'crossing'): RouteMaterialEntry {
  const semantic = role === 'route' ? valueRouteKind(value) : valueCrossingKind(value);
  if (!isRecord(value) || !semantic ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !Number.isInteger(value.variants) || Number(value.variants) < 1 || Number(value.variants) > 16 ||
      typeof value.walkable !== 'boolean' ||
      typeof value.textureScaleTiles !== 'number' || value.textureScaleTiles < 1 || value.textureScaleTiles > 24 ||
      typeof value.detailWidthScale !== 'number' || value.detailWidthScale < 0.25 || value.detailWidthScale > 1.25 ||
      typeof value.overviewWidthScale !== 'number' || value.overviewWidthScale < 0.25 || value.overviewWidthScale > 1.25 ||
      typeof value.detailOpacity !== 'number' || value.detailOpacity < 0.2 || value.detailOpacity > 1 ||
      typeof value.overviewOpacity !== 'number' || value.overviewOpacity < 0.2 || value.overviewOpacity > 1) {
    throw new Error(`Invalid regional ${role} material entry at index ${index}`);
  }
  const material = value.material;
  if (material !== undefined && !['water', 'foliage', 'specular', 'fire'].includes(String(material))) {
    throw new Error(`Invalid regional ${role} material mask at index ${index}`);
  }
  return {
    routeKind: role === 'route' ? semantic as RegionalRouteKind : undefined,
    crossingKind: role === 'crossing' ? semantic as RegionalCrossingKind : undefined,
    id: value.id,
    file: value.file,
    variants: Number(value.variants),
    walkable: value.walkable,
    material: material as Tile['material'],
    textureScaleTiles: value.textureScaleTiles,
    detailWidthScale: value.detailWidthScale,
    overviewWidthScale: value.overviewWidthScale,
    detailOpacity: value.detailOpacity,
    overviewOpacity: value.overviewOpacity,
  };
}

function parseLandmarkEntry(value: unknown, index: number): LandmarkEntry {
  if (!isRecord(value) ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !BIOME_FAMILIES.includes(value.family as BiomeFamily) ||
      !Array.isArray(value.landmarkKinds) || value.landmarkKinds.length === 0 ||
      !value.landmarkKinds.every((kind) => LANDMARK_KINDS.includes(kind as RegionalLandmarkKind)) ||
      !isTileDimensions(value.spriteTiles) ||
      !Array.isArray(value.collision) || value.collision.length === 0 ||
      !value.collision.every(isCollisionOffset) ||
      (value.emitsLight !== undefined && typeof value.emitsLight !== 'boolean') ||
      typeof value.scale !== 'number' || value.scale < 0.2 || value.scale > 1) {
    throw new Error(`Invalid regional landmark entry at index ${index}`);
  }
  return {
    id: value.id,
    file: value.file,
    family: value.family as BiomeFamily,
    landmarkKinds: value.landmarkKinds as RegionalLandmarkKind[],
    scale: value.scale,
    spriteTiles: value.spriteTiles as [number, number],
    collision: value.collision as Array<[number, number]>,
    emitsLight: value.emitsLight as boolean | undefined,
  };
}

function parseAmbientEntry(value: unknown, index: number): AmbientEntry {
  if (!isRecord(value) ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !BIOME_FAMILIES.includes(value.family as BiomeFamily) ||
      !isRouteDistance(value.routeDistance) ||
      !isTileDimensions(value.spriteTiles) ||
      !Array.isArray(value.collision) || value.collision.length === 0 ||
      !value.collision.every(isCollisionOffset) ||
      (value.emitsLight !== undefined && typeof value.emitsLight !== 'boolean') ||
      typeof value.scale !== 'number' || value.scale < 0.2 || value.scale > 1) {
    throw new Error(`Invalid regional ambient entry at index ${index}`);
  }
  return {
    id: value.id,
    file: value.file,
    family: value.family as BiomeFamily,
    routeDistance: value.routeDistance,
    scale: value.scale,
    spriteTiles: value.spriteTiles as [number, number],
    collision: value.collision as Array<[number, number]>,
    emitsLight: value.emitsLight as boolean | undefined,
  };
}

function parseRouteContactEntry(value: unknown, index: number): RouteContactEntry {
  const ambient = parseAmbientEntry(value, index);
  if (!isRecord(value) || !ROUTE_CONTACT_AXES.includes(value.accessAxis as RegionalRouteContactAxis) ||
      !isTileDimensions(value.anchorTile)) {
    throw new Error(`Invalid regional route-contact entry at index ${index}`);
  }
  const anchorTile = value.anchorTile as [number, number];
  if (anchorTile[0] >= ambient.spriteTiles[0] || anchorTile[1] >= ambient.spriteTiles[1]) {
    throw new Error(`Regional route-contact anchor is outside its sprite at index ${index}`);
  }
  return {
    ...ambient,
    accessAxis: value.accessAxis as RegionalRouteContactAxis,
    anchorTile,
  };
}

function parseParcelComponentEntry(value: unknown, index: number): ParcelComponentEntry {
  if (!isRecord(value) || value.role !== 'mass' ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !BIOME_FAMILIES.includes(value.family as BiomeFamily) ||
      (value.compositionRole !== undefined && value.compositionRole !== 'focal') ||
      (value.frontageAxis !== undefined &&
        !ROUTE_CONTACT_AXES.includes(value.frontageAxis as RegionalRouteContactAxis)) ||
      (value.compositionSide !== undefined && value.compositionSide !== -1 &&
        value.compositionSide !== 1) ||
      (value.frontageStations !== undefined && (!Array.isArray(value.frontageStations) ||
        value.frontageStations.length === 0 || value.frontageStations.length > 4 ||
        !value.frontageStations.every((station) => (
          typeof station === 'number' && Number.isFinite(station) && station >= -0.85 && station <= 0.85
        )))) ||
      (value.compositionRole === 'focal' && (
        value.frontageAxis === undefined || value.compositionSide === undefined ||
        value.frontageStations === undefined
      )) ||
      (value.compositionRole !== 'focal' && (
        value.compositionSide !== undefined || value.frontageStations !== undefined ||
        (value.frontageAxis !== undefined && value.quayBankSide === undefined)
      )) ||
      !isTileDimensions(value.spriteTiles) ||
      !Array.isArray(value.collision) || value.collision.length === 0 ||
      !value.collision.every(isCollisionOffset) ||
      (value.programs !== undefined && (!Array.isArray(value.programs) ||
        value.programs.length === 0 ||
        !value.programs.every((program) => PARCEL_PROGRAMS.includes(program as RegionalParcelProgram)))) ||
      (value.waterfrontFunction !== undefined &&
        !WATERFRONT_FUNCTIONS.includes(value.waterfrontFunction as RegionalWaterfrontFunction)) ||
      (value.waterfrontFunction !== undefined &&
        (!Array.isArray(value.programs) || !value.programs.includes('waterfront'))) ||
      (value.quayBankSide !== undefined && value.quayBankSide !== -1 &&
        value.quayBankSide !== 1) ||
      (value.quayBankSide !== undefined && (
        value.compositionRole !== undefined ||
        value.frontageAxis === undefined || value.waterfrontFunction === undefined ||
        !Array.isArray(value.programs) || !value.programs.includes('waterfront')
      )) ||
      (value.emitsLight !== undefined && typeof value.emitsLight !== 'boolean') ||
      typeof value.scale !== 'number' || value.scale < 0.2 || value.scale > 1) {
    throw new Error(`Invalid regional parcel component entry at index ${index}`);
  }
  return {
    id: value.id,
    file: value.file,
    family: value.family as BiomeFamily,
    role: 'mass',
    compositionRole: value.compositionRole as 'focal' | undefined,
    frontageAxis: value.frontageAxis as RegionalRouteContactAxis | undefined,
    compositionSide: value.compositionSide as -1 | 1 | undefined,
    frontageStations: value.frontageStations as number[] | undefined,
    scale: value.scale,
    spriteTiles: value.spriteTiles as [number, number],
    collision: value.collision as Array<[number, number]>,
    programs: value.programs as RegionalParcelProgram[] | undefined,
    waterfrontFunction: value.waterfrontFunction as RegionalWaterfrontFunction | undefined,
    quayBankSide: value.quayBankSide as -1 | 1 | undefined,
    emitsLight: value.emitsLight as boolean | undefined,
  };
}

function parseEnvironmentContactEntry(value: unknown, index: number): EnvironmentContactEntry {
  if (!isRecord(value) || value.role !== 'environment-contact' ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !Array.isArray(value.families) || value.families.length === 0 ||
      !value.families.every((family) => BIOME_FAMILIES.includes(family as BiomeFamily)) ||
      !isTileDimensions(value.spriteTiles) ||
      !Array.isArray(value.collision) || value.collision.length === 0 ||
      !value.collision.every(isCollisionOffset) ||
      (value.emitsLight !== undefined && typeof value.emitsLight !== 'boolean') ||
      typeof value.scale !== 'number' || value.scale < 0.2 || value.scale > 1 ||
      (value.program !== undefined &&
        !ENVIRONMENT_PROGRAMS.includes(value.program as RegionalEnvironmentProgramKind)) ||
      !isRecord(value.constraints)) {
    throw new Error(`Invalid regional environment-contact entry at index ${index}`);
  }
  const constraints = value.constraints;
  if (typeof constraints.landOnly !== 'boolean' ||
      !isNumericRange(constraints.waterDistance, 999) ||
      !isNumericRange(constraints.elevation, 1) ||
      !isNumericRange(constraints.slope, 1) ||
      !isNumericRange(constraints.routeDistance, 999) ||
      !Number.isInteger(constraints.nearbyWaterRadius) ||
      Number(constraints.nearbyWaterRadius) < 0 || Number(constraints.nearbyWaterRadius) > 12) {
    throw new Error(`Invalid regional environment-contact constraints at index ${index}`);
  }
  return {
    id: value.id,
    file: value.file,
    families: value.families as BiomeFamily[],
    role: 'environment-contact',
    scale: value.scale,
    spriteTiles: value.spriteTiles as [number, number],
    collision: value.collision as Array<[number, number]>,
    constraints: {
      landOnly: constraints.landOnly,
      waterDistance: constraints.waterDistance as [number, number],
      elevation: constraints.elevation as [number, number],
      slope: constraints.slope as [number, number],
      routeDistance: constraints.routeDistance as [number, number],
      nearbyWaterRadius: Number(constraints.nearbyWaterRadius),
    },
    program: value.program as RegionalEnvironmentProgramKind | undefined,
    emitsLight: value.emitsLight as boolean | undefined,
  };
}

function valueRouteKind(value: unknown): RegionalRouteKind | null {
  if (!isRecord(value) || !ROUTE_KINDS.includes(value.routeKind as RegionalRouteKind)) return null;
  return value.routeKind as RegionalRouteKind;
}

function valueCrossingKind(value: unknown): RegionalCrossingKind | null {
  if (!isRecord(value) || !CROSSING_KINDS.includes(value.crossingKind as RegionalCrossingKind)) return null;
  return value.crossingKind as RegionalCrossingKind;
}

function resolveAssetPath(manifestDirectory: string, relativePath: string): string {
  const resolved = path.resolve(manifestDirectory, relativePath);
  if (!resolved.startsWith(`${manifestDirectory}${path.sep}`)) {
    throw new Error(`Regional biome asset escapes manifest directory: ${relativePath}`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`Regional biome asset is missing: ${resolved}`);
  return resolved;
}

async function loadTerrainMasterVariants(
  imagePath: string,
  tileSize: number,
  entry: BaseMaterialEntry,
): Promise<Tile[]> {
  const metadata = await sharp(imagePath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth === 0 || sourceHeight === 0) throw new Error(`Unreadable regional material: ${imagePath}`);
  const columns = Math.ceil(Math.sqrt(entry.variants));
  const rows = Math.ceil(entry.variants / columns);
  const cropWidth = Math.floor(sourceWidth / columns);
  const cropHeight = Math.floor(sourceHeight / rows);
  const variants: Tile[] = [];
  for (let index = 0; index < entry.variants; index++) {
    const left = (index % columns) * cropWidth;
    const top = Math.floor(index / columns) * cropHeight;
    const { data, info } = await sharp(imagePath)
      .extract({ left, top, width: cropWidth, height: cropHeight })
      .resize(tileSize, tileSize, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const packedPixels = packOpaqueRaster(data, info.width, info.height, info.channels);
    const id = index === 0 ? entry.id : `${entry.id}__v${index + 1}`;
    variants.push({
      id,
      name: id,
      walkable: entry.walkable,
      material: entry.material,
      pixels: [],
      packedPixels,
      resolutions: {},
    });
  }
  return variants;
}

function parseSamplingTextureSize(
  manifest: Record<string, unknown>,
  sourceTileSize: number,
  manifestPath: string,
): number {
  const value = manifest.samplingTextureSize ?? sourceTileSize;
  if (!Number.isInteger(value) || Number(value) < sourceTileSize || Number(value) > 512) {
    throw new Error(`Regional samplingTextureSize is outside ${sourceTileSize}..512: ${manifestPath}`);
  }
  return Number(value);
}

function parseNamedTextureSize(
  manifest: Record<string, unknown>,
  key: string,
  minimum: number,
  fallback: number,
  manifestPath: string,
): number {
  const value = manifest[key] ?? fallback;
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > 512) {
    throw new Error(`Regional ${key} is outside ${minimum}..512: ${manifestPath}`);
  }
  return Number(value);
}

const REGIONAL_SPRITE_CACHE = new Map<string, Promise<BuildingSprite>>();

function loadRegionalSprite(
  imagePath: string,
  tileSize: number,
  scale: number,
  spriteTiles: [number, number],
): Promise<BuildingSprite> {
  const key = `${path.resolve(imagePath)}@${tileSize}:${scale}:${spriteTiles[0]}x${spriteTiles[1]}`;
  const cached = REGIONAL_SPRITE_CACHE.get(key);
  if (cached) return cached;
  const loading = loadRegionalSpriteUncached(imagePath, tileSize, scale, spriteTiles);
  REGIONAL_SPRITE_CACHE.set(key, loading);
  void loading.catch(() => REGIONAL_SPRITE_CACHE.delete(key));
  return loading;
}

async function loadRegionalSpriteUncached(
  imagePath: string,
  tileSize: number,
  scale: number,
  spriteTiles: [number, number],
): Promise<BuildingSprite> {
  const [tilesWide, tilesHigh] = spriteTiles;
  const canvasWidth = tileSize * tilesWide;
  const canvasHeight = tileSize * tilesHigh;
  const { data, info } = await sharp(imagePath)
    .resize({
      width: Math.max(tileSize, Math.round(canvasWidth * scale)),
      height: Math.max(tileSize, Math.round(canvasHeight * scale)),
      fit: 'inside',
      kernel: sharp.kernel.lanczos3,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const offsetX = Math.floor((canvasWidth - info.width) / 2);
  const offsetY = canvasHeight - info.height;
  const tiles: BuildingTile[][] = [];
  for (let tileY = 0; tileY < tilesHigh; tileY++) {
    const row: BuildingTile[] = [];
    for (let tileX = 0; tileX < tilesWide; tileX++) {
      const packedPixels: PackedPixelGrid = {
        width: tileSize,
        height: tileSize,
        data: new Uint8Array(tileSize * tileSize * 4),
      };
      for (let y = 0; y < tileSize; y++) {
        for (let x = 0; x < tileSize; x++) {
          const sourceX = tileX * tileSize + x - offsetX;
          const sourceY = tileY * tileSize + y - offsetY;
          if (sourceX < 0 || sourceY < 0 || sourceX >= info.width || sourceY >= info.height) continue;
          const sourceIndex = (sourceY * info.width + sourceX) * info.channels;
          const alpha = data[sourceIndex + 3] ?? 0;
          if (alpha < 4) continue;
          const targetIndex = (y * tileSize + x) * 4;
          packedPixels.data[targetIndex] = data[sourceIndex]!;
          packedPixels.data[targetIndex + 1] = data[sourceIndex + 1]!;
          packedPixels.data[targetIndex + 2] = data[sourceIndex + 2]!;
          packedPixels.data[targetIndex + 3] = alpha;
        }
      }
      row.push({ pixels: [], resolutions: {}, packedPixels });
    }
    tiles.push(row);
  }
  return { width: tilesWide, height: tilesHigh, tiles };
}

function packOpaqueRaster(
  source: Uint8Array,
  width: number,
  height: number,
  channels: number,
): PackedPixelGrid {
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index++) {
    const sourceOffset = index * channels;
    const targetOffset = index * 4;
    data[targetOffset] = source[sourceOffset]!;
    data[targetOffset + 1] = source[sourceOffset + 1]!;
    data[targetOffset + 2] = source[sourceOffset + 2]!;
    data[targetOffset + 3] = 255;
  }
  return { width, height, data };
}

function isCollisionOffset(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => Number.isInteger(part) && Number(part) >= -8 && Number(part) <= 8);
}

function isTileDimensions(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => Number.isInteger(part) && Number(part) >= 1 && Number(part) <= 16);
}

function isRouteDistance(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part) && part >= 0 && part <= 999) &&
    value[1]! >= value[0]!;
}

function isNumericRange(value: unknown, maximum: number): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => typeof part === 'number' && Number.isFinite(part) && part >= 0 && part <= maximum) &&
    value[1]! >= value[0]!;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
