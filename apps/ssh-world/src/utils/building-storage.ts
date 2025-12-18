import * as fs from 'fs';
import type { BuildingSprite, PixelGrid } from '@maldoror/protocol';
import { RESOLUTIONS } from '@maldoror/protocol';
import { db, schema } from '@maldoror/db';
import { eq, and } from 'drizzle-orm';
import { BUILDING_DIRECTIONS, type BuildingDirection, type DirectionalBuildingSprite } from '@maldoror/ai';
import {
  ensureBuildingDir,
  getBuildingPngPath,
  savePixelGridAsPng,
  loadPngAsPixelGrid,
  deleteBuildingPngs,
} from './png-storage.js';

export { BUILDING_DIRECTIONS, type BuildingDirection, type DirectionalBuildingSprite };

/**
 * Save a directional building sprite to disk (all 4 orientations)
 * Also inserts rows into the building_tiles table
 */
export async function saveBuildingToDisk(
  buildingId: string,
  sprite: BuildingSprite | DirectionalBuildingSprite
): Promise<void> {
  ensureBuildingDir(buildingId);

  let totalFiles = 0;
  let totalSize = 0;

  // Check if this is a directional sprite (has north/east/south/west) or single sprite
  const isDirectional = 'north' in sprite;
  const directions: BuildingDirection[] = isDirectional
    ? BUILDING_DIRECTIONS
    : ['north']; // Legacy single-direction support

  for (const direction of directions) {
    const dirSprite = isDirectional
      ? (sprite as DirectionalBuildingSprite)[direction]
      : (sprite as BuildingSprite);

    // For each tile position in the 3x3 grid
    for (let tileY = 0; tileY < 3; tileY++) {
      for (let tileX = 0; tileX < 3; tileX++) {
        const tile = dirSprite.tiles[tileY]?.[tileX];
        if (!tile) continue;

        // Save each resolution as a separate PNG
        for (const resolution of RESOLUTIONS) {
          const pixels = tile.resolutions[String(resolution)];
          if (!pixels) continue;

          const filePath = getBuildingPngPath(buildingId, tileX, tileY, resolution, direction);
          const relativePath = `${buildingId}/tile_${direction}_${tileX}_${tileY}_${resolution}.png`;

          await savePixelGridAsPng(pixels, filePath);

          // Insert database row
          await db.insert(schema.buildingTiles).values({
            buildingId,
            tileX,
            tileY,
            resolution,
            direction,
            filePath: relativePath,
          }).onConflictDoUpdate({
            target: [schema.buildingTiles.buildingId, schema.buildingTiles.tileX, schema.buildingTiles.tileY, schema.buildingTiles.resolution, schema.buildingTiles.direction],
            set: { filePath: relativePath },
          });

          totalFiles++;
          try {
            const stat = await fs.promises.stat(filePath);
            totalSize += stat.size;
          } catch {
            // Ignore stat errors
          }
        }
      }
    }
  }

  const dirCount = directions.length;
  console.log(`[Building] Saved building ${buildingId}: ${totalFiles} PNGs (${dirCount} directions, ${(totalSize / 1024).toFixed(1)}KB total)`);
}

/**
 * Load a single building tile at a specific resolution and direction
 * Returns null if not found
 */
