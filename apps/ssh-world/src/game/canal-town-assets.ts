import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import type { BuildingSprite, BuildingTile, Pixel, PixelGrid, Sprite, Tile } from '@maldoror/protocol';
import type {
  CanalPlacementRole,
  CanalTownAsset,
  CanalTownTerrainConfig,
  CornerCodedTileSet as CornerCodedTileSetType,
} from '@maldoror/world';
import { CanalMaterialCompositor, CornerCodedTileSet } from '@maldoror/world';

interface ManifestAsset {
  id: string;
  file: string;
  roles: CanalPlacementRole[];
  scale: number;
  collision: Array<[number, number]>;
  spriteTiles: [number, number];
  collisionRect?: [number, number];
  emitsLight?: boolean;
}

interface CanalTownManifest {
  version: number;
  sourceTileSize: number;
  blockSize: number;
  defaultAvatar: string;
  terrainMasters: ManifestTerrainMaster[];
  cornerAtlases: ManifestCornerAtlas[];
  terrain: CanalTownTerrainConfig;
  assets: ManifestAsset[];
}

type CornerTerrainMaterial = 'paving' | 'water' | 'garden';

interface ManifestCornerAtlas {
  material: CornerTerrainMaterial;
  file: string;
  tileSize: number;
  cornerColours: number;
  combinations: number;
  variants: number;
}

interface ManifestTerrainMaster {
  id: string;
  file: string;
  variants: number;
  walkable: boolean;
  material?: Tile['material'];
}

export interface LoadedCanalTownKit {
  assets: CanalTownAsset[];
  terrainTiles: Tile[];
  terrain: CanalTownTerrainConfig;
  blockSize: number;
  defaultAvatar: Sprite;
  manifestPath: string;
  materialCompositor: CanalMaterialCompositor;
  cornerTerrain: Partial<Record<CornerTerrainMaterial, CornerCodedTileSetType>>;
}

const VALID_ROLES = new Set<CanalPlacementRole>([
  'building', 'bridge', 'bridge-vertical', 'edge', 'foliage', 'street-small', 'street-large', 'water',
  'water-detail', 'quay-detail',
]);

/** Load and rasterize the chosen kit once per worker. Each asset becomes one
 * shared multi-tile sprite at a single bounded source resolution; render-time scaling
 * supplies zoom levels without an object-heavy in-memory pyramid. */
export async function loadCanalTownKit(
  manifestOverride?: string,
  worldSeed: bigint = 0n,
): Promise<LoadedCanalTownKit> {
  const manifestPath = findManifestPath(manifestOverride);
  const manifest = parseManifest(manifestPath);
  const manifestDir = path.dirname(manifestPath);
  const assets: CanalTownAsset[] = [];
  const terrainTiles: Tile[] = [];
  const defaultAvatar = await loadDefaultAvatar(
    resolveAssetPath(manifestDir, manifest.defaultAvatar),
    manifest.sourceTileSize,
  );

  for (const entry of manifest.terrainMasters) {
    const imagePath = resolveAssetPath(manifestDir, entry.file);
    terrainTiles.push(...await loadTerrainMasterVariants(imagePath, manifest.sourceTileSize, entry));
  }

  const cornerTerrain: Partial<Record<CornerTerrainMaterial, CornerCodedTileSetType>> = {};
  for (const entry of manifest.cornerAtlases) {
    const imagePath = resolveAssetPath(manifestDir, entry.file);
    const tilesByCombination = await loadCornerAtlas(imagePath, entry);
    for (const tiles of tilesByCombination) terrainTiles.push(...tiles);
    cornerTerrain[entry.material] = new CornerCodedTileSet({
      worldSeed,
      cornerColours: entry.cornerColours,
      tilesByCombination,
      salt: stringHash(`canal-corner-atlas:${entry.material}`),
    });
  }

  const terrainById = new Map(terrainTiles.map((tile) => [tile.id, tile]));
  const resolveTerrain = (ids: readonly string[]): Tile[] =>
    ids.map((id) => terrainById.get(id)).filter((tile): tile is Tile => Boolean(tile));
  const materialCompositor = new CanalMaterialCompositor({
    worldSeed,
    water: resolveTerrain(manifest.terrain.water),
    paving: resolveTerrain(manifest.terrain.paving),
    garden: resolveTerrain(manifest.terrain.garden),
    edge: resolveTerrain([...new Set(Object.values(manifest.terrain.curb).filter(Boolean))] as string[]),
    maxCachedTiles: 96,
    variantPeriodTiles: 4,
  });

  for (const entry of manifest.assets) {
    const imagePath = resolveAssetPath(manifestDir, entry.file);
    assets.push({
      id: entry.id,
      roles: entry.roles,
      collision: entry.collisionRect
        ? rectangularCollision(entry.collisionRect[0], entry.collisionRect[1])
        : entry.collision,
      emitsLight: entry.emitsLight,
      sprite: await loadManifestSprite(
        imagePath,
        manifest.sourceTileSize,
        entry.scale,
        entry.spriteTiles,
      ),
    });
  }

  return {
    assets,
    terrainTiles,
    terrain: manifest.terrain,
    blockSize: manifest.blockSize,
    defaultAvatar,
    manifestPath,
    materialCompositor,
    cornerTerrain,
  };
}

