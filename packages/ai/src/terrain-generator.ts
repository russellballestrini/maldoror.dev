/**
 * AI-Generated Terrain Tile Generator
 *
 * Generates high-quality terrain tiles using GPT-Image-1-Mini:
 * - Base terrain tiles (grass, dirt, sand, water, stone)
 * - Transition tiles between terrain types (16 variants per pair using 4-bit autotiling)
 *
 * Tiles are generated at 1024x1024 then pixelated to all game resolutions.
 */

import OpenAI from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import type { Tile, PixelGrid, Pixel } from '@maldoror/protocol';
import { BASE_SIZE, RESOLUTIONS } from '@maldoror/protocol';

// Configure Sharp for better memory management
sharp.cache(false);
sharp.concurrency(1);
sharp.simd(false);

const DEBUG_DIR = 'debug-terrain';

/**
 * Terrain types
 */
export type TerrainType = 'grass' | 'dirt' | 'sand' | 'water' | 'stone';

/**
 * All terrain types
 */
export const TERRAIN_TYPES: TerrainType[] = ['grass', 'dirt', 'sand', 'water', 'stone'];

/**
 * Terrain transition pairs (from -> to)
 * These are the natural transitions that make sense visually
 */
export const TERRAIN_TRANSITIONS: [TerrainType, TerrainType][] = [
  ['grass', 'water'],   // Shoreline
  ['grass', 'sand'],    // Beach edge
  ['grass', 'dirt'],    // Worn path
  ['grass', 'stone'],   // Rocky outcrop
  ['sand', 'water'],    // Beach shore
  ['dirt', 'sand'],     // Desert edge
  ['dirt', 'stone'],    // Mountain base
];

/**
 * 4-bit autotile configuration (N, E, S, W edges)
 * Each bit represents whether that edge connects to the "to" terrain
 * 0 = connects to "from" terrain, 1 = connects to "to" terrain
 */
export const AUTOTILE_CONFIGS = [
  { id: 0b0000, name: 'full', desc: 'No transitions (full base terrain)' },
  { id: 0b0001, name: 'n', desc: 'North edge transitions' },
  { id: 0b0010, name: 'e', desc: 'East edge transitions' },
  { id: 0b0011, name: 'ne', desc: 'North and East edges' },
  { id: 0b0100, name: 's', desc: 'South edge transitions' },
  { id: 0b0101, name: 'ns', desc: 'North and South edges' },
  { id: 0b0110, name: 'se', desc: 'South and East edges' },
  { id: 0b0111, name: 'nse', desc: 'North, South, East edges' },
  { id: 0b1000, name: 'w', desc: 'West edge transitions' },
  { id: 0b1001, name: 'nw', desc: 'North and West edges' },
  { id: 0b1010, name: 'ew', desc: 'East and West edges' },
  { id: 0b1011, name: 'new', desc: 'North, East, West edges' },
  { id: 0b1100, name: 'sw', desc: 'South and West edges' },
  { id: 0b1101, name: 'nsw', desc: 'North, South, West edges' },
  { id: 0b1110, name: 'sew', desc: 'South, East, West edges' },
  { id: 0b1111, name: 'all', desc: 'All edges transition (island)' },
];

/**
 * Terrain descriptions for prompting
 */
const TERRAIN_DESCRIPTIONS: Record<TerrainType, string> = {
  grass: 'lush green grass with varied blades, small clovers, occasional tiny wildflowers, natural texture variation',
  dirt: 'natural brown earth with small pebbles, varied soil tones, occasional tiny twigs, realistic dirt texture',
  sand: 'warm beach sand with subtle dune ripples, tiny shell fragments, natural sand color variation',
  water: 'clear blue water with subtle ripples, light reflections, varying depth shades from shallow to deep',
  stone: 'rough gray stone with natural cracks, moss patches, varied rock texture, weathered surface',
};

/**
 * Convert raw RGBA buffer to PixelGrid
 */
function imageToPixelGrid(
  data: Buffer,
  width: number,
  height: number,
  alphaThreshold = 32
): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = data[idx]!;
      const g = data[idx + 1]!;
      const b = data[idx + 2]!;
      const a = data[idx + 3]!;
      if (a < alphaThreshold) {
        row.push(null);
      } else {
        row.push({ r, g, b });
      }
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Build prompt for base terrain tile
 */
