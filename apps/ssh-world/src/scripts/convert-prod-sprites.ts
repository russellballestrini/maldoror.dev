#!/usr/bin/env npx tsx
/**
 * Convert downloaded production sprites to GLB
 */

import { config } from 'dotenv';
import fs from 'fs/promises';
import path from 'path';
import { imageToGlb } from '@maldoror/ai';

config({ path: path.resolve(process.cwd(), '../../.env') });

const SPRITES_DIR = path.join(process.cwd(), 'temp-sprites-prod');
const OUTPUT_DIR = path.join(process.cwd(), '../../apps/web-3d/public/models/players');

async function main() {
  if (!process.env.MESHY_API_KEY) {
    console.error('Error: MESHY_API_KEY required');
    process.exit(1);
  }

  // Get all PNG files
  const files = await fs.readdir(SPRITES_DIR);
  const pngFiles = files.filter(f => f.endsWith('.png'));

  console.log(`Found ${pngFiles.length} sprites to convert`);
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of pngFiles) {
    const userId = file.replace('.png', '');
    const outputPath = path.join(OUTPUT_DIR, `${userId}.glb`);
    const inputPath = path.join(SPRITES_DIR, file);

    // Check if already exists
    try {
      await fs.access(outputPath);
      console.log(`[SKIP] Already exists: ${userId}`);
      skipped++;
      continue;
    } catch {
      // Doesn't exist, proceed
    }

    try {
      console.log(`[CONVERT] ${userId}`);
      await imageToGlb(inputPath, outputPath, {
        aiModel: 'meshy-4',
        targetPolycount: 10000,
        onProgress: (p) => process.stdout.write(`\r  Progress: ${p}%`),
      });
      console.log('');
      converted++;
    } catch (err) {
      console.error(`[ERROR] ${userId}: ${err instanceof Error ? err.message : err}`);
      failed++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Converted: ${converted}`);
  console.log(`Skipped: ${skipped}`);
  console.log(`Failed: ${failed}`);
}

main().catch(console.error);