/** Load only the authored fallback avatar from the canal manifest. The
 * regional runtime reuses this identity asset without constructing the retired
 * canal terrain, placement, and material stack. */
export async function loadCanalTownDefaultAvatar(manifestOverride?: string): Promise<Sprite> {
  const manifestPath = findManifestPath(manifestOverride);
  const manifest = parseManifest(manifestPath);
  return loadDefaultAvatar(
    resolveAssetPath(path.dirname(manifestPath), manifest.defaultAvatar),
    manifest.sourceTileSize,
  );
}

function findManifestPath(override?: string): string {
  const candidates = [
    override,
    process.env.MALDOROR_CANAL_MANIFEST,
    path.resolve(process.cwd(), 'assets/canal-town/manifest.json'),
    path.resolve(process.cwd(), '../../assets/canal-town/manifest.json'),
    fileURLToPath(new URL('../../../../assets/canal-town/manifest.json', import.meta.url)),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  throw new Error(`Canal-town manifest not found; checked: ${candidates.join(', ')}`);
}

function parseManifest(manifestPath: string): CanalTownManifest {
  const raw: unknown = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!isRecord(raw) || raw.version !== 1) throw new Error('Unsupported canal-town manifest version');
  if (!Number.isInteger(raw.sourceTileSize) || Number(raw.sourceTileSize) < 32 || Number(raw.sourceTileSize) > 192) {
    throw new Error('Canal-town sourceTileSize must be an integer from 32 to 192');
  }
  if (!Number.isInteger(raw.blockSize) || Number(raw.blockSize) < 14) {
    throw new Error('Canal-town blockSize must be an integer >= 14');
  }
  if (typeof raw.defaultAvatar !== 'string') {
    throw new Error('Canal-town defaultAvatar must be an asset path');
  }
  if (!isRecord(raw.terrain) || !Array.isArray(raw.terrainMasters) || raw.terrainMasters.length === 0 ||
      !Array.isArray(raw.assets) || raw.assets.length === 0) {
    throw new Error('Canal-town manifest requires terrain masters and assets');
  }

  const terrainMasters: ManifestTerrainMaster[] = raw.terrainMasters.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string' ||
        typeof value.walkable !== 'boolean') {
      throw new Error(`Invalid canal terrain master at index ${index}`);
    }
    const material = value.material;
    if (material !== undefined && !['water', 'foliage', 'specular', 'fire'].includes(String(material))) {
      throw new Error(`Invalid material for canal terrain ${value.id}`);
    }
    const variants = Number(value.variants ?? 1);
    if (!Number.isInteger(variants) || variants < 1 || variants > 9) {
      throw new Error(`Invalid variant count for canal terrain ${value.id}`);
    }
    return {
      id: value.id,
      file: value.file,
      variants,
      walkable: value.walkable,
      material: material as Tile['material'],
    };
  });

  const rawCornerAtlases: unknown = raw.cornerAtlases ?? [];
  if (!Array.isArray(rawCornerAtlases)) throw new Error('Canal-town cornerAtlases must be an array');
  const cornerAtlases: ManifestCornerAtlas[] = rawCornerAtlases.map(
    (value: unknown, index: number) => {
      if (!isRecord(value) ||
          !['paving', 'water', 'garden'].includes(String(value.material)) ||
          typeof value.file !== 'string') {
        throw new Error(`Invalid canal corner atlas at index ${index}`);
      }
      const tileSize = Number(value.tileSize);
      const cornerColours = Number(value.cornerColours);
      const combinations = Number(value.combinations);
      const variants = Number(value.variants);
      if (!Number.isInteger(tileSize) || tileSize !== Number(raw.sourceTileSize) ||
          !Number.isInteger(cornerColours) || cornerColours < 2 || cornerColours > 8 ||
          !Number.isInteger(combinations) || combinations !== cornerColours ** 4 ||
          !Number.isInteger(variants) || variants < 1 || variants > 16) {
        throw new Error(`Invalid dimensions for canal corner atlas ${value.file}`);
      }
      return {
        material: value.material as CornerTerrainMaterial,
        file: value.file,
        tileSize,
        cornerColours,
        combinations,
        variants,
      };
    },
  );

  const assets: ManifestAsset[] = raw.assets.map((value, index) => {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.file !== 'string') {
      throw new Error(`Invalid canal asset at index ${index}`);
    }
    if (!Array.isArray(value.roles) || value.roles.length === 0 ||
        !value.roles.every((role) => typeof role === 'string' && VALID_ROLES.has(role as CanalPlacementRole))) {
      throw new Error(`Invalid roles for canal asset ${value.id}`);
    }
    const scale = Number(value.scale);
    if (!Number.isFinite(scale) || scale <= 0.2 || scale > 1) {
      throw new Error(`Invalid scale for canal asset ${value.id}`);
    }
    if (!Array.isArray(value.collision) || !value.collision.every(isCollisionOffset)) {
      throw new Error(`Invalid collision mask for canal asset ${value.id}`);
    }
    const spriteTiles = value.spriteTiles === undefined ? [3, 3] : value.spriteTiles;
    if (!isTileDimensions(spriteTiles)) {
      throw new Error(`Invalid spriteTiles for canal asset ${value.id}`);
    }
    const collisionRect = value.collisionRect;
    if (collisionRect !== undefined && !isTileDimensions(collisionRect)) {
      throw new Error(`Invalid collisionRect for canal asset ${value.id}`);
    }
    if (value.emitsLight !== undefined && typeof value.emitsLight !== 'boolean') {
      throw new Error(`Invalid emitsLight for canal asset ${value.id}`);
    }
    return {
      id: value.id,
      file: value.file,
      roles: value.roles as CanalPlacementRole[],
      scale,
      collision: value.collision as Array<[number, number]>,
      spriteTiles: spriteTiles as [number, number],
      collisionRect: collisionRect as [number, number] | undefined,
      emitsLight: value.emitsLight,
    };
  });

  const terrain = raw.terrain as unknown as CanalTownTerrainConfig;
  for (const key of ['water', 'paving', 'garden'] as const) {
    if (!Array.isArray(terrain[key]) || !terrain[key].every((id) => typeof id === 'string')) {
      throw new Error(`Canal-town terrain.${key} must be a string array`);
    }
  }
  if (!isRecord(terrain.curb)) throw new Error('Canal-town terrain.curb must be an object');

  return {
    version: 1,
    sourceTileSize: Number(raw.sourceTileSize),
    blockSize: Number(raw.blockSize),
    defaultAvatar: raw.defaultAvatar,
    terrainMasters,
    cornerAtlases,
    terrain,
    assets,
  };
}

