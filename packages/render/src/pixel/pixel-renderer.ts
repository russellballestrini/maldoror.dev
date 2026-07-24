import type { RGB, Pixel, PixelGrid } from '@maldoror/protocol';
import { sgrCode, sgrPairKey } from './ansi-cache.js';
import { OCTANT_CHARS } from './octant-chars.js';
import { fitOctant } from './octant-fitter.js';
import { PALETTE, PHASES } from './palette-cycle.js';

/**
 * ANSI escape codes for pixel rendering
 */
const ESC = '\x1b';
const RESET = `${ESC}[0m`;

/**
 * Half-block character for high-resolution rendering
 * ▀ = upper half block - foreground color on top, background color on bottom
 */
const HALF_BLOCK_TOP = '▀';

/**
 * Braille character base (U+2800) for ultra-high-resolution rendering
 * Each Braille char is 2×4 dots = 8 subpixels per character
 * Dot positions and their bit values:
 *   1 (0x01)  4 (0x08)
 *   2 (0x02)  5 (0x10)
 *   3 (0x04)  6 (0x20)
 *   7 (0x40)  8 (0x80)
 */
const BRAILLE_BASE = 0x2800;
const BRAILLE_DOTS = [
  [0x01, 0x08],  // Row 0: dots 1, 4
  [0x02, 0x10],  // Row 1: dots 2, 5
  [0x04, 0x20],  // Row 2: dots 3, 6
  [0x40, 0x80],  // Row 3: dots 7, 8
];

/**
 * Generate ANSI background color code for RGB
 */
export function bgColor(color: RGB): string {
  return `${ESC}[48;2;${color.r};${color.g};${color.b}m`;
}

/**
 * Generate ANSI foreground color code for RGB
 */
export function fgColor(color: RGB): string {
  return `${ESC}[38;2;${color.r};${color.g};${color.b}m`;
}

/**
 * A single "pixel" in terminal = 2 spaces with background color
 * This creates a roughly square appearance since terminal chars are ~2:1 height:width
 */
const PIXEL_CHARS = '  ';

// ============================================
// Cell-Level Diffing Types
// ============================================

/**
 * A terminal cell for cell-level diffing
 * Stores structured data instead of ANSI strings
 */
export interface TerminalCell {
  char: string;           // ' ', '  ', '▀', or braille char
  fgColor: RGB | null;    // Foreground color (for halfblock/braille)
  bgColor: RGB | null;    // Background color
  fgIndex?: number | null; // Optional OSC-4/256-color palette slot
  bgIndex?: number | null;
}

/**
 * Grid of terminal cells for diffing
 */
export type CellGrid = TerminalCell[][];

/**
 * A 2D grid of brightness values for cell-level lighting
 * Each value represents brightness for a single terminal cell (0.7-1.2 typical)
 */
export type BrightnessGrid = number[][];

/**
 * Check if two colors are equal
 */
