import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import type { PixelGrid, Pixel, BuildingSprite, BuildingTile } from '@maldoror/protocol';
import { BASE_SIZE, RESOLUTIONS } from '@maldoror/protocol';

/**
 * Building direction type for camera rotation support
 * north = 0° (original), east = 90° CW, south = 180°, west = 270° CW
 */
export type BuildingDirection = 'north' | 'east' | 'south' | 'west';

/**
 * Directional building sprite - 4 orientations for camera rotation
 */
export interface DirectionalBuildingSprite {
  north: BuildingSprite;  // 0° - original
  east: BuildingSprite;   // 90° CW
  south: BuildingSprite;  // 180°
  west: BuildingSprite;   // 270° CW
}

/** All building directions */
export const BUILDING_DIRECTIONS: BuildingDirection[] = ['north', 'east', 'south', 'west'];

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
 * Build the prompt for building generation (north/front view - no reference)
 */
function buildBuildingPromptNorth(description: string): string {
  return `Create a detailed TOP-DOWN isometric view of a building/structure for an RPG game.

STYLE REQUIREMENTS:
- High quality, detailed digital art illustration
- TOP-DOWN isometric perspective (slight 3/4 view looking down at the building)
- Show the NORTH/FRONT face of the building prominently
- Clean, professional game art style
- Rich colors with proper shading and depth

COMPOSITION REQUIREMENTS:
- The building should fill the ENTIRE square image
- Building must be a 3x3 tile grid structure when divided equally
- Each of the 9 sections should be visually coherent as individual tiles
- The building should have clear edges that align with the tile grid
- Transparent/empty background only - no ground, grass, or surroundings
- The building itself should be 100% opaque

DO NOT:
- Create pixel art or blocky style
- Add any background elements, ground, shadows on ground, or surroundings
- Add text, UI, borders, or frames
- Make any part of the building semi-transparent

BUILDING TO CREATE: ${description}

This is the NORTH-FACING view (front entrance side of the building).`;
}

/**
 * Build the prompt for other directional views (using north as reference)
 */
function buildBuildingPromptDirection(
  _description: string,
  direction: 'east' | 'south' | 'west'
): string {
  const directionInstructions = {
    east: `CAMERA POSITION: You are now standing to the EAST of the building, looking WEST at it.

WHAT YOU SEE:
- The EAST wall of the building is now the prominent front-facing wall
- This was the RIGHT side of the building in the reference (north view)
- Rotate the entire building 90° CLOCKWISE from the reference
- Features that were on the right in the reference are now facing you`,

    south: `CAMERA POSITION: You are now standing to the SOUTH of the building, looking NORTH at it.

WHAT YOU SEE:
- The SOUTH wall (back) of the building is now the prominent front-facing wall
- This was the rear of the building in the reference (north view)
- Rotate the entire building 180° from the reference
- You are looking at the opposite side from the reference`,

    west: `CAMERA POSITION: You are now standing to the WEST of the building, looking EAST at it.

WHAT YOU SEE:
- The WEST wall of the building is now the prominent front-facing wall
- This was the LEFT side of the building in the reference (north view)
- Rotate the entire building 270° CLOCKWISE (or 90° COUNTER-CLOCKWISE) from the reference
- Features that were on the left in the reference are now facing you`,
  };

  return `Recreate the EXACT same building from the reference image, but viewed from the ${direction.toUpperCase()}.

${directionInstructions[direction]}

CRITICAL REQUIREMENTS:
- This MUST be the IDENTICAL building from the reference - same architecture, colors, materials, windows, doors, roof
- TOP-DOWN isometric perspective (slight 3/4 view looking down)
- Building fills the ENTIRE square image
- 3x3 tile grid structure when divided equally
- Transparent background ONLY - no ground, grass, shadows, or surroundings
- Building must be 100% opaque

DO NOT:
- Create a different building
- Change the architectural style, colors, or features
- Add or remove any elements from the building
- Add any background elements
- Add doors, bridges, or entrances that weren't visible on that side in the reference
- Duplicate features that only exist on one side of the building

IMPORTANT: Features like doors, bridges, and entrances should ONLY appear on the sides where they existed in the reference. If the reference shows a bridge on the north side, the south view should show the BACK of the building with NO bridge.`;
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
  sprite?: DirectionalBuildingSprite;
  error?: string;
  debugDir?: string;
}

