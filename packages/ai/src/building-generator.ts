import OpenAI from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import type { PixelGrid, Pixel, BuildingSprite, BuildingTile } from '@maldoror/protocol';
import { BASE_SIZE, RESOLUTIONS } from '@maldoror/protocol';

const DEBUG_DIR = 'debug-buildings';

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
        row.push(null); // transparent
      } else {
        row.push({ r, g, b });
      }
    }
    grid.push(row);
  }

  return grid;
}

/**
 * Build the prompt for building generation
 */
function buildBuildingPrompt(description: string): string {
  return `Create a detailed TOP-DOWN view of a building/structure for an RPG game.

STYLE REQUIREMENTS:
- High quality, detailed digital art illustration
- TOP-DOWN perspective (camera directly above, looking straight down)
- The building should be viewed from above, showing the roof/top
- Clean, professional game art style
- Rich colors with proper shading

COMPOSITION REQUIREMENTS:
- The building should fill the ENTIRE square image
- Building must be a 3x3 tile grid structure when divided equally
- Each of the 9 sections should be visually coherent as individual tiles
- The building should have clear edges that align with the tile grid
- Transparent/empty background only - no ground, grass, or surroundings
- The building itself should be 100% opaque

DO NOT:
- Create pixel art or blocky style
- Show side views or perspective angles
- Add any background elements, ground, shadows on ground, or surroundings
- Add text, UI, borders, or frames
- Make any part of the building semi-transparent

BUILDING TO CREATE: ${description}`;
}

export interface BuildingGenerationOptions {
  description: string;
  apiKey: string;
  model?: 'dall-e-3' | 'dall-e-2' | 'gpt-image-1';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  username?: string;
  onProgress?: (step: string, current: number, total: number) => void;
}

export interface BuildingGenerationResult {
  success: boolean;
  sprite?: BuildingSprite;
  error?: string;
  debugDir?: string;
}

/**
 * Generate a single high-fidelity building image
 */
async function generateBuildingImage(
  openai: OpenAI,
  model: string,
  prompt: string,
  quality: 'low' | 'medium' | 'high' | 'auto'
): Promise<Buffer> {
  const result = await openai.images.generate({
    model,
    prompt,
    size: '1024x1024',
    quality,
    background: 'transparent',
  });

  // Log response for debugging (excluding base64 data)
  const debugResult = {
    ...result,
    data: result.data?.map(item => ({
      ...item,
      b64_json: item.b64_json ? `[${item.b64_json.length} chars]` : undefined,
    })),
  };
  console.log('[BUILDING GEN RESPONSE]', JSON.stringify(debugResult, null, 2));

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('No image base64 data returned');
  }

  return Buffer.from(b64, 'base64');
}

/**
 * Extract a tile from a larger image buffer
 * @param imageBuffer - Full 1024x1024 building image
 * @param tileX - Tile column (0-2)
 * @param tileY - Tile row (0-2)
 * @returns Buffer of the extracted tile (341x341 approx)
 */
async function extractTile(
  imageBuffer: Buffer,
  tileX: number,
  tileY: number
): Promise<Buffer> {
  const tileSize = Math.floor(1024 / 3); // ~341 pixels per tile

  return sharp(imageBuffer)
    .extract({
      left: tileX * tileSize,
      top: tileY * tileSize,
      width: tileSize,
      height: tileSize,
    })
    .toBuffer();
}

/**
 * Pixelate a tile image to a specific size
 */
async function pixelateTileToSize(tileBuffer: Buffer, size: number): Promise<PixelGrid> {
  const raw = await sharp(tileBuffer)
    .resize(size, size, {
      fit: 'fill',
      kernel: 'nearest',
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return imageToPixelGrid(raw.data, raw.info.width, raw.info.height);
}

/**
 * Pixelate a tile to all resolution sizes
 */
async function pixelateTileAllResolutions(tileBuffer: Buffer): Promise<Record<string, PixelGrid>> {
  const results: Record<string, PixelGrid> = {};
  for (const size of RESOLUTIONS) {
    results[String(size)] = await pixelateTileToSize(tileBuffer, size);
  }
  return results;
}

/**
 * Generate a building sprite using OpenAI's image generation
 *
 * Process:
 * 1. Generate single 1024x1024 building image (top-down view)
 * 2. Split into 9 tiles (3x3 grid)
 * 3. Pixelate each tile to all resolutions
 */
export async function generateBuildingSprite(
  options: BuildingGenerationOptions
): Promise<BuildingGenerationResult> {
  const { description, apiKey, model = 'gpt-image-1', quality = 'high', username = 'unknown', onProgress } = options;

  const openai = new OpenAI({ apiKey });

  // Create debug directory
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '_');
  const debugDir = path.join(DEBUG_DIR, `${timestamp}_${safeUsername}`);

  const progress = (step: string, current: number, total: number) => {
    console.log(`[BUILDING ${current}/${total}] ${step}`);
    onProgress?.(step, current, total);
  };

  try {
    fs.mkdirSync(debugDir, { recursive: true });

    const prompt = buildBuildingPrompt(description);
    fs.writeFileSync(path.join(debugDir, 'prompt.txt'), prompt);

    // Step 1: Generate the building image
    progress('Generating building image', 1, 3);
    const buildingImage = await generateBuildingImage(openai, model, prompt, quality);
    fs.writeFileSync(path.join(debugDir, 'building_original.png'), buildingImage);

    // Step 2: Split into 9 tiles
    progress('Splitting into tiles', 2, 3);
    const tileBuffers: Buffer[][] = [];
    for (let y = 0; y < 3; y++) {
      const row: Buffer[] = [];
      for (let x = 0; x < 3; x++) {
        const tile = await extractTile(buildingImage, x, y);
        row.push(tile);
        fs.writeFileSync(path.join(debugDir, `tile_${x}_${y}.png`), tile);
      }
      tileBuffers.push(row);
    }

    // Step 3: Pixelate all tiles to all resolutions
    progress('Pixelating tiles', 3, 3);
    const tiles: BuildingTile[][] = [];

    for (let y = 0; y < 3; y++) {
      const row: BuildingTile[] = [];
      for (let x = 0; x < 3; x++) {
        const tileBuffer = tileBuffers[y]![x]!;
        const resolutions = await pixelateTileAllResolutions(tileBuffer);
        const baseSize = String(BASE_SIZE);

        row.push({
          pixels: resolutions[baseSize]!,
          resolutions,
        });
      }
      tiles.push(row);
    }

    const sprite: BuildingSprite = {
      width: 3,
      height: 3,
      tiles,
    };

    // Save sprite JSON for debugging
    fs.writeFileSync(path.join(debugDir, 'building_sprite.json'), JSON.stringify(sprite, null, 2));

    console.log(`Building generated successfully. Debug files: ${debugDir}`);
    return { success: true, sprite, debugDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Building generation failed:', message);
    return { success: false, error: message, debugDir };
  }
}