export async function loadBuildingTile(
  buildingId: string,
  tileX: number,
  tileY: number,
  resolution: number,
  direction: BuildingDirection = 'north'
): Promise<PixelGrid | null> {
  const filePath = getBuildingPngPath(buildingId, tileX, tileY, resolution, direction);

  try {
    return await loadPngAsPixelGrid(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    console.error(`[Building] Failed to load tile ${direction}/${tileX},${tileY}@${resolution} for ${buildingId}:`, error);
    return null;
  }
}

/**
 * Load a full building sprite from disk for a specific direction
 * OPTIMIZED: Only loads base resolution (256) to avoid memory explosion
 * The renderer's scaling cache handles other resolutions on-demand
 * @param direction - Building direction for camera rotation support (defaults to 'north')
 */
export async function loadBuildingFromDisk(
  buildingId: string,
  direction: BuildingDirection = 'north'
): Promise<BuildingSprite | null> {
  // Only check for base resolution tiles (256) for the specified direction
  const tileRecords = await db.select()
    .from(schema.buildingTiles)
    .where(and(
      eq(schema.buildingTiles.buildingId, buildingId),
      eq(schema.buildingTiles.resolution, 256),
      eq(schema.buildingTiles.direction, direction)
    ));

  // If no tiles found for this direction, try 'north' as fallback (legacy buildings)
  if (tileRecords.length === 0 && direction !== 'north') {
    return loadBuildingFromDisk(buildingId, 'north');
  }

  if (tileRecords.length === 0) {
    return null;
  }

  // Initialize the sprite structure
  const sprite: BuildingSprite = {
    width: 3,
    height: 3,
    tiles: [],
  };

  // Initialize 3x3 tile grid
  for (let y = 0; y < 3; y++) {
    const row = [];
    for (let x = 0; x < 3; x++) {
      row.push({
        pixels: [] as PixelGrid,
        resolutions: {} as Record<string, PixelGrid>,
      });
    }
    sprite.tiles.push(row);
  }

  // Load only base resolution (9 files instead of 90)
  for (const record of tileRecords) {
    const pixels = await loadBuildingTile(buildingId, record.tileX, record.tileY, 256, direction);
    if (pixels) {
      const tile = sprite.tiles[record.tileY]?.[record.tileX];
      if (tile) {
        tile.pixels = pixels;
      }
    }
  }

  return sprite;
}

/**
 * Load all directional sprites for a building from disk
 * Returns DirectionalBuildingSprite if all directions available, null otherwise
 */
export async function loadAllBuildingDirections(
  buildingId: string
): Promise<DirectionalBuildingSprite | null> {
  // Try to load all 4 directions
  const [north, east, south, west] = await Promise.all([
    loadBuildingFromDisk(buildingId, 'north'),
    loadBuildingFromDisk(buildingId, 'east'),
    loadBuildingFromDisk(buildingId, 'south'),
    loadBuildingFromDisk(buildingId, 'west'),
  ]);

  // If north exists, return directional sprite (fallback used for other directions)
  if (north) {
    return {
      north,
      east: east ?? north,  // Fallback to north if direction not available
      south: south ?? north,
      west: west ?? north,
    };
  }

  return null;
}

/**
 * Load only specific resolutions for a building (for preview or rendering)
 * More efficient than loading the full sprite
 * @param direction - Building direction for camera rotation support (defaults to 'north')
 */
export async function loadBuildingAtResolution(
  buildingId: string,
  resolution: number,
  direction: BuildingDirection = 'north'
): Promise<Map<string, PixelGrid> | null> {
  const tileRecords = await db.select()
    .from(schema.buildingTiles)
    .where(and(
      eq(schema.buildingTiles.buildingId, buildingId),
      eq(schema.buildingTiles.resolution, resolution),
      eq(schema.buildingTiles.direction, direction)
    ));

  if (tileRecords.length === 0) {
    return null;
  }

  const tiles = new Map<string, PixelGrid>();

  for (const record of tileRecords) {
    const pixels = await loadBuildingTile(buildingId, record.tileX, record.tileY, resolution, direction);
    if (pixels) {
      tiles.set(`${record.tileX},${record.tileY}`, pixels);
    }
  }

  return tiles;
}

/**
 * Check if a building has PNG files on disk
 */
export async function buildingExistsOnDisk(buildingId: string): Promise<boolean> {
  const count = await db.select()
    .from(schema.buildingTiles)
    .where(eq(schema.buildingTiles.buildingId, buildingId))
    .limit(1);

  return count.length > 0;
}

/**
 * Delete a building's PNG files and database records
 */
export async function deleteBuildingFromDisk(buildingId: string): Promise<void> {
  // Delete PNG files
  await deleteBuildingPngs(buildingId);

  // Delete database records (should cascade from buildings table, but just in case)
  await db.delete(schema.buildingTiles)
    .where(eq(schema.buildingTiles.buildingId, buildingId));

  console.log(`[Building] Deleted building ${buildingId}`);
}
