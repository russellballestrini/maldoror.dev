#!/usr/bin/env npx tsx
/**
 * Convert all sprite images to 3D GLB models using Meshy.ai API
 *
 * Usage:
 *   npx tsx src/scripts/convert-sprites-to-glb.ts
 *
 * Options:
 *   --players-only    Only convert player sprites
 *   --npcs-only       Only convert NPC sprites
 *   --buildings-only  Only convert building sprites
 *   --dry-run         List what would be converted without doing it
 *   --limit=N         Only convert first N entities
 */

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { imageToGlb } from '@maldoror/ai';

// Load .env from monorepo root
config({ path: path.resolve(process.cwd(), '../../.env') });

const SPRITES_DIR = path.join(process.cwd(), 'sprites');
const NPCS_DIR = path.join(process.cwd(), 'npcs');
const BUILDINGS_DIR = path.join(process.cwd(), 'buildings');
const OUTPUT_DIR = path.join(process.cwd(), 'models');

interface ConversionResult {
  id: string;
  type: 'player' | 'npc' | 'building';
  inputPath: string;
  outputPath: string;
  success: boolean;
  error?: string;
}

async function getDirectories(basePath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(basePath, { withFileTypes: true });
    return entries
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name);
  } catch {
    return [];
  }
}

async function findSpriteImage(dir: string): Promise<string | null> {
  // For players/NPCs, use frame_down_0_256.png (front-facing)
  const framePath = path.join(dir, 'frame_down_0_256.png');
  try {
    await fs.access(framePath);
    return framePath;
  } catch {
    // Try other patterns
    const files = await fs.readdir(dir);
    const png = files.find(f => f.endsWith('.png'));
    return png ? path.join(dir, png) : null;
  }
}

async function findBuildingImage(dir: string): Promise<string | null> {
  // For buildings, combine tiles or use a representative tile
  // For now, use the center tile: tile_north_1_1_256.png
  const tilePath = path.join(dir, 'tile_north_1_1_256.png');
  try {
    await fs.access(tilePath);
    return tilePath;
  } catch {
    // Try to find any tile
    const files = await fs.readdir(dir);
    const tile = files.find(f => f.includes('tile_') && f.endsWith('_256.png'));
    return tile ? path.join(dir, tile) : null;
  }
}

async function convertEntity(
  id: string,
  type: 'player' | 'npc' | 'building',
  inputPath: string,
  outputDir: string,
  dryRun: boolean
): Promise<ConversionResult> {
  const outputPath = path.join(outputDir, type + 's', `${id}.glb`);

  if (dryRun) {
    console.log(`[DRY RUN] Would convert: ${inputPath} -> ${outputPath}`);
    return { id, type, inputPath, outputPath, success: true };
  }

  try {
    // Check if already converted
    try {
      await fs.access(outputPath);
      console.log(`[SKIP] Already exists: ${outputPath}`);
      return { id, type, inputPath, outputPath, success: true };
    } catch {
      // File doesn't exist, proceed with conversion
    }

    console.log(`[CONVERT] ${type} ${id}: ${inputPath}`);
    await imageToGlb(inputPath, outputPath, {
      aiModel: 'meshy-4',
      targetPolycount: 10000, // Lower poly for game use
      symmetryMode: 'auto',
      onProgress: (p) => process.stdout.write(`\r  Progress: ${p}%`),
    });
    console.log(''); // New line after progress
    return { id, type, inputPath, outputPath, success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[ERROR] ${type} ${id}: ${message}`);
    return { id, type, inputPath, outputPath, success: false, error: message };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const playersOnly = args.includes('--players-only');
  const npcsOnly = args.includes('--npcs-only');
  const buildingsOnly = args.includes('--buildings-only');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : Infinity;

  if (!process.env.MESHY_API_KEY && !dryRun) {
    console.error('Error: MESHY_API_KEY environment variable is required');
    console.error('Get your API key from: https://www.meshy.ai/');
    process.exit(1);
  }

  const results: ConversionResult[] = [];
  let count = 0;

  // Create output directories
  if (!dryRun) {
    await fs.mkdir(path.join(OUTPUT_DIR, 'players'), { recursive: true });
    await fs.mkdir(path.join(OUTPUT_DIR, 'npcs'), { recursive: true });
    await fs.mkdir(path.join(OUTPUT_DIR, 'buildings'), { recursive: true });
  }

  // Convert players
  if (!npcsOnly && !buildingsOnly) {
    console.log('\n=== Converting Players ===');
    const playerIds = await getDirectories(SPRITES_DIR);
    console.log(`Found ${playerIds.length} players`);

    for (const id of playerIds) {
      if (count >= limit) break;
      const imagePath = await findSpriteImage(path.join(SPRITES_DIR, id));
      if (imagePath) {
        results.push(await convertEntity(id, 'player', imagePath, OUTPUT_DIR, dryRun));
        count++;
      }
    }
  }

  // Convert NPCs
  if (!playersOnly && !buildingsOnly) {
    console.log('\n=== Converting NPCs ===');
    const npcIds = await getDirectories(NPCS_DIR);
    console.log(`Found ${npcIds.length} NPCs`);

    for (const id of npcIds) {
      if (count >= limit) break;
      const imagePath = await findSpriteImage(path.join(NPCS_DIR, id));
      if (imagePath) {
        results.push(await convertEntity(id, 'npc', imagePath, OUTPUT_DIR, dryRun));
        count++;
      }
    }
  }

  // Convert buildings
  if (!playersOnly && !npcsOnly) {
    console.log('\n=== Converting Buildings ===');
    const buildingIds = await getDirectories(BUILDINGS_DIR);
    console.log(`Found ${buildingIds.length} buildings`);

    for (const id of buildingIds) {
      if (count >= limit) break;
      const imagePath = await findBuildingImage(path.join(BUILDINGS_DIR, id));
      if (imagePath) {
        results.push(await convertEntity(id, 'building', imagePath, OUTPUT_DIR, dryRun));
        count++;
      }
    }
  }

  // Summary
  console.log('\n=== Summary ===');
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total: ${results.length}`);
  console.log(`Success: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log('\nFailed conversions:');
    for (const r of failed) {
      console.log(`  - ${r.type} ${r.id}: ${r.error}`);
    }
  }

  console.log(`\nOutput directory: ${OUTPUT_DIR}`);
}

main().catch(console.error);