function resolveAssetPath(manifestDir: string, relativePath: string): string {
  const resolved = path.resolve(manifestDir, relativePath);
  if (!resolved.startsWith(`${manifestDir}${path.sep}`)) {
    throw new Error(`Canal asset escapes manifest directory: ${relativePath}`);
  }
  if (!fs.existsSync(resolved)) throw new Error(`Canal asset is missing: ${resolved}`);
  return resolved;
}

async function loadCornerAtlas(
  imagePath: string,
  entry: ManifestCornerAtlas,
): Promise<Tile[][]> {
  const { data, info } = await sharp(imagePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const expectedWidth = entry.combinations * entry.tileSize;
  const expectedHeight = entry.variants * entry.tileSize;
  if (info.width !== expectedWidth || info.height !== expectedHeight) {
    throw new Error(
      `Corner atlas ${imagePath} is ${info.width}x${info.height}; expected ${expectedWidth}x${expectedHeight}`,
    );
  }
  return Array.from({ length: entry.combinations }, (_, combination) =>
    Array.from({ length: entry.variants }, (_, variant) => {
      const pixels: PixelGrid = Array.from({ length: entry.tileSize }, (_, y) =>
        Array.from({ length: entry.tileSize }, (_, x) => {
          const sourceX = combination * entry.tileSize + x;
          const sourceY = variant * entry.tileSize + y;
          const index = (sourceY * info.width + sourceX) * info.channels;
          return { r: data[index]!, g: data[index + 1]!, b: data[index + 2]! };
        }));
      const id = `canal-${entry.material}-corner-c${combination}-v${variant}`;
      const material = entry.material === 'water'
        ? 'water'
        : entry.material === 'garden' ? 'foliage' : undefined;
      return {
        id,
        name: id,
        walkable: entry.material !== 'water',
        material,
        pixels,
        resolutions: { [String(entry.tileSize)]: pixels },
      } satisfies Tile;
    }));
}

function stringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

async function loadTerrainMasterVariants(
  imagePath: string,
  tileSize: number,
  entry: ManifestTerrainMaster,
): Promise<Tile[]> {
  const metadata = await sharp(imagePath).metadata();
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth === 0 || sourceHeight === 0) throw new Error(`Unreadable terrain master: ${imagePath}`);
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
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = rawToPixelGrid(data, info.width, info.height);
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

async function loadManifestSprite(
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
      const pixels: PixelGrid = [];
      for (let y = 0; y < tileSize; y++) {
        const pixelRow: Pixel[] = [];
        for (let x = 0; x < tileSize; x++) {
          const sourceX = tileX * tileSize + x - offsetX;
          const sourceY = tileY * tileSize + y - offsetY;
          if (sourceX < 0 || sourceY < 0 || sourceX >= info.width || sourceY >= info.height) {
            pixelRow.push(null);
            continue;
          }
          const index = (sourceY * info.width + sourceX) * 4;
          pixelRow.push(rawPixelAt(data, index));
        }
        pixels.push(pixelRow);
      }
      row.push({ pixels, resolutions: { [String(tileSize)]: pixels } });
    }
    tiles.push(row);
  }

  return { width: tilesWide, height: tilesHigh, tiles };
}