function buildBaseTerrainPrompt(terrain: TerrainType): string {
  const desc = TERRAIN_DESCRIPTIONS[terrain];
  return `Create a seamless tileable top-down terrain texture for a 2D RPG game.

TERRAIN TYPE: ${terrain.toUpperCase()}
DESCRIPTION: ${desc}

CRITICAL REQUIREMENTS:
- MUST be perfectly seamless/tileable (edges wrap to opposite sides)
- Top-down orthographic view (looking straight down at ground)
- Rich detail and realistic texture
- Natural color variation within the terrain type
- Soft, even lighting with no harsh shadows
- No objects, characters, or items - ONLY the ground texture
- Fill the ENTIRE image with terrain (no borders or margins)

STYLE:
- High quality detailed digital art
- NOT pixel art - smooth gradients and natural detail
- Game asset quality suitable for a modern 2D RPG
- Colors should be vibrant but natural

The tile will be used in a game where many copies are placed next to each other, so seamless tiling is ESSENTIAL.`;
}

/**
 * Build prompt for transition tile
 */
function buildTransitionPrompt(
  fromTerrain: TerrainType,
  toTerrain: TerrainType,
  config: typeof AUTOTILE_CONFIGS[number]
): string {
  const fromDesc = TERRAIN_DESCRIPTIONS[fromTerrain];
  const toDesc = TERRAIN_DESCRIPTIONS[toTerrain];

  // Determine which edges have the "to" terrain
  const hasNorth = (config.id & 0b0001) !== 0;
  const hasEast = (config.id & 0b0010) !== 0;
  const hasSouth = (config.id & 0b0100) !== 0;
  const hasWest = (config.id & 0b1000) !== 0;

  const edgeDescriptions: string[] = [];
  if (hasNorth) edgeDescriptions.push('NORTH edge');
  if (hasEast) edgeDescriptions.push('EAST edge');
  if (hasSouth) edgeDescriptions.push('SOUTH edge');
  if (hasWest) edgeDescriptions.push('WEST edge');

  const transitionEdges = edgeDescriptions.length > 0
    ? edgeDescriptions.join(', ')
    : 'NO edges (full base terrain)';

  return `Create a seamless tileable terrain TRANSITION tile for a 2D RPG game.

BASE TERRAIN (center/main): ${fromTerrain.toUpperCase()} - ${fromDesc}
EDGE TERRAIN: ${toTerrain.toUpperCase()} - ${toDesc}

TRANSITION CONFIGURATION:
- ${transitionEdges} should show ${toTerrain}
- Other edges remain ${fromTerrain}
- The transition should be NATURAL and GRADUAL (not a hard line)

CRITICAL REQUIREMENTS:
- MUST be perfectly seamless/tileable
- Top-down orthographic view (looking straight down)
- The ${fromTerrain} dominates the center
- ${toTerrain} appears at the specified edges with natural blending
- Transition should look like natural terrain meeting (not artificial)
- No objects, characters, or items
- Fill the ENTIRE image

EXAMPLE: If north edge is ${toTerrain}, the top portion gradually transitions from ${fromTerrain} (center) to ${toTerrain} (top edge).

STYLE:
- High quality detailed digital art
- NOT pixel art - smooth gradients
- Natural, realistic terrain blending`;
}

/**
 * Generate a single image using OpenAI
 */
async function generateImage(
  openai: OpenAI,
  prompt: string,
  quality: 'low' | 'medium' | 'high' | 'auto' = 'high'
): Promise<Buffer> {
  const result = await openai.images.generate({
    model: 'gpt-image-1-mini',
    prompt,
    size: '1024x1024',
    quality,
  });

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('No image data returned');
  }

  return Buffer.from(b64, 'base64');
}

/**
 * Pixelate image to specific size
 */
