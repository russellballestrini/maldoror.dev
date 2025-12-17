import OpenAI, { toFile } from 'openai';
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import type { Sprite, PixelGrid, Pixel } from '@maldoror/protocol';

const SPRITE_WIDTH = 16;
const SPRITE_HEIGHT = 24;
const DEBUG_DIR = 'debug-sprites';


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
 * Build the system prompt for sprite generation
 */
function buildImagePrompt(description: string): string {
  return `Create a pixel-art character sprite for a top-down RPG game.

CRITICAL REQUIREMENTS:
- The character MUST fill the ENTIRE image from edge to edge
- The character's head should touch the TOP edge of the image
- The character's feet should touch the BOTTOM edge of the image
- NO empty space, NO margins, NO padding around the character
- The character must be 100% OPAQUE and SOLID - no transparency in the character itself
- Only the background should be transparent
- Strong, saturated colors with clear pixel boundaries
- Clean pixel art style, not blurry or anti-aliased

DO NOT:
- Leave any empty space around the character
- Make the character semi-transparent or ghostly
- Add any background elements
- Add text, UI, or borders

${description}`;
}

/**
 * Convert PixelGrid back to PNG buffer for debug output
 */
async function pixelGridToPng(grid: PixelGrid, width: number, height: number): Promise<Buffer> {
  const data = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pixel = grid[y]?.[x];
      const idx = (y * width + x) * 4;
      if (pixel === null || pixel === undefined) {
        data[idx] = 0;
        data[idx + 1] = 0;
        data[idx + 2] = 0;
        data[idx + 3] = 0; // transparent
      } else {
        data[idx] = pixel.r;
        data[idx + 1] = pixel.g;
        data[idx + 2] = pixel.b;
        data[idx + 3] = 255;
      }
    }
  }

  return sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

export interface ImageSpriteGenerationOptions {
  description: string;
  apiKey: string;
  model?: 'dall-e-3' | 'dall-e-2' | 'gpt-image-1';
  username?: string; // for debug folder naming
  onProgress?: (step: string, current: number, total: number) => void;
}

export interface ImageSpriteGenerationResult {
  success: boolean;
  sprite?: Sprite;
  error?: string;
}

/**
 * Generate a single image with optional reference
 * Uses images.edit() when reference is provided for image-to-image generation
 */
async function generateSingleImage(
  openai: OpenAI,
  model: string,
  prompt: string,
  referencePngBuffer?: Buffer
): Promise<Buffer> {
  const common = {
    model,
    prompt,
    size: '1024x1024' as const,
    background: 'transparent' as const,
  };

  const result = referencePngBuffer
    ? await openai.images.edit({
        ...common,
        // image-to-image / reference must use edits endpoint
        image: await toFile(referencePngBuffer, 'ref.png', { type: 'image/png' }),
      })
    : await openai.images.generate(common);

  const b64 = result.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error('No image base64 data returned');
  }

  return Buffer.from(b64, 'base64');
}

/**
 * Resize image buffer to sprite size and convert to PixelGrid
 * Trims transparent edges first to maximize character detail in final sprite
 */