async function loadDefaultAvatar(imagePath: string, size: number): Promise<Sprite> {
  const { data, info } = await sharp(imagePath)
    .resize({
      width: size,
      height: size,
      fit: 'contain',
      kernel: sharp.kernel.lanczos3,
      // Sharp's default `contain` padding is opaque black. Make the canvas
      // explicitly transparent so a portrait sprite never becomes a cut-out
      // rectangle when fitted into the square runtime frame.
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const frame = rawToPixelGrid(data, info.width, info.height);
  const frames: [PixelGrid, PixelGrid, PixelGrid, PixelGrid] = [frame, frame, frame, frame];
  return {
    width: size,
    height: size,
    frames: { up: frames, down: frames, left: frames, right: frames },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCollisionOffset(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => Number.isInteger(part) && Number(part) >= -2 && Number(part) <= 2);
}

function isTileDimensions(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 &&
    value.every((part) => Number.isInteger(part) && Number(part) >= 1 && Number(part) <= 8);
}

function rectangularCollision(width: number, height: number): Array<[number, number]> {
  const offsets: Array<[number, number]> = [];
  const left = -Math.floor(width / 2);
  for (let y = -height + 1; y <= 0; y++) {
    for (let x = 0; x < width; x++) offsets.push([left + x, y]);
  }
  return offsets;
}

function rawToPixelGrid(data: Buffer, width: number, height: number): PixelGrid {
  const pixels: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      row.push(rawPixelAt(data, index));
    }
    pixels.push(row);
  }
  return pixels;
}

/** Convert Sharp's straight RGBA output without discarding authored edge
 * coverage. Very low coverage remains transparent; partial coverage is kept
 * for the renderer's linear-light alpha compositor. */
function rawPixelAt(data: Buffer, index: number): Pixel {
  const alpha = data[index + 3] ?? 0;
  if (alpha < 32) return null;
  const pixel: Exclude<Pixel, null> = {
    r: data[index]!,
    g: data[index + 1]!,
    b: data[index + 2]!,
  };
  if (alpha < 255) pixel.a = alpha;
  return pixel;
}