async function pixelateToSize(imageBuffer: Buffer, size: number): Promise<PixelGrid> {
  const raw = await sharp(imageBuffer)
    .resize(size, size, {
      fit: 'cover',
      kernel: 'nearest',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return imageToPixelGrid(raw.data, raw.info.width, raw.info.height);
}

/**
 * Pixelate image to all resolutions
 */
async function pixelateAllResolutions(imageBuffer: Buffer): Promise<Record<string, PixelGrid>> {
  const results: Record<string, PixelGrid> = {};
  for (const size of RESOLUTIONS) {
    results[String(size)] = await pixelateToSize(imageBuffer, size);
  }
  return results;
}

/**
 * Create a Tile object from generated image
 */
async function createTileFromImage(
  id: string,
  name: string,
  imageBuffer: Buffer,
  walkable: boolean
): Promise<Tile> {
  const resolutions = await pixelateAllResolutions(imageBuffer);

  return {
    id,
    name,
    pixels: resolutions[String(BASE_SIZE)]!,
    walkable,
    resolutions,
  };
}

export interface TerrainGenerationOptions {
  apiKey: string;
  quality?: 'low' | 'medium' | 'high' | 'auto';
  outputDir?: string;
  onProgress?: (step: string, current: number, total: number) => void;
}

export interface TerrainGenerationResult {
  success: boolean;
  baseTiles: Map<string, Tile>;
  transitionTiles: Map<string, Tile>;
  error?: string;
}

/**
 * Generate all base terrain tiles
 */
export async function generateBaseTerrain(
  options: TerrainGenerationOptions
): Promise<Map<string, Tile>> {
  const { apiKey, quality = 'high', outputDir = DEBUG_DIR, onProgress } = options;
  const openai = new OpenAI({ apiKey });
  const tiles = new Map<string, Tile>();

  fs.mkdirSync(outputDir, { recursive: true });

  const total = TERRAIN_TYPES.length;
  let current = 0;

  for (const terrain of TERRAIN_TYPES) {
    current++;
    onProgress?.(`Generating ${terrain} base tile`, current, total);
    console.log(`[TERRAIN ${current}/${total}] Generating ${terrain}...`);

    const prompt = buildBaseTerrainPrompt(terrain);
    fs.writeFileSync(path.join(outputDir, `${terrain}_prompt.txt`), prompt);

    const imageBuffer = await generateImage(openai, prompt, quality);
    fs.writeFileSync(path.join(outputDir, `${terrain}_original.png`), imageBuffer);

    const walkable = terrain !== 'water';
    const tile = await createTileFromImage(terrain, terrain, imageBuffer, walkable);
    tiles.set(terrain, tile);

    console.log(`[TERRAIN ${current}/${total}] ${terrain} complete`);
  }

  return tiles;
}

/**
 * Generate transition tiles for a specific terrain pair
 */
export async function generateTransitionTiles(
  fromTerrain: TerrainType,
  toTerrain: TerrainType,
  options: TerrainGenerationOptions
): Promise<Map<string, Tile>> {
  const { apiKey, quality = 'high', outputDir = DEBUG_DIR, onProgress } = options;
  const openai = new OpenAI({ apiKey });
  const tiles = new Map<string, Tile>();

  const transitionDir = path.join(outputDir, `${fromTerrain}_to_${toTerrain}`);
  fs.mkdirSync(transitionDir, { recursive: true });

  const total = AUTOTILE_CONFIGS.length;
  let current = 0;

  for (const config of AUTOTILE_CONFIGS) {
    current++;
    const tileId = `${fromTerrain}_to_${toTerrain}_${config.name}`;
    onProgress?.(`Generating ${tileId}`, current, total);
    console.log(`[TRANSITION ${current}/${total}] ${tileId}...`);

    // Skip the "full" variant (0b0000) - that's just the base tile
    if (config.id === 0b0000) {
      console.log(`[TRANSITION ${current}/${total}] Skipping full (use base tile)`);
      continue;
    }

    const prompt = buildTransitionPrompt(fromTerrain, toTerrain, config);
    fs.writeFileSync(path.join(transitionDir, `${config.name}_prompt.txt`), prompt);

    const imageBuffer = await generateImage(openai, prompt, quality);
    fs.writeFileSync(path.join(transitionDir, `${config.name}_original.png`), imageBuffer);

    // Transition tiles walkability depends on terrains involved
    const walkable = fromTerrain !== 'water' && toTerrain !== 'water';
    const tile = await createTileFromImage(tileId, `${fromTerrain} to ${toTerrain} (${config.name})`, imageBuffer, walkable);
    tiles.set(tileId, tile);

    console.log(`[TRANSITION ${current}/${total}] ${tileId} complete`);
  }

  return tiles;
}

/**
 * Generate ALL terrain tiles (base + all transitions)
 */
export async function generateAllTerrain(
  options: TerrainGenerationOptions
): Promise<TerrainGenerationResult> {
  const { outputDir = DEBUG_DIR, onProgress } = options;

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const fullOutputDir = path.join(outputDir, timestamp);
  fs.mkdirSync(fullOutputDir, { recursive: true });

  try {
    // Calculate totals
    const baseTotal = TERRAIN_TYPES.length;
    const transitionTotal = TERRAIN_TRANSITIONS.length * 15; // 15 variants per pair (excluding full)
    const grandTotal = baseTotal + transitionTotal;
    let completed = 0;

    const wrappedProgress = (step: string, _current: number, _total: number) => {
      completed++;
      onProgress?.(step, completed, grandTotal);
    };

    console.log(`\n=== Generating ${grandTotal} terrain tiles ===\n`);
    console.log(`Base tiles: ${baseTotal}`);
    console.log(`Transition pairs: ${TERRAIN_TRANSITIONS.length}`);
    console.log(`Transitions per pair: 15`);
    console.log(`Total transitions: ${transitionTotal}`);
    console.log(`Output: ${fullOutputDir}\n`);

    // Generate base tiles
    console.log('--- Generating Base Tiles ---');
    const baseTiles = await generateBaseTerrain({
      ...options,
      outputDir: fullOutputDir,
      onProgress: wrappedProgress,
    });

    // Generate transition tiles
    console.log('\n--- Generating Transition Tiles ---');
    const transitionTiles = new Map<string, Tile>();

    for (const [from, to] of TERRAIN_TRANSITIONS) {
      console.log(`\n[PAIR] ${from} → ${to}`);
      const pairTiles = await generateTransitionTiles(from, to, {
        ...options,
        outputDir: fullOutputDir,
        onProgress: wrappedProgress,
      });

      for (const [id, tile] of pairTiles) {
        transitionTiles.set(id, tile);
      }
    }

    // Save tile manifest
    const manifest = {
      generated: new Date().toISOString(),
      baseTiles: Array.from(baseTiles.keys()),
      transitionTiles: Array.from(transitionTiles.keys()),
      totalTiles: baseTiles.size + transitionTiles.size,
    };
    fs.writeFileSync(path.join(fullOutputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    console.log(`\n=== Generation Complete ===`);
    console.log(`Base tiles: ${baseTiles.size}`);
    console.log(`Transition tiles: ${transitionTiles.size}`);
    console.log(`Total: ${baseTiles.size + transitionTiles.size}`);
    console.log(`Output: ${fullOutputDir}`);

    return {
      success: true,
      baseTiles,
      transitionTiles,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Terrain generation failed:', message);
    return {
      success: false,
      baseTiles: new Map(),
      transitionTiles: new Map(),
      error: message,
    };
  }
}

/**
 * Generate water animation frames (4 frames with slight variation)
 */
export async function generateWaterAnimation(
  options: TerrainGenerationOptions
): Promise<Tile | null> {
  const { apiKey, quality = 'high', outputDir = DEBUG_DIR, onProgress } = options;
  const openai = new OpenAI({ apiKey });

  const waterDir = path.join(outputDir, 'water_animated');
  fs.mkdirSync(waterDir, { recursive: true });

  const frames: PixelGrid[] = [];
  const animationResolutions: Record<string, PixelGrid[]> = {};

  for (let i = 0; i < 4; i++) {
    onProgress?.(`Generating water frame ${i + 1}/4`, i + 1, 4);
    console.log(`[WATER ANIM] Frame ${i + 1}/4...`);

    const prompt = `Create a seamless tileable water texture for a 2D RPG game.

FRAME ${i + 1} OF 4 - ANIMATION SEQUENCE

Water with gentle ripples and light reflections. This frame should show:
- Subtle wave pattern at phase ${i * 90} degrees
- Light reflection spots slightly shifted
- Natural water movement feel

CRITICAL: Must tile seamlessly. Top-down view. Rich blue tones with depth variation.
Fill entire image with water texture. High quality digital art, NOT pixel art.`;

    const imageBuffer = await generateImage(openai, prompt, quality);
    fs.writeFileSync(path.join(waterDir, `frame_${i}_original.png`), imageBuffer);

    const resolutions = await pixelateAllResolutions(imageBuffer);
    frames.push(resolutions[String(BASE_SIZE)]!);

    // Build animation resolutions
    for (const size of RESOLUTIONS) {
      const key = String(size);
      if (!animationResolutions[key]) {
        animationResolutions[key] = [];
      }
      animationResolutions[key]!.push(resolutions[key]!);
    }
  }

  return {
    id: 'water',
    name: 'water',
    pixels: frames[0]!,
    walkable: false,
    animated: true,
    animationFrames: frames,
    resolutions: { [String(BASE_SIZE)]: frames[0]! },
    animationResolutions,
  };
}
