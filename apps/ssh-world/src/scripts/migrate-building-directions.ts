/**
 * Migration script for building directional sprites
 *
 * This script handles two tasks:
 * 1. Legacy migration: Rename old format files (tile_0_0_256.png) to new format (tile_north_0_0_256.png)
 * 2. Direction generation: Generate east/south/west views using AI with north as reference
 *
 * Usage:
 *   pnpm tsx apps/ssh-world/src/scripts/migrate-building-directions.ts
 *
 * Environment:
 *   OPENAI_API_KEY - Required for generating new directions
 *   BUILDINGS_DIR - Optional, defaults to ./buildings
 */

import 'dotenv/config';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { db, schema } from '@maldoror/db';
import { eq } from 'drizzle-orm';
import { BASE_SIZE } from '@maldoror/protocol';
import {
  generateMissingDirections,
  processBuildingImage,
  type BuildingDirection,
} from '@maldoror/ai';

// ESM equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Get buildings directory
const BUILDINGS_BASE = process.env.BUILDINGS_DIR ||
  (fs.existsSync('/app/buildings') ? '/app/buildings' : path.join(__dirname, '../../buildings'));

/**
 * Get building tile PNG file path (new format with direction)
 */
function getBuildingPngPath(
  buildingId: string,
  tileX: number,
  tileY: number,
  resolution: number,
  direction: BuildingDirection
): string {
  return path.join(BUILDINGS_BASE, buildingId, `tile_${direction}_${tileX}_${tileY}_${resolution}.png`);
}

/**
 * Get legacy building tile PNG path (old format without direction)
 */
function getLegacyBuildingPngPath(
  buildingId: string,
  tileX: number,
  tileY: number,
  resolution: number
): string {
  return path.join(BUILDINGS_BASE, buildingId, `tile_${tileX}_${tileY}_${resolution}.png`);
}

/**
 * Migrate legacy file naming to new format (just renames files, updates DB)
 */
async function migrateLegacyFiles(buildingId: string): Promise<boolean> {
  const buildingDir = path.join(BUILDINGS_BASE, buildingId);
  if (!fs.existsSync(buildingDir)) {
    return false;
  }

  const tiles = await db.select()
    .from(schema.buildingTiles)
    .where(eq(schema.buildingTiles.buildingId, buildingId));

  if (tiles.length === 0) {
    return false;
  }

  let migrated = false;

  for (const tile of tiles) {
    const { tileX, tileY, resolution } = tile;

    // Check if legacy file exists
    const legacyPath = getLegacyBuildingPngPath(buildingId, tileX, tileY, resolution);
    const newPath = getBuildingPngPath(buildingId, tileX, tileY, resolution, 'north');

    if (fs.existsSync(legacyPath) && !fs.existsSync(newPath)) {
      // Rename file
      await fs.promises.rename(legacyPath, newPath);

      // Update database
      await db.update(schema.buildingTiles)
        .set({
          filePath: `${buildingId}/tile_north_${tileX}_${tileY}_${resolution}.png`,
          direction: 'north'
        })
        .where(eq(schema.buildingTiles.id, tile.id));

      migrated = true;
    }
  }

  return migrated;
}

/**
 * Stitch 9 north tiles into a single image for use as AI reference
 */
