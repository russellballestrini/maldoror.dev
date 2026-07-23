/**
 * OSC-4 palette-cycled material animation (terminal-native codec, component 7).
 *
 * The most powerful pure-terminal animation trick: render animated materials
 * (water, specular, foliage, fire) with a SPATIAL phase field using INDEXED
 * palette colors (`38;5;n` / `48;5;n`, n = BASE + phase). The glyphs and color
 * indices in the framebuffer NEVER change. Each tick we rotate the RGB values
 * assigned to those palette slots via one OSC-4 packet — so the highlight
 * appears to travel across the whole surface for a few hundred bytes/tick,
 * mutating zero cells.
 *
 *   OSC 4 ; <i>;<rgb> ; <i>;<rgb> ; … ST         set palette slots
 *   OSC 104 ; <i> ; <i> … ST                     restore slots (on exit)
 *
 * Reserved index bands (256-color space):
 *   192-199  water wave phases
 *   200-207  specular / glass glint phases
 *   208-215  foliage shimmer phases
 *   216-223  fire / lantern phases
 */
import type { RGB } from '@maldoror/protocol';

export const PALETTE = {
  WATER: 192,
  SPECULAR: 200,
  FOLIAGE: 208,
  FIRE: 216,
} as const;
export const PHASES = 8;

const ESC = '\x1b';
const BEL = '\x07';

/** Spatial phase 0..PHASES-1 for a cell, optionally perturbed by a noise field. */
export function materialPhase(x: number, y: number, noise = 0): number {
  return (((x + 2 * y + noise) % PHASES) + PHASES) % PHASES;
}

/** A second phase family (steeper diagonal) for sparse glassy glints. */
export function glintPhase(x: number, y: number, noise = 0): number {
  return (((3 * x - y + noise) % PHASES) + PHASES) % PHASES;
}

/** Linear RGB interpolation. */
function mix(a: RGB, b: RGB, t: number): RGB {
  return {
    r: Math.round(a.r + (b.r - a.r) * t),
    g: Math.round(a.g + (b.g - a.g) * t),
    b: Math.round(a.b + (b.b - a.b) * t),
  };
}

/**
 * Build the 8 water-phase colors for animation tick `t`. A base teal gradient
 * (deep → mid → bright → white glint) is sampled with a moving offset, so the
 * bright glint sweeps across the phase bands over time.
 *
 * Colors matched to the mockup's teal canals.
 */
export function waterPalette(t: number): RGB[] {
  const deep: RGB = { r: 26, g: 122, b: 130 };
  const mid: RGB = { r: 44, g: 164, b: 168 };
  const bright: RGB = { r: 96, g: 210, b: 208 };
  const glint: RGB = { r: 216, g: 250, b: 246 };
  const out: RGB[] = [];
  for (let p = 0; p < PHASES; p++) {
    // wave position in [0,1) sweeping with t
    const w = (((p + t) % PHASES) + PHASES) % PHASES / PHASES; // 0..1
    // shape: mostly deep/mid, a narrow bright glint band near w≈0.85
    let c: RGB;
    if (w < 0.5) c = mix(deep, mid, w / 0.5);
    else if (w < 0.8) c = mix(mid, bright, (w - 0.5) / 0.3);
    else c = mix(bright, glint, (w - 0.8) / 0.2);
    out.push(c);
  }
  return out;
}

/** ANSI foreground using an indexed palette slot. */
export function fg256(index: number): string {
  return `${ESC}[38;5;${index}m`;
}
/** ANSI background using an indexed palette slot. */
export function bg256(index: number): string {
  return `${ESC}[48;5;${index}m`;
}

/**
 * One OSC-4 packet setting palette slots [base..base+colors.length) to the
 * given RGBs. Uses the `rgb:RR/GG/BB` spec (widely supported incl. Ghostty).
 * Terminated with ST (ESC \\); BEL terminator also accepted by most.
 */
export function osc4Packet(base: number, colors: RGB[]): string {
  const hx = (n: number) => n.toString(16).padStart(2, '0');
  let s = `${ESC}]4`;
  for (let i = 0; i < colors.length; i++) {
    const c = colors[i]!;
    s += `;${base + i};rgb:${hx(c.r)}/${hx(c.g)}/${hx(c.b)}`;
  }
  s += `${ESC}\\`;
  return s;
}

/** OSC-104 packet restoring the given palette slots to their defaults (on exit). */
export function osc104Restore(indices: number[]): string {
  return `${ESC}]104;${indices.join(';')}${ESC}\\`;
}

/**
 * Query a palette slot's current value (OSC 4 ; i ; ? ST). The terminal replies
 * with OSC 4 ; i ; rgb:RRRR/GGGG/BBBB ST — read + parse from the input stream to
 * preserve/restore originals precisely. (Helper string; response handling lives
 * in the session layer.)
 */
export function osc4Query(index: number): string {
  return `${ESC}]4;${index};?${BEL}`;
}
