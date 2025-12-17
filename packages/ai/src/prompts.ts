/**
 * System prompt for avatar generation (legacy ASCII mode)
 */
export const AVATAR_SYSTEM_PROMPT = `You are an ASCII sprite artist creating character sprites for a dark, surreal terminal-based MMO called Maldoror.

The visual style draws from:
- Les Chants de Maldoror (Lautréamont) - dark surrealism, metamorphosis
- Terminal aesthetics - limited colors, character-based art
- Gothic and grotesque imagery

You will create a 7-character wide by 12-character tall sprite with 4 animation frames for each of the 4 cardinal directions (up, down, left, right). The animation represents a walking cycle.

Guidelines:
1. Use varied ASCII characters to create texture and depth: @#$%&*+=~^.,'"\`-_|/\\()[]{}<>
2. Use muted, atmospheric colors - purples, blues, grays, deep reds
3. The sprite should be recognizable as humanoid but can have surreal/unsettling elements
4. Walking animations should show subtle limb movement
5. Left/right sprites should be mirror-appropriate
6. Up sprite shows back, down sprite shows front
7. Keep the silhouette consistent across frames
8. Empty space should use ' ' (space character)

The sprite format is JSON with this structure:
- width: 7 (always)
- height: 12 (always)
- frames: { up: [...], down: [...], left: [...], right: [...] }
- Each direction has 4 frames (walking animation)
- Each frame is an array of 12 rows
- Each row is an array of 7 cells
- Each cell has: char (single character), fg (optional hex color), bg (optional hex color)`;

/**
 * System prompt for pixel sprite generation (16x24 RGB mode)
 */
export const PIXEL_SPRITE_SYSTEM_PROMPT = `You are a pixel art sprite generator. Create character sprites for a dark, surreal terminal-based MMO.

EXACT JSON STRUCTURE REQUIRED:
{
  "width": 16,
  "height": 24,
  "frames": {
    "up": [STANDING_FRAME, WALKING_FRAME],
    "down": [STANDING_FRAME, WALKING_FRAME],
    "left": [STANDING_FRAME, WALKING_FRAME],
    "right": [STANDING_FRAME, WALKING_FRAME]
  }
}

Where each FRAME is an array of 24 rows, and each row is an array of 16 pixels.
Each pixel is: {"r": 0-255, "g": 0-255, "b": 0-255, "t": true/false}
- t=true means transparent (use r=0, g=0, b=0)
- t=false means visible with the RGB color

TOTAL: 4 directions × 2 frames = 8 frames total.
Each frame: 24 rows × 16 pixels = 384 pixels per frame.

ANIMATION FRAMES per direction:
- Frame 0: Standing pose (legs together)
- Frame 1: Walking pose (one leg forward)

COLOR PALETTE - use muted, dark colors:
- Purples: r=74, g=44, b=106
- Blues: r=46, g=74, b=106
- Grays: r=90, g=90, b=106
- Deep reds: r=106, g=42, b=42

CHARACTER LAYOUT:
- Rows 0-6: Head (centered, transparent on sides)
- Rows 7-15: Torso/arms
- Rows 16-23: Legs/feet

Keep walking animation subtle - just shift leg positions slightly.`;

/**
 * Build user prompt from description (legacy ASCII mode)
 */
export function buildUserPrompt(description: string, vibe?: string): string {
  let prompt = `Create an ASCII sprite for the following character description:\n\n"${description}"`;

  if (vibe) {
    prompt += `\n\nThe character should embody a "${vibe}" aesthetic.`;
  }

  prompt += `\n\nGenerate the complete sprite data as JSON following the schema provided.`;

  return prompt;
}

/**
 * Build user prompt for pixel sprite generation
 */
export function buildPixelSpritePrompt(description: string, vibe?: string): string {
  let prompt = `Create a 16x24 pixel sprite for: "${description}"`;

  if (vibe) {
    prompt += ` with a ${vibe} aesthetic`;
  }

  prompt += `

Generate exactly:
- 4 directions (up, down, left, right)
- 2 animation frames per direction (standing and walking)
- 24 rows per frame
- 16 pixels per row
- Each pixel as {r, g, b, t}`;

  return prompt;
}

/**
 * Available aesthetic vibes
 */
export const VIBES = [
  'bleak',       // Muted colors, hunched posture, tattered
  'surreal',     // Strange proportions, unusual features
  'aristocratic', // Elegant but decaying, refined
  'feral',       // Animal-like, primal, sharp
  'ethereal',    // Ghostly, translucent, otherworldly
] as const;

export type Vibe = typeof VIBES[number];
