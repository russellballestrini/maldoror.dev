#!/usr/bin/env npx tsx
/**
 * Generate AI terrain tiles
 *
 * Usage:
 *   npx tsx scripts/generate-terrain.ts [--base-only] [--transitions-only] [--water-anim]
 *
 * Generates:
 *   - 5 base terrain tiles (grass, dirt, sand, water, stone)
 *   - 105 transition tiles (7 pairs × 15 variants each)
 *   - 4 water animation frames (optional)
 *
 * Output saved to debug-terrain/<timestamp>/
 */

import {
  generateAllTerrain,
  generateBaseTerrain,
  generateTransitionTiles,
  generateWaterAnimation,
  TERRAIN_TYPES,
  TERRAIN_TRANSITIONS,
  type TerrainType,
} from '@maldoror/ai';
import { db, schema } from '@maldoror/db';
import fs from 'fs';
import path from 'path';

// Get API key from environment
const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error('ERROR: OPENAI_API_KEY environment variable not set');
  process.exit(1);
}

const args = process.argv.slice(2);
const baseOnly = args.includes('--base-only');
const transitionsOnly = args.includes('--transitions-only');
const waterAnim = args.includes('--water-anim');

async function saveTileToDb(tile: { id: string; name: string; pixels: any; walkable: boolean; resolutions?: any; animated?: boolean; animationFrames?: any; animationResolutions?: any }) {
  // Save tile data to database
  const tileData = {
    id: tile.id,
    name: tile.name,
    pixels: JSON.stringify(tile.pixels),
    walkable: tile.walkable,
    resolutions: tile.resolutions ? JSON.stringify(tile.resolutions) : null,
    animated: tile.animated || false,
    animationFrames: tile.animationFrames ? JSON.stringify(tile.animationFrames) : null,
    animationResolutions: tile.animationResolutions ? JSON.stringify(tile.animationResolutions) : null,
    createdAt: new Date(),
  };

  // Upsert into database
  await db.insert(schema.terrainTiles)
    .values(tileData)
    .onConflictDoUpdate({
      target: schema.terrainTiles.id,
      set: {
        pixels: tileData.pixels,
        resolutions: tileData.resolutions,
        animated: tileData.animated,
        animationFrames: tileData.animationFrames,
        animationResolutions: tileData.animationResolutions,
      },
    });

  console.log(`  Saved ${tile.id} to database`);
}

async function main() {
  console.log('\n🌍 AI Terrain Tile Generator\n');
  console.log(`API Key: ${apiKey.slice(0, 10)}...`);

  const outputDir = 'debug-terrain';

  if (waterAnim) {
    console.log('\n--- Generating Water Animation ---\n');
    const waterTile = await generateWaterAnimation({
      apiKey,
      quality: 'high',
      outputDir,
      onProgress: (step, current, total) => {
        console.log(`[${current}/${total}] ${step}`);
      },
    });

    if (waterTile) {
      await saveTileToDb(waterTile);
      console.log('\n✅ Water animation saved!');
    }
    return;
  }

  if (baseOnly) {
    console.log('\n--- Generating Base Tiles Only ---\n');
    const tiles = await generateBaseTerrain({
      apiKey,
      quality: 'high',
      outputDir,
      onProgress: (step, current, total) => {
        console.log(`[${current}/${total}] ${step}`);
      },
    });

    console.log('\nSaving to database...');
    for (const [id, tile] of tiles) {
      await saveTileToDb(tile);
    }
    console.log(`\n✅ ${tiles.size} base tiles saved!`);
    return;
  }

  if (transitionsOnly) {
    // Generate transitions for a specific pair (or all)
    const pairArg = args.find(a => a.startsWith('--pair='));
    if (pairArg) {
      const [from, to] = pairArg.replace('--pair=', '').split('-') as [TerrainType, TerrainType];
      console.log(`\n--- Generating Transitions: ${from} → ${to} ---\n`);

      const tiles = await generateTransitionTiles(from, to, {
        apiKey,
        quality: 'high',
        outputDir,
        onProgress: (step, current, total) => {
          console.log(`[${current}/${total}] ${step}`);
        },
      });

      console.log('\nSaving to database...');
      for (const [id, tile] of tiles) {
        await saveTileToDb(tile);
      }
      console.log(`\n✅ ${tiles.size} transition tiles saved!`);
    } else {
      console.log('\n--- Generating All Transitions ---\n');
      for (const [from, to] of TERRAIN_TRANSITIONS) {
        console.log(`\n[PAIR] ${from} → ${to}`);
        const tiles = await generateTransitionTiles(from, to, {
          apiKey,
          quality: 'high',
          outputDir,
          onProgress: (step, current, total) => {
            console.log(`[${current}/${total}] ${step}`);
          },
        });

        console.log('Saving to database...');
        for (const [id, tile] of tiles) {
          await saveTileToDb(tile);
        }
      }
      console.log(`\n✅ All transitions saved!`);
    }
    return;
  }

  // Generate everything
  console.log('Generating ALL terrain tiles...');
  console.log(`  Base tiles: ${TERRAIN_TYPES.length}`);
  console.log(`  Transition pairs: ${TERRAIN_TRANSITIONS.length}`);
  console.log(`  Transitions per pair: 15`);
  console.log(`  Total: ${TERRAIN_TYPES.length + TERRAIN_TRANSITIONS.length * 15}`);

  const result = await generateAllTerrain({
    apiKey,
    quality: 'high',
    outputDir,
    onProgress: (step, current, total) => {
      console.log(`[${current}/${total}] ${step}`);
    },
  });

  if (!result.success) {
    console.error('\n❌ Generation failed:', result.error);
    process.exit(1);
  }

  console.log('\nSaving to database...');

  for (const [id, tile] of result.baseTiles) {
    await saveTileToDb(tile);
  }

  for (const [id, tile] of result.transitionTiles) {
    await saveTileToDb(tile);
  }

  console.log(`\n✅ Complete!`);
  console.log(`  Base tiles: ${result.baseTiles.size}`);
  console.log(`  Transition tiles: ${result.transitionTiles.size}`);
  console.log(`  Total: ${result.baseTiles.size + result.transitionTiles.size}`);
}

main().catch(console.error).finally(() => process.exit(0));
