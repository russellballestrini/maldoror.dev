import { generateObject } from 'ai';
import { createModel, type ProviderConfig } from './providers.js';
import { SpriteGridSchema, PixelSpriteSchema, type SpriteGrid, type PixelSprite } from './schema.js';
import { AVATAR_SYSTEM_PROMPT, PIXEL_SPRITE_SYSTEM_PROMPT, buildUserPrompt, buildPixelSpritePrompt, type Vibe } from './prompts.js';
import type { Sprite, PixelGrid, Pixel } from '@maldoror/protocol';

/**
 * Convert AI pixel format (with t flag) to protocol format (null for transparent)
 */
function convertPixel(aiPixel: { r: number; g: number; b: number; t: boolean }): Pixel {
  if (aiPixel.t) {
    return null;
  }
  return { r: aiPixel.r, g: aiPixel.g, b: aiPixel.b };
}

/**
 * Convert AI sprite format to protocol Sprite format
 */
function convertToProtocolSprite(aiSprite: PixelSprite): Sprite {
  const convertFrame = (frame: PixelSprite['frames']['down'][0]): PixelGrid => {
    return frame.map(row => row.map(convertPixel));
  };

  // AI generates 2 frames (standing, walking), we expand to 4 for protocol
  const convertFrames = (frames: PixelSprite['frames']['down']): [PixelGrid, PixelGrid, PixelGrid, PixelGrid] => {
    const standing = convertFrame(frames[0]!);
    const walking = convertFrame(frames[1]!);
    // Expand to 4-frame cycle: standing, walking, standing, walking
    return [standing, walking, standing, walking];
  };

  return {
    width: aiSprite.width,
    height: aiSprite.height,
    frames: {
      up: convertFrames(aiSprite.frames.up),
      down: convertFrames(aiSprite.frames.down),
      left: convertFrames(aiSprite.frames.left),
      right: convertFrames(aiSprite.frames.right),
    },
  };
}

/**
 * Avatar generation options
 */
export interface AvatarGenerationOptions {
  description: string;
  vibe?: Vibe;
  providerConfig: ProviderConfig;
  maxRetries?: number;
}

/**
 * Generation result
 */
export interface GenerationResult {
  success: boolean;
  sprite?: SpriteGrid;
  error?: string;
  attempts: number;
}

/**
 * Generate an avatar sprite from a description
 */
export async function generateAvatar(
  options: AvatarGenerationOptions
): Promise<GenerationResult> {
  const { description, vibe, providerConfig, maxRetries = 3 } = options;

  const model = createModel(providerConfig);
  const userPrompt = buildUserPrompt(description, vibe);

  let attempts = 0;
  let lastError: Error | null = null;

  while (attempts < maxRetries) {
    attempts++;

    try {
      const result = await generateObject({
        model,
        schema: SpriteGridSchema,
        system: AVATAR_SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.7,
      });

      // Validate the result
      const validated = SpriteGridSchema.safeParse(result.object);
      if (!validated.success) {
        lastError = new Error(`Validation failed: ${validated.error.message}`);
        continue;
      }

      return {
        success: true,
        sprite: validated.data,
        attempts,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Avatar generation attempt ${attempts} failed:`, lastError.message);
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    attempts,
  };
}

/**
 * Pixel sprite generation options
 */
export interface PixelSpriteGenerationOptions {
  description: string;
  vibe?: Vibe;
  providerConfig: ProviderConfig;
  maxRetries?: number;
}

/**
 * Pixel sprite generation result
 * Returns protocol Sprite format (with null for transparent pixels)
 */
export interface PixelSpriteGenerationResult {
  success: boolean;
  sprite?: Sprite;
  error?: string;
  attempts: number;
}

/**
 * Generate a pixel sprite from a description
 */
export async function generatePixelSprite(
  options: PixelSpriteGenerationOptions
): Promise<PixelSpriteGenerationResult> {
  const { description, vibe, providerConfig, maxRetries = 3 } = options;

  const model = createModel(providerConfig);
  const userPrompt = buildPixelSpritePrompt(description, vibe);

  let attempts = 0;
  let lastError: Error | null = null;

  while (attempts < maxRetries) {
    attempts++;

    try {
      const result = await generateObject({
        model,
        schema: PixelSpriteSchema,
        system: PIXEL_SPRITE_SYSTEM_PROMPT,
        prompt: userPrompt,
        temperature: 0.7,
      });

      // Validate the result
      const validated = PixelSpriteSchema.safeParse(result.object);
      if (!validated.success) {
        lastError = new Error(`Validation failed: ${validated.error.message}`);
        continue;
      }

      // Convert from AI format (with t flag) to protocol format (null for transparent)
      const protocolSprite = convertToProtocolSprite(validated.data);

      return {
        success: true,
        sprite: protocolSprite,
        attempts,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Pixel sprite generation attempt ${attempts} failed:`, lastError.message);
    }
  }

  return {
    success: false,
    error: lastError?.message || 'Unknown error',
    attempts,
  };
}

/**
 * Generate a simple placeholder sprite
 */
export function generatePlaceholderSprite(): SpriteGrid {
  const emptyCell = { char: ' ' };
  const bodyCell = { char: '@', fg: '#888888' };
  const headCell = { char: 'O', fg: '#AAAAAA' };

  // Create a simple humanoid shape
  const createFrame = (): SpriteGrid['frames']['down'][0] => {
    const frame: SpriteGrid['frames']['down'][0] = [];
    for (let y = 0; y < 12; y++) {
      const row = [];
      for (let x = 0; x < 7; x++) {
        // Simple humanoid shape centered
        if (y === 1 && x === 3) {
          row.push(headCell); // Head
        } else if (y === 2 && x === 3) {
          row.push({ char: '|', fg: '#888888' }); // Neck
        } else if (y >= 3 && y <= 6 && x >= 2 && x <= 4) {
          row.push(bodyCell); // Body
        } else if (y >= 7 && y <= 10 && (x === 2 || x === 4)) {
          row.push({ char: '|', fg: '#666666' }); // Legs
        } else {
          row.push(emptyCell);
        }
      }
      frame.push(row);
    }
    return frame;
  };

  const frame = createFrame();

  return {
    width: 7,
    height: 12,
    frames: {
      up: [frame, frame, frame, frame],
      down: [frame, frame, frame, frame],
      left: [frame, frame, frame, frame],
      right: [frame, frame, frame, frame],
    },
  };
}
