/**
 * Memoized ANSI SGR escape-string builders.
 *
 * Building `\x1b[38;2;R;G;Bm` strings per cell per frame is one of the
 * hottest allocations in the render path. Colors repeat heavily (terrain
 * palettes, quantized zoom levels), so integer-keyed caches hit almost
 * always. Caches are bounded and cleared wholesale when full — cheaper and
 * simpler than LRU for this access pattern.
 */
import type { RGB } from '@maldoror/protocol';

const ESC = '\x1b';
const CACHE_CAP = 65536;

/** Pack an RGB into a 24-bit integer key. */
export function rgbKey(c: RGB): number {
  return (c.r << 16) | (c.g << 8) | c.b;
}

const FG_CACHE = new Map<number, string>();
const BG_CACHE = new Map<number, string>();
const SGR_CACHE = new Map<number, string>();

function red(key: number): number { return (key >>> 16) & 0xff; }
function green(key: number): number { return (key >>> 8) & 0xff; }
function blue(key: number): number { return key & 0xff; }

/** Cached foreground escape: \x1b[38;2;r;g;bm */
export function fgCode(c: RGB): string {
  const k = rgbKey(c);
  let s = FG_CACHE.get(k);
  if (s === undefined) {
    if (FG_CACHE.size >= CACHE_CAP) FG_CACHE.clear();
    s = `${ESC}[38;2;${c.r};${c.g};${c.b}m`;
    FG_CACHE.set(k, s);
  }
  return s;
}

/** Cached background escape: \x1b[48;2;r;g;bm */
export function bgCode(c: RGB): string {
  const k = rgbKey(c);
  let s = BG_CACHE.get(k);
  if (s === undefined) {
    if (BG_CACHE.size >= CACHE_CAP) BG_CACHE.clear();
    s = `${ESC}[48;2;${c.r};${c.g};${c.b}m`;
    BG_CACHE.set(k, s);
  }
  return s;
}

/**
 * Combined-pair key for (fg, bg), where either may be null.
 * -1 (null) maps to 0; colors map to key+1. Multiplier keeps pairs unique.
 */
export function sgrPairKey(fg: RGB | null, bg: RGB | null): number {
  const fk = fg === null ? 0 : rgbKey(fg) + 1;
  const bk = bg === null ? 0 : rgbKey(bg) + 1;
  return fk * 16777217 + bk; // 16777217 = 2^24 + 1 > max(bk)
}

/**
 * Cached MERGED escape setting fg and/or bg in ONE sequence:
 *   \x1b[38;2;r;g;b;48;2;r;g;bm
 * A merged sequence saves ~5 bytes versus two separate sequences every
 * time both colors change (the common case on color-group boundaries).
 */
export function sgrCode(fg: RGB | null, bg: RGB | null): string {
  if (fg === null && bg === null) return '';
  const k = sgrPairKey(fg, bg);
  let s = SGR_CACHE.get(k);
  if (s === undefined) {
    if (SGR_CACHE.size >= CACHE_CAP) SGR_CACHE.clear();
    if (fg !== null && bg !== null) {
      s = `${ESC}[38;2;${fg.r};${fg.g};${fg.b};48;2;${bg.r};${bg.g};${bg.b}m`;
    } else if (fg !== null) {
      s = `${ESC}[38;2;${fg.r};${fg.g};${fg.b}m`;
    } else {
      s = `${ESC}[48;2;${bg!.r};${bg!.g};${bg!.b}m`;
    }
    SGR_CACHE.set(k, s);
  }
  return s;
}

/** Packed-key variant for the typed terminal-cell path. This avoids creating
 * two short-lived RGB objects for every emitted cell while sharing the same
 * bounded pair cache and byte-identical SGR encoding as `sgrCode`. */
export function sgrCodePacked(fg: number | null, bg: number | null): string {
  if (fg === null && bg === null) return '';
  const fk = fg === null ? 0 : fg + 1;
  const bk = bg === null ? 0 : bg + 1;
  const k = fk * 16777217 + bk;
  let s = SGR_CACHE.get(k);
  if (s === undefined) {
    if (SGR_CACHE.size >= CACHE_CAP) SGR_CACHE.clear();
    if (fg !== null && bg !== null) {
      s = `${ESC}[38;2;${red(fg)};${green(fg)};${blue(fg)};48;2;${red(bg)};${green(bg)};${blue(bg)}m`;
    } else if (fg !== null) {
      s = `${ESC}[38;2;${red(fg)};${green(fg)};${blue(fg)}m`;
    } else {
      s = `${ESC}[48;2;${red(bg!)};${green(bg!)};${blue(bg!)}m`;
    }
    SGR_CACHE.set(k, s);
  }
  return s;
}
