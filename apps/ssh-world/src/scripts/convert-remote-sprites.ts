#!/usr/bin/env npx tsx
/**
 * Download sprites from production server and convert to GLB
 */

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { imageToGlb } from '@maldoror/ai';

config({ path: path.resolve(process.cwd(), '../../.env') });

const API_URL = 'http://134.199.180.251:3000';
const OUTPUT_DIR = path.join(process.cwd(), '../../apps/web-3d/public/models');
const TEMP_DIR = path.join(process.cwd(), 'temp-sprites');

interface Entity {
  id: string;
  type: string;
  spriteUrl?: string;
  tiles?: { x: number; y: number; url: string }[];
}

function getSpriteUrl(entity: Entity): string | null {
  if (entity.spriteUrl) return entity.spriteUrl;

  // For buildings, use the center tile (1,1)
  if (entity.type === 'building' && entity.tiles) {
    const centerTile = entity.tiles.find(t => t.x === 1 && t.y === 1);
    return centerTile?.url || entity.tiles[0]?.url || null;
  }

  return null;
}

async function downloadSprite(url: string, outputPath: string): Promise<void> {
  const fullUrl = url.startsWith('http') ? url : `${API_URL}${url}`;
  console.log(`  Downloading: ${fullUrl}`);

  const response = await fetch(fullUrl);
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, buffer);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1]!, 10) : Infinity;
  const typeArg = args.find(a => a.startsWith('--type='));
  const typeFilter = typeArg ? typeArg.split('=')[1] : null;

  if (!process.env.MESHY_API_KEY && !dryRun) {
    console.error('Error: MESHY_API_KEY required');
    process.exit(1);
  }

  // Fetch entities from production
  console.log('Fetching entities from production...');
  const response = await fetch(`${API_URL}/api/entities`);
  const data = await response.json() as { entities: Entity[] };

  // Filter to entities with sprites (or tiles for buildings)
  let entities = data.entities.filter(e =>
    getSpriteUrl(e) && ['player', 'building', 'auton', 'npc'].includes(e.type)
  );

  if (typeFilter) {
    entities = entities.filter(e => e.type === typeFilter);
  }

  console.log(`Found ${entities.length} entities with sprites`);

  // Create directories
  if (!dryRun) {
    await fs.mkdir(path.join(OUTPUT_DIR, 'players'), { recursive: true });
    await fs.mkdir(path.join(OUTPUT_DIR, 'buildings'), { recursive: true });
    await fs.mkdir(path.join(OUTPUT_DIR, 'npcs'), { recursive: true });
    await fs.mkdir(TEMP_DIR, { recursive: true });
  }

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const entity of entities) {
    if (converted >= limit) break;

    const typeFolder = entity.type === 'auton' ? 'npcs' : entity.type + 's';
    const outputPath = path.join(OUTPUT_DIR, typeFolder, `${entity.id}.glb`);

    // Check if already exists
    try {
      await fs.access(outputPath);
      console.log(`[SKIP] Already exists: ${entity.id}`);
      skipped++;
      continue;
    } catch {
      // Doesn't exist, proceed
    }

    if (dryRun) {
      console.log(`[DRY RUN] Would convert: ${entity.type} ${entity.id}`);
      converted++;
      continue;
    }

    try {
      // Download sprite
      const spriteUrl = getSpriteUrl(entity)!;
      const tempPath = path.join(TEMP_DIR, `${entity.id}.png`);
      await downloadSprite(spriteUrl, tempPath);

      // Convert to GLB
      console.log(`[CONVERT] ${entity.type} ${entity.id}`);
      await imageToGlb(tempPath, outputPath, {
        aiModel: 'meshy-4',
        targetPolycount: 10000,
        onProgress: (p) => process.stdout.write(`\r  Progress: ${p}%`),
      });
      console.log('');

      // Clean up temp file
      await fs.unlink(tempPath);
      converted++;
    } catch (err) {
      console.error(`[ERROR] ${entity.id}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Converted: ${converted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);

  // Clean up temp dir
  try {
    await fs.rmdir(TEMP_DIR);
  } catch {}
}

main().catch(console.error);