export function colorsEqual(a: RGB | null, b: RGB | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

/**
 * Check if two terminal cells are equal
 */
export function cellsEqual(a: TerminalCell, b: TerminalCell | undefined): boolean {
  if (!b) return false;
  return a.char === b.char &&
         colorsEqual(a.fgColor, b.fgColor) &&
         colorsEqual(a.bgColor, b.bgColor) &&
         (a.fgIndex ?? null) === (b.fgIndex ?? null) &&
         (a.bgIndex ?? null) === (b.bgIndex ?? null);
}

/**
 * Render a single pixel as a 2-character colored block
 */
export function renderPixel(pixel: Pixel): string {
  if (pixel === null) {
    return RESET + PIXEL_CHARS;
  }
  return bgColor(pixel) + PIXEL_CHARS;
}

/**
 * Render a row of pixels as a string (2 chars per pixel)
 */
export function renderPixelRow(pixels: Pixel[]): string {
  let output = '';
  let lastColor: RGB | null = null;

  for (const pixel of pixels) {
    if (pixel === null) {
      if (lastColor !== null) {
        output += RESET;
        lastColor = null;
      }
      output += PIXEL_CHARS;
    } else {
      // Optimization: only emit color code if different from last
      if (lastColor === null ||
          lastColor.r !== pixel.r ||
          lastColor.g !== pixel.g ||
          lastColor.b !== pixel.b) {
        output += bgColor(pixel);
        lastColor = pixel;
      }
      output += PIXEL_CHARS;
    }
  }

  output += RESET;
  return output;
}

/**
 * Default background color for transparent pixels in half-block mode
 */
const DEFAULT_BG: RGB = { r: 20, g: 20, b: 25 };

/**
 * Render two pixel rows as one terminal row using half-block characters
 * Each character shows 2 vertical pixels (1 char width = 1 pixel width)
 * Top pixel in foreground, bottom pixel in background
 */
export function renderHalfBlockRow(topRow: Pixel[], bottomRow: Pixel[]): string {
  let output = '';
  let lastFg: RGB | null = null;
  let lastBg: RGB | null = null;

  const len = Math.max(topRow.length, bottomRow.length);

  for (let i = 0; i < len; i++) {
    const topPixel = topRow[i] ?? null;
    const bottomPixel = bottomRow[i] ?? null;

    // Use default background for null pixels
    const fg = topPixel ?? DEFAULT_BG;
    const bg = bottomPixel ?? DEFAULT_BG;

    const fgChanged = lastFg === null || lastFg.r !== fg.r || lastFg.g !== fg.g || lastFg.b !== fg.b;
    const bgChanged = lastBg === null || lastBg.r !== bg.r || lastBg.g !== bg.g || lastBg.b !== bg.b;

    // Emit color change as ONE merged SGR when both change (saves ~5 bytes
    // per boundary), single cached code otherwise. This is the hot emitter
    // for the production (renderToString) halfblock path.
    if (fgChanged || bgChanged) {
      output += sgrCode(fgChanged ? fg : null, bgChanged ? bg : null);
      if (fgChanged) lastFg = fg;
      if (bgChanged) lastBg = bg;
    }

    output += HALF_BLOCK_TOP;
  }

  output += RESET;
  return output;
}

/**
 * Render a pixel grid using half-block characters (high resolution mode)
 * Returns array of terminal rows, each representing 2 pixel rows
 */
export function renderHalfBlockGrid(grid: PixelGrid): string[] {
  const result: string[] = [];

  for (let y = 0; y < grid.length; y += 2) {
    const topRow = grid[y] ?? [];
    const bottomRow = grid[y + 1] ?? [];
    result.push(renderHalfBlockRow(topRow, bottomRow));
  }

  return result;
}

/**
 * Calculate brightness of a pixel (0-255)
 */
function pixelBrightness(pixel: Pixel): number {
  if (!pixel) return 0;
  // Perceptual luminance formula
  return Math.round(0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b);
}

/**
 * Apply brightness multiplier to an RGB color
 * Clamps result to [0, 255] range
 */
function applyBrightness(color: RGB, brightness: number): RGB {
  return {
    r: Math.min(255, Math.max(0, Math.round(color.r * brightness))),
    g: Math.min(255, Math.max(0, Math.round(color.g * brightness))),
    b: Math.min(255, Math.max(0, Math.round(color.b * brightness))),
  };
}

// Scratch buffer for renderBrailleChar (single-threaded; avoids 8 object
// allocations + a sort per cell per frame — the old implementation was the
// hottest allocation site in braille mode).
const BR_SCRATCH = new Int16Array(8);

/**
 * Render a 2x4 pixel block as a single Braille character
 * Returns the character and the foreground/background colors to use
 *
 * Allocation-free. Threshold = (min+max)/2 contrast split rather than the
 * old median split: the median forced ~half the dots on even in flat areas,
 * producing dot-noise on solid terrain. Flat cells (low brightness range)
 * are rendered as a SOLID full-dot cell with fg=bg=average — smooth fills
 * instead of speckle.
 *
 * @param block - 4 rows × 2 cols of pixels
 * @param cellBrightness - Optional brightness multiplier (0.7-1.2 typical, default 1.0)
 */
function renderBrailleChar(
  block: Pixel[][],  // 4 rows × 2 cols
  cellBrightness: number = 1.0
): { char: string; fg: RGB; bg: RGB } {
  // Pass 1: brightness per dot; track min/max over non-null pixels
  let minB = 999, maxB = -1;
  for (let row = 0; row < 4; row++) {
    const r = block[row];
    for (let col = 0; col < 2; col++) {
      const pixel = r?.[col] ?? null;
      const b = pixel === null ? -1 : pixelBrightness(pixel);
      BR_SCRATCH[row * 2 + col] = b;
      if (b >= 0) {
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;
      }
    }
  }

  // All-transparent cell: default background, no dots
  if (maxB < 0) {
    let c: RGB = DEFAULT_BG;
    if (cellBrightness !== 1.0) c = applyBrightness(c, cellBrightness);
    return { char: String.fromCharCode(BRAILLE_BASE), fg: c, bg: c };
  }

  // Flat cell (low contrast): render solid — all dots on, fg=bg=average.
  // Avoids dot-noise on uniform terrain and compresses better (identical
  // neighbouring cells dedupe in the diff/CRLE layers).
  if (maxB - minB <= 10) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let row = 0; row < 4; row++) {
      const r = block[row];
      for (let col = 0; col < 2; col++) {
        const pixel = r?.[col] ?? null;
        if (pixel !== null) { sr += pixel.r; sg += pixel.g; sb += pixel.b; n++; }
      }
    }
    let avg: RGB = { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
    if (cellBrightness !== 1.0) avg = applyBrightness(avg, cellBrightness);
    return { char: String.fromCharCode(BRAILLE_BASE + 0xFF), fg: avg, bg: avg };
  }

  // Contrast split at the midpoint of the brightness range
  const threshold = (minB + maxB) / 2;

  // Pass 2: build dot code + accumulate color sums for fg (on) / bg (off)
  let brailleCode = 0;
  let fr = 0, fgG = 0, fb = 0, fn = 0;
  let br = 0, bgG = 0, bb = 0, bn = 0;
  for (let row = 0; row < 4; row++) {
    const r = block[row];
    for (let col = 0; col < 2; col++) {
      const pixel = r?.[col] ?? null;
      const b = BR_SCRATCH[row * 2 + col]!;
      if (pixel !== null && b >= threshold) {
        brailleCode |= BRAILLE_DOTS[row]![col]!;
        fr += pixel.r; fgG += pixel.g; fb += pixel.b; fn++;
      } else if (pixel !== null) {
        br += pixel.r; bgG += pixel.g; bb += pixel.b; bn++;
      }
    }
  }

  let fg: RGB = fn > 0
    ? { r: Math.round(fr / fn), g: Math.round(fgG / fn), b: Math.round(fb / fn) }
    : DEFAULT_BG;
  let bg: RGB = bn > 0
    ? { r: Math.round(br / bn), g: Math.round(bgG / bn), b: Math.round(bb / bn) }
    : DEFAULT_BG;

  if (cellBrightness !== 1.0) {
    fg = applyBrightness(fg, cellBrightness);
    bg = applyBrightness(bg, cellBrightness);
  }

  return { char: String.fromCharCode(BRAILLE_BASE + brailleCode), fg, bg };
}

