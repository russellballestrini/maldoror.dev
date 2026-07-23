import fs from 'node:fs';
import path from 'node:path';
import type { PixelGrid, Tile } from '@maldoror/protocol';
import {
  BIOME_FAMILIES,
  type BiomeFamily,
  type RegionalCrossingKind,
  type RegionalRouteKind,
} from '@maldoror/world';
import sharp from 'sharp';

export interface RegionalBiomeMaterialKit {
  manifestPath: string;
  sourceTileSize: number;
  tiles: Tile[];
  materials: Record<BiomeFamily, Tile[]>;
}

export interface RegionalRouteMaterialKit {
  manifestPath: string;
  sourceTileSize: number;
  tiles: Tile[];
  routeMaterials: Record<RegionalRouteKind, Tile[]>;
  crossingMaterials: Partial<Record<RegionalCrossingKind, Tile[]>>;
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
}

interface RouteMaterialEntry extends BaseMaterialEntry {
  routeKind?: RegionalRouteKind;
  crossingKind?: RegionalCrossingKind;
}

const ROUTE_KINDS: readonly RegionalRouteKind[] = ['trail', 'local-road', 'arterial'];
const CROSSING_KINDS: readonly RegionalCrossingKind[] = ['ford', 'bridge', 'ferry'];

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
  const tiles: Tile[] = [];
  for (const entry of entries) {
    const imagePath = resolveAssetPath(manifestDirectory, entry.file);
    const variants = await loadTerrainMasterVariants(imagePath, sourceTileSize, entry);
    materials[entry.family].push(...variants);
    tiles.push(...variants);
  }
  return { manifestPath: absoluteManifest, sourceTileSize, tiles, materials };
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
  const tiles: Tile[] = [];
  for (const entry of [...routeEntries, ...crossingEntries]) {
    const imagePath = resolveAssetPath(manifestDirectory, entry.file);
    const variants = await loadTerrainMasterVariants(imagePath, sourceTileSize, entry);
    if (entry.routeKind) routeMaterials[entry.routeKind].push(...variants);
    if (entry.crossingKind) crossingMaterials[entry.crossingKind] = variants;
    tiles.push(...variants);
  }
  return { manifestPath: absoluteManifest, sourceTileSize, tiles, routeMaterials, crossingMaterials };
}

function parseEntry(value: unknown, index: number): MaterialEntry {
  if (!isRecord(value) ||
      !BIOME_FAMILIES.includes(value.family as BiomeFamily) ||
      typeof value.id !== 'string' || value.id.length === 0 ||
      typeof value.file !== 'string' || value.file.length === 0 ||
      !Number.isInteger(value.variants) || Number(value.variants) < 1 || Number(value.variants) > 16 ||
      typeof value.walkable !== 'boolean') {
    throw new Error(`Invalid regional material entry at index ${index}`);
  }
  const material = value.material;
  if (material !== undefined && !['water', 'foliage', 'specular', 'fire'].includes(String(material))) {
    throw new Error(`Invalid regional material mask at index ${index}`);
  }
  return {
    family: value.family as BiomeFamily,
    id: value.id,
    file: value.file,
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
      typeof value.walkable !== 'boolean') {
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
    const pixels: PixelGrid = Array.from({ length: info.height }, (_, y) =>
      Array.from({ length: info.width }, (_, x) => {
        const offset = (y * info.width + x) * info.channels;
        return { r: data[offset]!, g: data[offset + 1]!, b: data[offset + 2]! };
      }));
    const id = index === 0 ? entry.id : `${entry.id}__v${index + 1}`;
    variants.push({
      id,
      name: id,
      walkable: entry.walkable,
      material: entry.material,
      pixels,
      resolutions: { [String(tileSize)]: pixels },
    });
  }
  return variants;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
