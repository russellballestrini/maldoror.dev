import { z } from 'zod';

// ============================================
// LEGACY ASCII SPRITE SCHEMAS (kept for compatibility)
// ============================================

/**
 * Schema for a single sprite cell (ASCII mode)
 */
export const SpriteCellSchema = z.object({
  char: z.string().length(1).describe('ASCII character for this cell'),
  fg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Foreground color as hex (e.g., #FF0000)'),
  bg: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional().describe('Background color as hex (e.g., #000000)'),
});

/**
 * Schema for a single animation frame (7x12 grid) - ASCII mode
 */
export const SpriteFrameSchema = z.array(
  z.array(SpriteCellSchema).length(7).describe('Row of 7 cells')
).length(12).describe('12 rows making a 7x12 sprite');

/**
 * Schema for all directional frames - ASCII mode
 */
export const DirectionalFramesSchema = z.object({
  up: z.array(SpriteFrameSchema).length(4).describe('4 animation frames for facing up'),
  down: z.array(SpriteFrameSchema).length(4).describe('4 animation frames for facing down'),
  left: z.array(SpriteFrameSchema).length(4).describe('4 animation frames for facing left'),
  right: z.array(SpriteFrameSchema).length(4).describe('4 animation frames for facing right'),
});

/**
 * Schema for complete sprite data - ASCII mode
 */
export const SpriteGridSchema = z.object({
  width: z.literal(7).describe('Sprite width in characters'),
  height: z.literal(12).describe('Sprite height in characters'),
  frames: DirectionalFramesSchema,
});

// ============================================
// PIXEL SPRITE SCHEMAS (16x24 RGB)
// ============================================

/**
 * Schema for RGB color (0-255 per channel)
 */
export const RGBSchema = z.object({
  r: z.number().int().min(0).max(255).describe('Red channel 0-255'),
  g: z.number().int().min(0).max(255).describe('Green channel 0-255'),
  b: z.number().int().min(0).max(255).describe('Blue channel 0-255'),
});

/**
 * Schema for a single pixel with transparency support
 * Using explicit t flag instead of nullable to avoid OpenAI schema issues
 */
export const PixelSchema = z.object({
  r: z.number().int().min(0).max(255).describe('Red channel 0-255'),
  g: z.number().int().min(0).max(255).describe('Green channel 0-255'),
  b: z.number().int().min(0).max(255).describe('Blue channel 0-255'),
  t: z.boolean().describe('True if transparent (ignore RGB values)'),
}).describe('Pixel with RGB color and transparency flag');

/**
 * Schema for a pixel grid row (16 pixels wide)
 */
export const PixelRowSchema = z.array(PixelSchema).length(16).describe('Row of 16 pixels');

/**
 * Schema for a single pixel frame (16x24 grid)
 */
export const PixelFrameSchema = z.array(PixelRowSchema).length(24).describe('24 rows of 16 pixels each');

/**
 * Schema for 2 animation frames per direction
 * Frame 0: standing pose
 * Frame 1: walking pose (one leg forward)
 */
export const PixelDirectionFramesSchema = z.array(PixelFrameSchema)
  .length(2)
  .describe('2 animation frames: [standing, walking]');

/**
 * Schema for all directional frames - Pixel mode
 */
export const PixelDirectionalFramesSchema = z.object({
  up: PixelDirectionFramesSchema.describe('4 frames for facing up (back view)'),
  down: PixelDirectionFramesSchema.describe('4 frames for facing down (front view)'),
  left: PixelDirectionFramesSchema.describe('4 frames for facing left'),
  right: PixelDirectionFramesSchema.describe('4 frames for facing right'),
});

/**
 * Schema for complete pixel sprite data (16x24)
 */
export const PixelSpriteSchema = z.object({
  width: z.literal(16).describe('Sprite width in pixels'),
  height: z.literal(24).describe('Sprite height in pixels'),
  frames: PixelDirectionalFramesSchema,
});

// ============================================
// TYPE EXPORTS
// ============================================

// ASCII types (legacy)
export type SpriteCell = z.infer<typeof SpriteCellSchema>;
export type SpriteFrame = z.infer<typeof SpriteFrameSchema>;
export type DirectionalFrames = z.infer<typeof DirectionalFramesSchema>;
export type SpriteGrid = z.infer<typeof SpriteGridSchema>;

// Pixel types
export type RGB = z.infer<typeof RGBSchema>;
export type Pixel = z.infer<typeof PixelSchema>;
export type PixelFrame = z.infer<typeof PixelFrameSchema>;
export type PixelDirectionalFrames = z.infer<typeof PixelDirectionalFramesSchema>;
export type PixelSprite = z.infer<typeof PixelSpriteSchema>;