// Scratch for renderOctantChar (single-threaded).
const OCT_SCRATCH = new Int16Array(8);
const OCT_PIXEL_SCRATCH: Pixel[] = new Array<Pixel>(8).fill(null);

/**
 * Render a 2×4 pixel block as a single Unicode OCTANT character (Unicode 16
 * Symbols for Legacy Computing Supplement). Same resolution as braille (8
 * subpixels) but SOLID mosaics instead of dots — reads far closer to real
 * pixels. Ghostty/kitty/VTE draw these with built-in routines that connect
 * across cell boundaries.
 *
 * Identical two-color model to renderBrailleChar (contrast split → fg/bg),
 * only the glyph differs: pattern bit for (row r, col c) = 1 << (r*2 + c),
 * looked up in OCTANT_CHARS.
 */
function renderOctantChar(
  block: Pixel[][],
  cellBrightness: number = 1.0
): { char: string; fg: RGB; bg: RGB } {
  let minB = 999, maxB = -1;
  let minCo = 999, maxCo = -999, minCg = 999, maxCg = -999;
  for (let row = 0; row < 4; row++) {
    const r = block[row];
    for (let col = 0; col < 2; col++) {
      const pixel = r?.[col] ?? null;
      OCT_PIXEL_SCRATCH[row * 2 + col] = pixel;
      const b = pixel === null ? -1 : pixelBrightness(pixel);
      OCT_SCRATCH[row * 2 + col] = b;
      if (b >= 0) {
        if (b < minB) minB = b;
        if (b > maxB) maxB = b;
        const co = pixel!.r - pixel!.b;
        const cg = pixel!.g - (pixel!.r + pixel!.b) / 2;
        if (co < minCo) minCo = co;
        if (co > maxCo) maxCo = co;
        if (cg < minCg) minCg = cg;
        if (cg > maxCg) maxCg = cg;
      }
    }
  }

  // All-transparent → empty cell
  if (maxB < 0) {
    let c: RGB = DEFAULT_BG;
    if (cellBrightness !== 1.0) c = applyBrightness(c, cellBrightness);
    return { char: OCTANT_CHARS[0]!, fg: c, bg: c };
  }

  // A luminance-only split can collapse strongly different hues that happen
  // to share brightness into one muddy solid cell. Pay the Oklab clustering
  // cost only for that bounded ambiguity band; ordinary terrain stays on the
  // fast production path. This gate was selected by the fixed 160x46 fitting
  // lab, not tuned against names or asset-specific colours.
  const chromaSpan = Math.max(maxCo - minCo, maxCg - minCg);
  if (maxB - minB <= 20 && chromaSpan >= 30) {
    const fit = fitOctant(OCT_PIXEL_SCRATCH, 'oklab-kmeans', DEFAULT_BG, false);
    let fg = fit.fg;
    let bg = fit.bg;
    if (cellBrightness !== 1.0) {
      fg = applyBrightness(fg, cellBrightness);
      bg = applyBrightness(bg, cellBrightness);
    }
    return { char: OCTANT_CHARS[fit.pattern]!, fg, bg };
  }

  // Flat cell → solid full block (pattern 255), fg=bg=average
  if (maxB - minB <= 10) {
    let sr = 0, sg = 0, sb = 0, n = 0;
    for (let row = 0; row < 4; row++) {
      const r = block[row];
      for (let col = 0; col < 2; col++) {
        const pixel = r?.[col] ?? null;
        if (pixel !== null) { sr += pixel.r; sg += pixel.g; sb += pixel.b; n++; }
      }
    }
    let avg: RGB = { r: Math.round(sr / n), g: Math.round(sg / n), b: Math.round(sb / n) };
    if (cellBrightness !== 1.0) avg = applyBrightness(avg, cellBrightness);
    return { char: OCTANT_CHARS[255]!, fg: avg, bg: avg };
  }

  const threshold = (minB + maxB) / 2;
  let pattern = 0;
  let fr = 0, fgG = 0, fb = 0, fn = 0;
  let br = 0, bgG = 0, bb = 0, bn = 0;
  for (let row = 0; row < 4; row++) {
    const r = block[row];
    for (let col = 0; col < 2; col++) {
      const pixel = r?.[col] ?? null;
      const b = OCT_SCRATCH[row * 2 + col]!;
      if (pixel !== null && b >= threshold) {
        pattern |= 1 << (row * 2 + col);
        fr += pixel.r; fgG += pixel.g; fb += pixel.b; fn++;
      } else if (pixel !== null) {
        br += pixel.r; bgG += pixel.g; bb += pixel.b; bn++;
      }
    }
  }

  let fg: RGB = fn > 0
    ? { r: Math.round(fr / fn), g: Math.round(fgG / fn), b: Math.round(fb / fn) }
    : DEFAULT_BG;
  let bg: RGB = bn > 0
    ? { r: Math.round(br / bn), g: Math.round(bgG / bn), b: Math.round(bb / bn) }
    : DEFAULT_BG;

  if (cellBrightness !== 1.0) {
    fg = applyBrightness(fg, cellBrightness);
    bg = applyBrightness(bg, cellBrightness);
  }

  return { char: OCTANT_CHARS[pattern]!, fg, bg };
}

