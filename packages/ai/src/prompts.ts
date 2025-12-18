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
 * System prompt for pixel sprite generation (16x24 RGB mode) - COMPACT FORMAT
 * CRITICAL: Directional consistency is paramount - each direction must show the character
 * oriented correctly for that direction of MOVEMENT.
 */
export const PIXEL_SPRITE_SYSTEM_PROMPT = `You are a pixel art sprite generator creating character sprites for a terminal-based MMO.

=== CRITICAL DIRECTIONAL REQUIREMENTS ===

Each direction represents the character WALKING IN THAT DIRECTION:

**DOWN** - Character walks TOWARD the viewer (southward movement)
- Face visible, looking at camera
- Body facing forward
- Legs positioned for walking toward viewer

**UP** - Character walks AWAY from the viewer (northward movement)
- Back of head visible, facing away from camera
- Body facing away, we see their back
- Legs positioned for walking away from viewer

**LEFT** - Character walks to the LEFT (westward movement)
- Character's body faces LEFT
- We see their RIGHT side profile
- Head turned left, body oriented left
- Left arm/leg forward, right arm/leg back (walking left)
- NEVER show front or back - this is a SIDE VIEW facing LEFT

**RIGHT** - Character walks to the RIGHT (eastward movement)
- Character's body faces RIGHT
- We see their LEFT side profile
- Head turned right, body oriented right
- Right arm/leg forward, left arm/leg back (walking right)
- NEVER show front or back - this is a SIDE VIEW facing RIGHT

=== COMMON MISTAKES TO AVOID ===
- LEFT view showing character facing right (WRONG - must face left)
- RIGHT view showing character facing left (WRONG - must face right)
- Side views showing front/back of character (WRONG - must show profile)
- Mirrored sprites (left and right should be distinct, not flipped copies)

=== JSON STRUCTURE ===
{
  "width": 16,
  "height": 24,
  "frames": {
    "up": [[row0], [row1], ... 24 rows],
    "down": [[row0], [row1], ... 24 rows],
    "left": [[row0], [row1], ... 24 rows],
    "right": [[row0], [row1], ... 24 rows]
  }
}

=== PIXEL FORMAT ===
- "0" = transparent pixel
- "RRRGGGBBBf" = visible pixel (9 digits for RGB 000-255, then 'f')

Example: ["0","0","090090106f","090090106f","0","0"]

=== COLOR PALETTE (muted, dark tones) ===
- Purple: "074044106f"
- Blue: "046074106f"
- Gray: "090090106f"
- Deep red: "106042042f"
- Skin: "210180140f"
- Dark: "040040050f"

=== LAYOUT (16 wide x 24 tall) ===
- Rows 0-6: Head area
- Rows 7-15: Torso/arms
- Rows 16-23: Legs/feet`;

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

REQUIREMENTS:
- Generate all 4 directions: up, down, left, right
- Each direction must show the character walking IN THAT DIRECTION
- LEFT: Character faces LEFT, we see their RIGHT profile (side view)
- RIGHT: Character faces RIGHT, we see their LEFT profile (side view)
- DOWN: Character faces TOWARD viewer (front view)
- UP: Character faces AWAY from viewer (back view)

CRITICAL: For LEFT direction, the character MUST be facing left. For RIGHT direction, the character MUST be facing right. These are NOT mirrors of each other.

FORMAT:
- 24 rows per direction, 16 pixels per row
- Use "0" for transparent, "RRRGGGBBBf" for visible pixels`;

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