async function stitchNorthTiles(buildingId: string): Promise<Buffer | null> {
  const tileSize = BASE_SIZE; // 256
  const fullSize = tileSize * 3; // 768

  const composites: Array<{ input: Buffer; left: number; top: number }> = [];

  for (let y = 0; y < 3; y++) {
    for (let x = 0; x < 3; x++) {
      const tilePath = getBuildingPngPath(buildingId, x, y, tileSize, 'north');
      if (!fs.existsSync(tilePath)) {
        console.log(`    Missing tile: ${tilePath}`);
        return null;
      }
      const tileBuffer = await fs.promises.readFile(tilePath);
      composites.push({
        input: tileBuffer,
        left: x * tileSize,
        top: y * tileSize,
      });
    }
  }

  return sharp({
    create: {
      width: fullSize,
      height: fullSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .png()
    .toBuffer();
}

/**
 * Check if building needs direction generation
 */
async function needsDirectionGeneration(buildingId: string): Promise<boolean> {
  const tiles = await db.select()
    .from(schema.buildingTiles)
    .where(eq(schema.buildingTiles.buildingId, buildingId));

  if (tiles.length === 0) return false;

  const hasOtherDirections = tiles.some((t: typeof tiles[0]) => t.direction !== 'north');
  return !hasOtherDirections;
}

/**
 * Generate and save missing directions for a building
 */
async function generateAndSaveDirections(
  buildingId: string,
  description: string,
  apiKey: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`    Stitching north tiles as reference...`);
  const referenceImage = await stitchNorthTiles(buildingId);
  if (!referenceImage) {
    return { success: false, error: 'Could not stitch north tiles' };
  }

  console.log(`    Generating east/south/west views using AI...`);
  const result = await generateMissingDirections({
    referenceImage,
    description,
    apiKey,
  });

  if (!result.success || !result.images) {
    return { success: false, error: result.error };
  }

  // Process each generated image into a sprite and save
  console.log(`    Processing and saving tiles...`);

  for (const [direction, imageBuffer] of Object.entries(result.images) as [BuildingDirection, Buffer][]) {
    const sprite = await processBuildingImage(imageBuffer, undefined, direction);
    await saveSingleDirection(buildingId, sprite, direction);
  }

  return { success: true };
}

/**
 * Save a single direction's tiles to disk and database
 */
async function saveSingleDirection(
  buildingId: string,
  sprite: Awaited<ReturnType<typeof processBuildingImage>>,
  direction: BuildingDirection
): Promise<void> {
  const { RESOLUTIONS } = await import('@maldoror/protocol');
  const { ensureBuildingDir, savePixelGridAsPng, getBuildingPngPath: getPngPath } = await import('../utils/png-storage.js');

  ensureBuildingDir(buildingId);

  for (let tileY = 0; tileY < 3; tileY++) {
    for (let tileX = 0; tileX < 3; tileX++) {
      const tile = sprite.tiles[tileY]?.[tileX];
      if (!tile) continue;

      for (const resolution of RESOLUTIONS) {
        const pixels = tile.resolutions[String(resolution)];
        if (!pixels) continue;

        const filePath = getPngPath(buildingId, tileX, tileY, resolution, direction);
        const relativePath = `${buildingId}/tile_${direction}_${tileX}_${tileY}_${resolution}.png`;

        await savePixelGridAsPng(pixels, filePath);

        await db.insert(schema.buildingTiles).values({
          buildingId,
          tileX,
          tileY,
          resolution,
          direction,
          filePath: relativePath,
        }).onConflictDoNothing();
      }
    }
  }
}

/**
 * Main migration function
 */
async function main() {
  console.log('Building Direction Migration');
  console.log('============================');
  console.log(`Buildings directory: ${BUILDINGS_BASE}`);
  console.log('');

  const apiKey = process.env.OPENAI_API_KEY;
  const generateMode = !!apiKey;

  if (!generateMode) {
    console.log('Note: OPENAI_API_KEY not set - will only migrate legacy file names');
    console.log('Set OPENAI_API_KEY to generate east/south/west views using AI');
    console.log('');
  }

  // Get all buildings
  const buildings = await db.select({ id: schema.buildings.id, prompt: schema.buildings.prompt })
    .from(schema.buildings);

  console.log(`Found ${buildings.length} buildings to check`);
  console.log('');

  let legacyMigrated = 0;
  let directionsGenerated = 0;
  let skipped = 0;
  let errors = 0;
  const needsGeneration: string[] = [];

  for (const building of buildings) {
    console.log(`Processing ${building.id}...`);

    try {
      // Step 1: Migrate legacy file names
      const legacyResult = await migrateLegacyFiles(building.id);
      if (legacyResult) {
        console.log(`  Migrated legacy files to north format`);
        legacyMigrated++;
      }

      // Step 2: Check if needs direction generation
      const needsGen = await needsDirectionGeneration(building.id);
      if (!needsGen) {
        console.log(`  Already has all directions`);
        skipped++;
        continue;
      }

      if (!generateMode || !apiKey) {
        console.log(`  Needs direction generation (skipping - no API key)`);
        needsGeneration.push(building.id);
        continue;
      }

      // Step 3: Generate missing directions
      console.log(`  Generating missing directions...`);
      const genResult = await generateAndSaveDirections(
        building.id,
        building.prompt || 'A building',
        apiKey
      );

      if (genResult.success) {
        console.log(`  Successfully generated all directions`);
        directionsGenerated++;
      } else {
        console.error(`  Generation failed: ${genResult.error}`);
        errors++;
      }

    } catch (error) {
      console.error(`  Error: ${error instanceof Error ? error.message : String(error)}`);
      errors++;
    }

    console.log('');
  }

  console.log('Migration Complete');
  console.log('==================');
  console.log(`  Legacy files migrated: ${legacyMigrated}`);
  console.log(`  Directions generated:  ${directionsGenerated}`);
  console.log(`  Already complete:      ${skipped}`);
  console.log(`  Errors:                ${errors}`);

  if (needsGeneration.length > 0) {
    console.log('');
    console.log('Buildings needing direction generation:');
    for (const id of needsGeneration) {
      console.log(`  - ${id}`);
    }
    console.log('');
    console.log('Run with OPENAI_API_KEY set to generate missing directions.');
  }

  process.exit(errors > 0 ? 1 : 0);
}

// Run migration
main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