/**
 * Render a pixel grid using Braille characters (ultra-high resolution)
 * Each character represents 2×4 pixels = 8 subpixels
 * Returns array of terminal rows, each representing 4 pixel rows
 */
export function renderBrailleGrid(grid: PixelGrid): string[] {
  const result: string[] = [];
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  // Process 4 rows at a time (Braille is 2×4)
  for (let y = 0; y < height; y += 4) {
    let line = '';
    let lastFg: RGB | null = null;
    let lastBg: RGB | null = null;

    // Process 2 columns at a time
    for (let x = 0; x < width; x += 2) {
      // Extract 2×4 block
      const block: Pixel[][] = [];
      for (let dy = 0; dy < 4; dy++) {
        const row: Pixel[] = [];
        for (let dx = 0; dx < 2; dx++) {
          row.push(grid[y + dy]?.[x + dx] ?? null);
        }
        block.push(row);
      }

      const { char, fg, bg } = renderBrailleChar(block);

      // Emit color codes if changed
      if (!lastFg || lastFg.r !== fg.r || lastFg.g !== fg.g || lastFg.b !== fg.b) {
        line += fgColor(fg);
        lastFg = fg;
      }
      if (!lastBg || lastBg.r !== bg.r || lastBg.g !== bg.g || lastBg.b !== bg.b) {
        line += bgColor(bg);
        lastBg = bg;
      }

      line += char;
    }

    line += RESET;
    result.push(line);
  }

  return result;
}

/**
 * Render a pixel grid using OCTANT characters (string-line variant, used by
 * the production renderToString path). Same 2×4 geometry as braille; solid
 * mosaics. Merged-SGR color emission.
 */
export function renderOctantGrid(grid: PixelGrid): string[] {
  const result: string[] = [];
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  for (let y = 0; y < height; y += 4) {
    let line = '';
    let lastFg: RGB | null = null;
    let lastBg: RGB | null = null;

    for (let x = 0; x < width; x += 2) {
      const block: Pixel[][] = [];
      for (let dy = 0; dy < 4; dy++) {
        const row: Pixel[] = [];
        for (let dx = 0; dx < 2; dx++) row.push(grid[y + dy]?.[x + dx] ?? null);
        block.push(row);
      }

      const { char, fg, bg } = renderOctantChar(block);

      const fgChanged = !lastFg || lastFg.r !== fg.r || lastFg.g !== fg.g || lastFg.b !== fg.b;
      const bgChanged = !lastBg || lastBg.r !== bg.r || lastBg.g !== bg.g || lastBg.b !== bg.b;
      if (fgChanged || bgChanged) {
        line += sgrCode(fgChanged ? fg : null, bgChanged ? bg : null);
        if (fgChanged) lastFg = fg;
        if (bgChanged) lastBg = bg;
      }

      line += char;
    }

    line += RESET;
    result.push(line);
  }

  return result;
}