async function imageToSpriteFrame(imageBuffer: Buffer): Promise<PixelGrid> {
  // First, trim transparent edges to get just the character
  const trimmed = await sharp(imageBuffer)
    .trim({ threshold: 10 }) // Remove near-transparent edges
    .toBuffer();

  // Then resize to fill the sprite dimensions
  const raw = await sharp(trimmed)
    .resize(SPRITE_WIDTH, SPRITE_HEIGHT, {
      fit: 'fill', // Stretch to fill entire sprite area
      kernel: 'nearest', // Keep pixel art crisp
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return imageToPixelGrid(raw.data, raw.info.width, raw.info.height);
}

/**
 * Generate a sprite using OpenAI's image generation
 * Generates 8 frames: 4 directions × (standing + walking)
 * Uses reference images for consistency across directions
 */
export async function generateImageSprite(
  options: ImageSpriteGenerationOptions
): Promise<ImageSpriteGenerationResult> {
  const { description, apiKey, model = 'gpt-image-1', username = 'unknown', onProgress } = options;

  const openai = new OpenAI({ apiKey });
  const debugImages: Map<string, Buffer> = new Map();

  const progress = (step: string, current: number, total: number) => {
    console.log(`[${current}/${total}] ${step}`);
    onProgress?.(step, current, total);
  };

  try {
    const basePrompt = buildImagePrompt(description);

    // Reference prompt additions for consistency
    const refNote = `\nIMPORTANT: Match the EXACT same character from the reference image. Keep the character 100% SOLID and OPAQUE. Fill the entire canvas edge-to-edge.`;

    // Step 1: Generate front/down standing (no reference - first image)
    progress('Generating front view (standing)', 1, 8);
    const downStandingPrompt = `${basePrompt}\nFacing forward toward the viewer. Standing pose, arms at sides.`;
    const downStandingBuffer = await generateSingleImage(openai, model, downStandingPrompt);
    debugImages.set('1_down_standing', downStandingBuffer);

    // Step 2: Generate back/up standing (with reference)
    progress('Generating back view (standing)', 2, 8);
    const upStandingPrompt = `${basePrompt}\nFacing AWAY from viewer, showing the character's BACK. Standing pose.${refNote}`;
    const upStandingBuffer = await generateSingleImage(openai, model, upStandingPrompt, downStandingBuffer);
    debugImages.set('2_up_standing', upStandingBuffer);

    // Step 3: Generate left standing (with reference)
    progress('Generating left view (standing)', 3, 8);
    const leftStandingPrompt = `${basePrompt}\nSide profile view, character facing LEFT. Standing pose.${refNote}`;
    const leftStandingBuffer = await generateSingleImage(openai, model, leftStandingPrompt, downStandingBuffer);
    debugImages.set('3_left_standing', leftStandingBuffer);

    // Step 4: Generate right standing (with reference)
    progress('Generating right view (standing)', 4, 8);
    const rightStandingPrompt = `${basePrompt}\nSide profile view, character facing RIGHT. Standing pose.${refNote}`;
    const rightStandingBuffer = await generateSingleImage(openai, model, rightStandingPrompt, downStandingBuffer);
    debugImages.set('4_right_standing', rightStandingBuffer);

    // Step 5: Generate front/down walking
    progress('Generating front view (walking)', 5, 8);
    const downWalkingPrompt = `${basePrompt}\nFacing forward toward the viewer. Walking pose with one leg forward mid-stride.${refNote}`;
    const downWalkingBuffer = await generateSingleImage(openai, model, downWalkingPrompt, downStandingBuffer);
    debugImages.set('5_down_walking', downWalkingBuffer);

    // Step 6: Generate back/up walking
    progress('Generating back view (walking)', 6, 8);
    const upWalkingPrompt = `${basePrompt}\nFacing AWAY from viewer, showing the character's BACK. Walking pose mid-stride.${refNote}`;
    const upWalkingBuffer = await generateSingleImage(openai, model, upWalkingPrompt, downStandingBuffer);
    debugImages.set('6_up_walking', upWalkingBuffer);

    // Step 7: Generate left walking
    progress('Generating left view (walking)', 7, 8);
    const leftWalkingPrompt = `${basePrompt}\nSide profile view, character facing LEFT. Walking pose mid-stride.${refNote}`;
    const leftWalkingBuffer = await generateSingleImage(openai, model, leftWalkingPrompt, downStandingBuffer);
    debugImages.set('7_left_walking', leftWalkingBuffer);

    // Step 8: Generate right walking
    progress('Generating right view (walking)', 8, 8);
    const rightWalkingPrompt = `${basePrompt}\nSide profile view, character facing RIGHT. Walking pose mid-stride.${refNote}`;
    const rightWalkingBuffer = await generateSingleImage(openai, model, rightWalkingPrompt, downStandingBuffer);
    debugImages.set('8_right_walking', rightWalkingBuffer);

    // Convert all to PixelGrids
    progress('Processing images', 8, 8);
    const downStanding = await imageToSpriteFrame(downStandingBuffer);
    const upStanding = await imageToSpriteFrame(upStandingBuffer);
    const leftStanding = await imageToSpriteFrame(leftStandingBuffer);
    const rightStanding = await imageToSpriteFrame(rightStandingBuffer);
    const downWalking = await imageToSpriteFrame(downWalkingBuffer);
    const upWalking = await imageToSpriteFrame(upWalkingBuffer);
    const leftWalking = await imageToSpriteFrame(leftWalkingBuffer);
    const rightWalking = await imageToSpriteFrame(rightWalkingBuffer);

    // Build sprite with animation frames:
    // Frame pattern: [standing, walk1, standing, walk2] for smooth animation
    const sprite: Sprite = {
      width: SPRITE_WIDTH,
      height: SPRITE_HEIGHT,
      frames: {
        down: [downStanding, downWalking, downStanding, downWalking],
        up: [upStanding, upWalking, upStanding, upWalking],
        left: [leftStanding, leftWalking, leftStanding, leftWalking],
        right: [rightStanding, rightWalking, rightStanding, rightWalking],
      },
    };

    // Save debug files
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeUsername = username.replace(/[^a-zA-Z0-9]/g, '_');
    const debugDir = path.join(DEBUG_DIR, `${timestamp}_${safeUsername}`);

    try {
      fs.mkdirSync(debugDir, { recursive: true });

      // Save prompt
      fs.writeFileSync(path.join(debugDir, 'prompt.txt'), basePrompt);

      // Save all generated images
      for (const [name, buffer] of debugImages) {
        fs.writeFileSync(path.join(debugDir, `${name}_original.png`), buffer);

        // Also save resized version
        const frame = await imageToSpriteFrame(buffer);
        const smallPng = await pixelGridToPng(frame, SPRITE_WIDTH, SPRITE_HEIGHT);
        fs.writeFileSync(path.join(debugDir, `${name}_16x24.png`), smallPng);

        // Save scaled version
        const scaledPng = await sharp(smallPng)
          .resize(SPRITE_WIDTH * 10, SPRITE_HEIGHT * 10, { kernel: 'nearest' })
          .png()
          .toBuffer();
        fs.writeFileSync(path.join(debugDir, `${name}_scaled.png`), scaledPng);
      }

      // Save sprite JSON
      fs.writeFileSync(path.join(debugDir, 'sprite.json'), JSON.stringify(sprite, null, 2));

      console.log(`Debug files saved to: ${debugDir}`);
    } catch (debugError) {
      console.error('Failed to save debug files:', debugError);
    }

    console.log('Sprite generated successfully (8 frames)');
    return { success: true, sprite };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Image sprite generation failed:', message);
    return { success: false, error: message };
  }
}

/**
 * Quantize colors in a pixel grid to a limited palette
 * This makes sprites look more consistent and "pixel art" like
 */
export function quantizePixelGrid(
  grid: PixelGrid,
  maxColors: number = 16
): PixelGrid {
  // Collect all non-transparent colors
  const colors: Array<{ r: number; g: number; b: number }> = [];
  for (const row of grid) {
    for (const pixel of row) {
      if (pixel !== null) {
        colors.push(pixel);
      }
    }
  }

  if (colors.length === 0) return grid;

  // Simple quantization: round to nearest multiple
  const step = Math.ceil(256 / Math.cbrt(maxColors));

  return grid.map(row =>
    row.map(pixel => {
      if (pixel === null) return null;
      return {
        r: Math.round(pixel.r / step) * step,
        g: Math.round(pixel.g / step) * step,
        b: Math.round(pixel.b / step) * step,
      };
    })
  );
}