/**
 * Generate a single high-fidelity building image
 * Optionally uses a reference image for style consistency (via images.edit)
 */
async function generateBuildingImage(
  openai: OpenAI,
  model: string,
  prompt: string,
  quality: 'low' | 'medium' | 'high' | 'auto',
  referencePngBuffer?: Buffer
): Promise<Buffer> {
  const common = {
    model,
    prompt,
    size: '1024x1024' as const,
    quality,
    background: 'transparent' as const,
  };

  const result = referencePngBuffer
    ? await openai.images.edit({
        ...common,
        image: await toFile(referencePngBuffer, 'ref.png', { type: 'image/png' }),
      })
    : await openai.images.generate(common);

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
 * Process a single building image into a BuildingSprite
 * Splits into 9 tiles and pixelates each to all resolutions
 */
async function processImageToSprite(
  imageBuffer: Buffer,
  debugDir: string,
  direction: BuildingDirection
): Promise<BuildingSprite> {
  const tileBuffers: Buffer[][] = [];

  // Split into 9 tiles
  for (let y = 0; y < 3; y++) {
    const row: Buffer[] = [];
    for (let x = 0; x < 3; x++) {
      const tile = await extractTile(imageBuffer, x, y);
      row.push(tile);
      fs.writeFileSync(path.join(debugDir, `tile_${direction}_${x}_${y}.png`), tile);
    }
    tileBuffers.push(row);
  }

  // Pixelate all tiles to all resolutions
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

  return {
    width: 3,
    height: 3,
    tiles,
  };
}

/**
 * Generate a building sprite using OpenAI's image generation
 *
 * Process:
 * 1. Generate north view first (no reference) - front of building
 * 2. Generate east, south, west views in parallel using north as reference
 * 3. Split each view into 9 tiles (3x3 grid)
 * 4. Pixelate each tile to all resolutions
 *
 * This approach ensures all 4 views maintain the same style and colors,
 * similar to how avatar generation works.
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

    // Save prompts for debugging
    const northPrompt = buildBuildingPromptNorth(description);
    fs.writeFileSync(path.join(debugDir, 'prompt_north.txt'), northPrompt);

    // Step 1: Generate NORTH view first (no reference - this is the base)
    progress('Generating north view (front)', 1, 5);
    const northImage = await generateBuildingImage(openai, model, northPrompt, quality);
    fs.writeFileSync(path.join(debugDir, 'building_north.png'), northImage);

    // Step 2: Generate east, south, west views IN PARALLEL using north as reference
    progress('Generating other views (using north as reference)', 2, 5);

    const eastPrompt = buildBuildingPromptDirection(description, 'east');
    const southPrompt = buildBuildingPromptDirection(description, 'south');
    const westPrompt = buildBuildingPromptDirection(description, 'west');

    fs.writeFileSync(path.join(debugDir, 'prompt_east.txt'), eastPrompt);
    fs.writeFileSync(path.join(debugDir, 'prompt_south.txt'), southPrompt);
    fs.writeFileSync(path.join(debugDir, 'prompt_west.txt'), westPrompt);

    const [eastImage, southImage, westImage] = await Promise.all([
      generateBuildingImage(openai, model, eastPrompt, quality, northImage),
      generateBuildingImage(openai, model, southPrompt, quality, northImage),
      generateBuildingImage(openai, model, westPrompt, quality, northImage),
    ]);

    // Save generated images for debugging
    fs.writeFileSync(path.join(debugDir, 'building_east.png'), eastImage);
    fs.writeFileSync(path.join(debugDir, 'building_south.png'), southImage);
    fs.writeFileSync(path.join(debugDir, 'building_west.png'), westImage);

    const buildingImages: Record<BuildingDirection, Buffer> = {
      north: northImage,
      east: eastImage,
      south: southImage,
      west: westImage,
    };

    // Step 3: Process each direction into a BuildingSprite
    progress('Processing tiles for all directions', 3, 5);
    const directionalSprite: DirectionalBuildingSprite = {
      north: await processImageToSprite(buildingImages.north, debugDir, 'north'),
      east: await processImageToSprite(buildingImages.east, debugDir, 'east'),
      south: await processImageToSprite(buildingImages.south, debugDir, 'south'),
      west: await processImageToSprite(buildingImages.west, debugDir, 'west'),
    };

    // Step 4: Save summary data for debugging (full sprite JSON is too large)
    progress('Saving sprite data', 4, 5);
    const summary = {
      directions: Object.keys(directionalSprite),
      tilesPerDirection: 9,
      resolutions: RESOLUTIONS,
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(debugDir, 'building_sprite_summary.json'), JSON.stringify(summary, null, 2));

    progress('Complete', 5, 5);
    console.log(`Building generated successfully with 4 AI-generated views. Debug files: ${debugDir}`);
    return { success: true, sprite: directionalSprite, debugDir };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Building generation failed:', message);
    return { success: false, error: message, debugDir };
  }
}

/**
 * Generate missing directions for an existing building
 * Takes a reference image (north view) and generates east/south/west views
 * Used for migrating existing buildings to support camera rotation
 */
export interface GenerateDirectionsOptions {
  referenceImage: Buffer;  // The north/front view as PNG buffer
  description: string;     // Building description for prompts
  apiKey: string;
  model?: 'dall-e-3' | 'dall-e-2' | 'gpt-image-1';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  onProgress?: (step: string, current: number, total: number) => void;
}

export interface GenerateDirectionsResult {
  success: boolean;
  images?: {
    east: Buffer;
    south: Buffer;
    west: Buffer;
  };
  error?: string;
}

/**
 * Generate east/south/west views from an existing north view
 */
export async function generateMissingDirections(
  options: GenerateDirectionsOptions
): Promise<GenerateDirectionsResult> {
  const { referenceImage, description, apiKey, model = 'gpt-image-1', quality = 'high', onProgress } = options;

  const openai = new OpenAI({ apiKey });

  const progress = (step: string, current: number, total: number) => {
    console.log(`[BUILDING MIGRATION ${current}/${total}] ${step}`);
    onProgress?.(step, current, total);
  };

  try {
    // Ensure reference is 1024x1024 for optimal AI input
    const upscaledReference = await sharp(referenceImage)
      .resize(1024, 1024, { fit: 'fill' })
      .png()
      .toBuffer();

    progress('Generating east/south/west views', 1, 2);

    const eastPrompt = buildBuildingPromptDirection(description, 'east');
    const southPrompt = buildBuildingPromptDirection(description, 'south');
    const westPrompt = buildBuildingPromptDirection(description, 'west');

    const [eastImage, southImage, westImage] = await Promise.all([
      generateBuildingImage(openai, model, eastPrompt, quality, upscaledReference),
      generateBuildingImage(openai, model, southPrompt, quality, upscaledReference),
      generateBuildingImage(openai, model, westPrompt, quality, upscaledReference),
    ]);

    progress('Complete', 2, 2);

    return {
      success: true,
      images: {
        east: eastImage,
        south: southImage,
        west: westImage,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Direction generation failed:', message);
    return { success: false, error: message };
  }
}

/**
 * Process a raw image buffer into a BuildingSprite
 * Exposed for migration use
 */
export async function processBuildingImage(
  imageBuffer: Buffer,
  debugDir?: string,
  direction: BuildingDirection = 'north'
): Promise<BuildingSprite> {
  return processImageToSprite(imageBuffer, debugDir || '/tmp', direction);
}