/**
 * Render a complete pixel grid as multiple lines
 */
export function renderPixelGrid(grid: PixelGrid): string[] {
  return grid.map(row => renderPixelRow(row));
}

/**
 * Render a pixel grid to a single string with newlines
 */
export function renderPixelGridString(grid: PixelGrid): string {
  return renderPixelGrid(grid).join('\n');
}

/**
 * Composite one pixel grid on top of another (for sprites on tiles)
 * Transparent pixels (null) show through to the background
 */
export function compositeGrids(
  background: PixelGrid,
  foreground: PixelGrid,
  offsetX: number = 0,
  offsetY: number = 0
): PixelGrid {
  const result: PixelGrid = background.map(row => [...row]);

  for (let y = 0; y < foreground.length; y++) {
    const targetY = y + offsetY;
    if (targetY < 0 || targetY >= result.length) continue;

    const fgRow = foreground[y];
    if (!fgRow) continue;

    for (let x = 0; x < fgRow.length; x++) {
      const targetX = x + offsetX;
      if (targetX < 0 || targetX >= (result[targetY]?.length ?? 0)) continue;

      const fgPixel = fgRow[x];
      if (fgPixel !== null && fgPixel !== undefined) {
        result[targetY]![targetX] = fgPixel;
      }
    }
  }

  return result;
}

/**
 * Create an empty pixel grid of given dimensions
 */
export function createEmptyGrid(width: number, height: number): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < width; x++) {
      row.push(null);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Create a solid color grid
 */
export function createSolidGrid(width: number, height: number, color: RGB): PixelGrid {
  const grid: PixelGrid = [];
  for (let y = 0; y < height; y++) {
    const row: Pixel[] = [];
    for (let x = 0; x < width; x++) {
      row.push({ ...color });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Extract a sub-region from a pixel grid
 */
export function extractRegion(
  grid: PixelGrid,
  x: number,
  y: number,
  width: number,
  height: number
): PixelGrid {
  const result: PixelGrid = [];
  for (let dy = 0; dy < height; dy++) {
    const sourceY = y + dy;
    const row: Pixel[] = [];
    for (let dx = 0; dx < width; dx++) {
      const sourceX = x + dx;
      if (sourceY >= 0 && sourceY < grid.length &&
          sourceX >= 0 && sourceX < (grid[sourceY]?.length ?? 0)) {
        row.push(grid[sourceY]![sourceX] ?? null);
      } else {
        row.push(null);
      }
    }
    result.push(row);
  }
  return result;
}

/**
 * Scale a pixel grid by an integer factor (upscale)
 */
export function scaleGrid(grid: PixelGrid, factor: number): PixelGrid {
  const result: PixelGrid = [];
  for (const row of grid) {
    const scaledRow: Pixel[] = [];
    for (const pixel of row) {
      for (let i = 0; i < factor; i++) {
        scaledRow.push(pixel);
      }
    }
    for (let i = 0; i < factor; i++) {
      result.push([...scaledRow]);
    }
  }
  return result;
}

/**
 * Quantize a color to reduce bit depth
 * bits=4 means 16 levels per channel instead of 256
 * This improves ANSI color code deduplication
 */
export function quantizeColor(color: RGB, bits: number): RGB {
  if (bits >= 8) return color;
  const shift = 8 - bits;
  const mask = (0xFF << shift) & 0xFF;
  return {
    r: color.r & mask,
    g: color.g & mask,
    b: color.b & mask,
  };
}

/**
 * Bayer 4x4 ordered dithering matrix
 * Normalized to [-0.5, 0.5] range for threshold modification
 */
const BAYER_4X4: number[][] = [
  [ 0,  8,  2, 10],
  [12,  4, 14,  6],
  [ 3, 11,  1,  9],
  [15,  7, 13,  5],
].map(row => row.map(v => (v / 16) - 0.5));

/**
 * Quantize a color with ordered dithering
 * Uses Bayer 4x4 matrix to add structured noise before quantization
 * This reduces visible banding in gradients
 */
export function quantizeColorDithered(color: RGB, bits: number, x: number, y: number): RGB {
  if (bits >= 8) return color;

  const dither = BAYER_4X4[y & 3]![x & 3]! * (256 >> bits);
  const shift = 8 - bits;
  const mask = (0xFF << shift) & 0xFF;

  return {
    r: Math.max(0, Math.min(255, Math.round(color.r + dither))) & mask,
    g: Math.max(0, Math.min(255, Math.round(color.g + dither))) & mask,
    b: Math.max(0, Math.min(255, Math.round(color.b + dither))) & mask,
  };
}

/**
 * Quantize all colors in a pixel grid
 * Reduces unique colors for better ANSI deduplication
 */
export function quantizeGrid(grid: PixelGrid, bits: number): PixelGrid {
  if (bits >= 8) return grid;
  return grid.map(row =>
    row.map(pixel => pixel === null ? null : quantizeColor(pixel, bits))
  );
}

/**
 * Quantize all colors in a pixel grid with ordered dithering
 * Uses Bayer matrix to reduce banding in gradients
 */
export function quantizeGridDithered(grid: PixelGrid, bits: number): PixelGrid {
  if (bits >= 8) return grid;
  return grid.map((row, y) =>
    row.map((pixel, x) => pixel === null ? null : quantizeColorDithered(pixel, bits, x, y))
  );
}

/**
 * Downsample a pixel grid by a factor (zoom out)
 * Uses nearest-neighbor sampling for crisp pixel art
 * Supports non-integer scale factors
 */
export function downsampleGrid(grid: PixelGrid, factor: number): PixelGrid {
  if (factor <= 1) return grid;

  const srcHeight = grid.length;
  const srcWidth = grid[0]?.length ?? 0;
  const dstHeight = Math.floor(srcHeight / factor);
  const dstWidth = Math.floor(srcWidth / factor);

  const result: PixelGrid = [];

  for (let dy = 0; dy < dstHeight; dy++) {
    const row: Pixel[] = [];
    for (let dx = 0; dx < dstWidth; dx++) {
      // Nearest-neighbor: sample from the corresponding source position
      const srcY = Math.floor(dy * factor);
      const srcX = Math.floor(dx * factor);

      if (srcY < srcHeight && srcX < srcWidth) {
        const pixel = grid[srcY]?.[srcX];
        row.push(pixel ?? null);
      } else {
        row.push(null);
      }
    }
    result.push(row);
  }

  return result;
}

// ============================================
// Cell Grid Render Functions (for cell-level diffing)
// ============================================

/**
 * Render a pixel grid to a cell grid using normal mode (2 chars per pixel)
 * Each pixel becomes a cell with 2 spaces and a background color
 */
export function renderNormalGridCells(grid: PixelGrid): CellGrid {
  const result: CellGrid = [];

  for (const row of grid) {
    const cellRow: TerminalCell[] = [];
    for (const pixel of row) {
      cellRow.push({
        char: PIXEL_CHARS,
        fgColor: null,
        bgColor: pixel ?? DEFAULT_BG,
      });
    }
    result.push(cellRow);
  }

  return result;
}

/**
 * Render a pixel grid to a cell grid using half-block mode
 * Each cell represents 2 vertical pixels (1 char width)
 * @param grid - The pixel grid to render
 * @param brightnessGrid - Optional grid of brightness values per cell (indexed by cell x,y)
 */
export function renderHalfBlockGridCells(grid: PixelGrid, brightnessGrid?: BrightnessGrid): CellGrid {
  const result: CellGrid = [];

  let cellY = 0;
  for (let y = 0; y < grid.length; y += 2) {
    const topRow = grid[y] ?? [];
    const bottomRow = grid[y + 1] ?? [];
    const cellRow: TerminalCell[] = [];

    const len = Math.max(topRow.length, bottomRow.length);
    for (let i = 0; i < len; i++) {
      const topPixel = topRow[i] ?? null;
      const bottomPixel = bottomRow[i] ?? null;

      // Get cell brightness from grid if provided
      const cellBrightness = brightnessGrid?.[cellY]?.[i] ?? 1.0;

      let fgColor = topPixel ?? DEFAULT_BG;
      let bgColor = bottomPixel ?? DEFAULT_BG;

      // Apply brightness if not default
      if (cellBrightness !== 1.0) {
        fgColor = applyBrightness(fgColor, cellBrightness);
        bgColor = applyBrightness(bgColor, cellBrightness);
      }

      cellRow.push({
        char: HALF_BLOCK_TOP,
        fgColor,
        bgColor,
      });
    }
    result.push(cellRow);
    cellY++;
  }

  return result;
}

/**
 * Render a pixel grid to a cell grid using braille mode
 * Each cell represents 2×4 pixels (8 subpixels per character)
 * @param grid - The pixel grid to render
 * @param brightnessGrid - Optional grid of brightness values per cell (indexed by cell x,y)
 */
export function renderBrailleGridCells(grid: PixelGrid, brightnessGrid?: BrightnessGrid): CellGrid {
  const result: CellGrid = [];
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  let cellY = 0;
  // Process 4 rows at a time (Braille is 2×4)
  for (let y = 0; y < height; y += 4) {
    const cellRow: TerminalCell[] = [];

    let cellX = 0;
    // Process 2 columns at a time
    for (let x = 0; x < width; x += 2) {
      // Extract 2×4 block
      const block: Pixel[][] = [];
      for (let dy = 0; dy < 4; dy++) {
        const row: Pixel[] = [];
        for (let dx = 0; dx < 2; dx++) {
          row.push(grid[y + dy]?.[x + dx] ?? null);
        }
        block.push(row);
      }

      // Get cell brightness from grid if provided
      const cellBrightness = brightnessGrid?.[cellY]?.[cellX] ?? 1.0;

      const { char, fg, bg } = renderBrailleChar(block, cellBrightness);
      cellRow.push({
        char,
        fgColor: fg,
        bgColor: bg,
      });
      cellX++;
    }

    result.push(cellRow);
    cellY++;
  }

  return result;
}

/**
 * Render a pixel grid to a cell grid using OCTANT mode (2×4 solid mosaics).
 * Same geometry as braille; used by the sim/showcase cell path.
 */
export function renderOctantGridCells(
  grid: PixelGrid,
  brightnessGrid?: BrightnessGrid,
  materialGrid?: Uint8Array[]
): CellGrid {
  const result: CellGrid = [];
  const height = grid.length;
  const width = grid[0]?.length ?? 0;

  let cellY = 0;
  for (let y = 0; y < height; y += 4) {
    const cellRow: TerminalCell[] = [];
    let cellX = 0;
    for (let x = 0; x < width; x += 2) {
      const block: Pixel[][] = [];
      for (let dy = 0; dy < 4; dy++) {
        const row: Pixel[] = [];
        for (let dx = 0; dx < 2; dx++) row.push(grid[y + dy]?.[x + dx] ?? null);
        block.push(row);
      }
      const cellBrightness = brightnessGrid?.[cellY]?.[cellX] ?? 1.0;
      const { char, fg, bg } = renderOctantChar(block, cellBrightness);
      let waterSamples = 0;
      const phaseCounts = new Uint8Array(PHASES);
      if (materialGrid) {
        for (let dy = 0; dy < 4; dy++) {
          for (let dx = 0; dx < 2; dx++) {
            const encodedPhase = materialGrid[y + dy]?.[x + dx] ?? 0;
            // Only 1..PHASES belongs to the water palette. Higher bands carry
            // foliage/actor semantics for the atmosphere pass and must never
            // be recoloured as canal highlights.
            if (encodedPhase >= 1 && encodedPhase <= PHASES) {
              waterSamples++;
              const phaseIndex = encodedPhase - 1;
              phaseCounts[phaseIndex] = (phaseCounts[phaseIndex] ?? 0) + 1;
            }
          }
        }
      }
      if (waterSamples >= 6 && fg && bg) {
        let phase = 0;
        for (let p = 1; p < PHASES; p++) {
          if (phaseCounts[p]! > phaseCounts[phase]!) phase = p;
        }
        const luminance = (color: RGB): number =>
          color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
        const foregroundLuminance = luminance(fg);
        const backgroundLuminance = luminance(bg);
        const contrast = Math.abs(foregroundLuminance - backgroundLuminance);

        // Animate only a genuinely light-catching cluster. The unindexed side
        // retains the generated master texture and supplies the dark teal body
        // of the canal; OSC-4 moves a sparse highlight rather than repainting
        // the whole surface as a two-colour phase field.
        if (Math.max(foregroundLuminance, backgroundLuminance) >= 178 && contrast >= 12) {
          cellRow.push({
            char,
            fgColor: fg,
            bgColor: bg,
            fgIndex: foregroundLuminance >= backgroundLuminance
              ? PALETTE.WATER + phase
              : null,
            bgIndex: backgroundLuminance > foregroundLuminance
              ? PALETTE.WATER + phase
              : null,
          });
        } else {
          cellRow.push({ char, fgColor: fg, bgColor: bg });
        }
      } else {
        cellRow.push({ char, fgColor: fg, bgColor: bg });
      }
      cellX++;
    }
    result.push(cellRow);
    cellY++;
  }

  return result;
}

// ============================================
// CRLE (Chromatic Run-Length Encoding) Renderer
// ============================================

/**
 * Color group for CRLE rendering.
 * Positions/chars are parallel arrays in ROW-MAJOR insertion order — the
 * frame scan is row-major, so each group's cells arrive already sorted by
 * (y, x); no per-group sort is needed. `pos` packs y * rowStride + x.
 */
interface CRLEColorGroup {
  fgColor: RGB | null;
  bgColor: RGB | null;
  pos: number[];
  chars: string[];
}

/** Row stride for packed cell positions (> any realistic terminal width). */
const CRLE_ROW_STRIDE = 4096;

/**
 * CRLE render result with stats
 */
export interface CRLERenderResult {
  output: string;
  colorGroups: number;
  bytesWithoutCRLE: number;
  bytesWithCRLE: number;
}

/**
 * Render changed cells using CRLE (Chromatic Run-Length Encoding)
 *
 * Instead of rendering left-to-right with frequent color changes,
 * group cells by color and render all cells of each color together.
 * This reduces ANSI escape code overhead significantly.
 *
 * @param cells - Current frame's cell grid
 * @param previousCells - Previous frame's cell grid for diffing
 * @param headerRows - Number of header rows to offset terminal positions
 * @param renderMode - 'normal' uses 2-char cells, others use 1-char
 * @returns CRLE render result with output string and stats
 */
export function renderCRLE(
  cells: CellGrid,
  previousCells: CellGrid,
  headerRows: number,
  renderMode: 'normal' | 'halfblock' | 'braille' | 'octant' = 'halfblock'
): CRLERenderResult {
  // Group changed cells by color (integer pair keys — string keys per cell
  // were the hottest allocation in the whole frame pipeline)
  const colorGroups = new Map<number, CRLEColorGroup>();
  let totalChangedCells = 0;

  for (let y = 0; y < cells.length; y++) {
    const row = cells[y];
    const prevRow = previousCells[y];
    if (!row) continue;

    // Cheap row-level skip: identical row references can't differ
    if (row === prevRow) continue;

    const rowBase = y * CRLE_ROW_STRIDE;
    for (let x = 0; x < row.length; x++) {
      const cell = row[x];
      const prevCell = prevRow?.[x];

      // Skip unchanged cells
      if (!cell || cellsEqual(cell, prevCell)) continue;

      totalChangedCells++;
      const key = sgrPairKey(cell.fgColor, cell.bgColor);

      let group = colorGroups.get(key);
      if (!group) {
        group = {
          fgColor: cell.fgColor,
          bgColor: cell.bgColor,
          pos: [],
          chars: [],
        };
        colorGroups.set(key, group);
      }

      group.pos.push(rowBase + x);
      group.chars.push(cell.char);
    }
  }

  // If nothing changed, return empty
  if (colorGroups.size === 0) {
    return {
      output: '',
      colorGroups: 0,
      bytesWithoutCRLE: 0,
      bytesWithCRLE: 0,
    };
  }

  // Build CRLE output: set color once, then emit all positions for that color
  const chunks: string[] = [];

  // Sort groups by cell count (render larger groups first for better perceived performance)
  const sortedGroups = Array.from(colorGroups.values()).sort(
    (a, b) => b.pos.length - a.pos.length
  );

  for (const group of sortedGroups) {
    // Set both colors once for this group in ONE merged SGR sequence, then
    // append the group's cells into one string. Cells are already in
    // row-major order (see grouping loop) — no sort needed.
    let s = sgrCode(group.fgColor, group.bgColor);

    const pos = group.pos;
    const groupChars = group.chars;
    let lastX = -2;
    let lastY = -1;

    for (let i = 0; i < pos.length; i++) {
      const p = pos[i]!;
      const cy = (p / CRLE_ROW_STRIDE) | 0;
      const cx = p - cy * CRLE_ROW_STRIDE;

      // Use relative movement if possible (cursor right), otherwise absolute
      if (lastY === cy && lastX === cx - 1) {
        // Contiguous - no cursor movement needed
      } else if (lastY === cy && cx > lastX && cx - lastX <= 3) {
        // Same row, small gap - use cursor forward (shorter than absolute)
        const spaces = renderMode === 'normal' ? (cx - lastX - 1) * 2 : cx - lastX - 1;
        if (spaces > 0) {
          s += `${ESC}[${spaces}C`;
        }
      } else {
        // Jump to absolute position
        const termCol = renderMode === 'normal' ? cx * 2 + 1 : cx + 1;
        s += `${ESC}[${cy + headerRows + 1};${termCol}H`;
      }

      s += groupChars[i]!;
      lastX = cx;
      lastY = cy;
    }

    chunks.push(s);
  }

  chunks.push(`${ESC}[0m`);  // Reset at end

  const output = chunks.join('');

  // Calculate comparison bytes (what traditional rendering would use)
  // Traditional: for each cell, potentially emit fg + bg + position + char
  // Estimate ~25 bytes per cell with color changes
  const bytesWithoutCRLE = totalChangedCells * 25;
  const bytesWithCRLE = Buffer.byteLength(output, 'utf8');

  return {
    output,
    colorGroups: colorGroups.size,
    bytesWithoutCRLE,
    bytesWithCRLE,
  };
}
