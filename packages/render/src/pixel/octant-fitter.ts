import type { Pixel, RGB } from '@maldoror/protocol';

export type OctantFitMode = 'brightness' | 'oklab-kmeans' | 'oklab-exhaustive';

export interface OctantFit {
  pattern: number;
  fg: RGB;
  bg: RGB;
  /** Sum of squared Oklab reconstruction error over the eight subpixels. */
  error: number;
}

interface Lab {
  l: number;
  a: number;
  b: number;
}

const DEFAULT_BG: RGB = { r: 20, g: 20, b: 25 };
const COUNT = 8;
const linearR = new Float64Array(COUNT);
const linearG = new Float64Array(COUNT);
const linearB = new Float64Array(COUNT);
const labL = new Float64Array(COUNT);
const labA = new Float64Array(COUNT);
const labB = new Float64Array(COUNT);
const assignments = new Uint8Array(COUNT);
// OCTANT inputs are RGB bytes. Store the exact production transfer result for
// each byte once; the helper retains the original formula for general values.
const SRGB_BYTE_TO_LINEAR = Float64Array.from({ length: 256 }, (_, value) =>
  srgbToLinear(value / 255));

/**
 * Fit eight source subpixels to the terminal's two-colour octant model.
 *
 * This routine is deliberately synchronous and allocation-bounded. The shared
 * scratch arrays are safe for the renderer's single-threaded cell walk; callers
 * must not invoke it re-entrantly.
 */
export function fitOctant(
  pixels: ReadonlyArray<Pixel>,
  mode: OctantFitMode,
  defaultBackground: RGB = DEFAULT_BG,
  measureError = true,
): OctantFit {
  prepare(pixels, defaultBackground);
  if (mode === 'brightness') return fitBrightness(pixels, defaultBackground, measureError);
  if (mode === 'oklab-exhaustive') return fitExhaustive(measureError);
  return fitKmeans(measureError);
}

export function rgbToOklab(color: RGB): Lab {
  const r = srgbByteToLinear(color.r);
  const g = srgbByteToLinear(color.g);
  const b = srgbByteToLinear(color.b);
  return linearRgbToOklab(r, g, b);
}

function prepare(pixels: ReadonlyArray<Pixel>, defaultBackground: RGB): void {
  for (let index = 0; index < COUNT; index++) {
    const pixel = pixels[index] ?? defaultBackground;
    const r = srgbByteToLinear(pixel.r);
    const g = srgbByteToLinear(pixel.g);
    const b = srgbByteToLinear(pixel.b);
    const lab = linearRgbToOklab(r, g, b);
    linearR[index] = r;
    linearG[index] = g;
    linearB[index] = b;
    labL[index] = lab.l;
    labA[index] = lab.a;
    labB[index] = lab.b;
  }
}

function fitBrightness(pixels: ReadonlyArray<Pixel>, defaultBackground: RGB, measureError: boolean): OctantFit {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  const brightness = new Float64Array(COUNT);
  for (let index = 0; index < COUNT; index++) {
    const pixel = pixels[index] ?? defaultBackground;
    const value = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
    brightness[index] = value;
    min = Math.min(min, value);
    max = Math.max(max, value);
  }

  if (max - min <= 10) {
    const average = meanSrgb(pixels, 0xff, defaultBackground);
    return {
      pattern: 0xff,
      fg: average,
      bg: average,
      error: measureError ? reconstructionError(0xff, average, average) : 0,
    };
  }

  const threshold = (min + max) / 2;
  let pattern = 0;
  for (let index = 0; index < COUNT; index++) {
    if (brightness[index]! >= threshold) pattern |= 1 << index;
  }
  const fg = meanSrgb(pixels, pattern, defaultBackground);
  const bg = meanSrgb(pixels, (~pattern) & 0xff, defaultBackground);
  return { pattern, fg, bg, error: measureError ? reconstructionError(pattern, fg, bg) : 0 };
}

function fitKmeans(measureError: boolean): OctantFit {
  let seedA = 0;
  let seedB = 0;
  let maximumDistance = -1;
  for (let first = 0; first < COUNT; first++) {
    for (let second = first + 1; second < COUNT; second++) {
      const distance = sampleDistance(first, second);
      if (distance > maximumDistance) {
        maximumDistance = distance;
        seedA = first;
        seedB = second;
      }
    }
  }

  // A truly flat cell should remain one stable solid colour rather than turn
  // tiny numerical differences into a high-frequency glyph pattern.
  if (maximumDistance <= 0.0001) {
    const average = meanLinear(0xff);
    return { pattern: 0xff, fg: average, bg: average, error: measureError ? reconstructionError(0xff, average, average) : 0 };
  }

  let aL = labL[seedA]!;
  let aA = labA[seedA]!;
  let aB = labB[seedA]!;
  let bL = labL[seedB]!;
  let bA = labA[seedB]!;
  let bB = labB[seedB]!;

  for (let iteration = 0; iteration < 4; iteration++) {
    let sumAL = 0, sumAA = 0, sumAB = 0, countA = 0;
    let sumBL = 0, sumBA = 0, sumBB = 0, countB = 0;
    for (let index = 0; index < COUNT; index++) {
      const distanceA = labDistance(index, aL, aA, aB);
      const distanceB = labDistance(index, bL, bA, bB);
      const cluster = distanceB < distanceA ? 1 : 0;
      assignments[index] = cluster;
      if (cluster === 0) {
        sumAL += labL[index]!;
        sumAA += labA[index]!;
        sumAB += labB[index]!;
        countA++;
      } else {
        sumBL += labL[index]!;
        sumBA += labA[index]!;
        sumBB += labB[index]!;
        countB++;
      }
    }
    if (countA > 0) {
      aL = sumAL / countA;
      aA = sumAA / countA;
      aB = sumAB / countA;
    }
    if (countB > 0) {
      bL = sumBL / countB;
      bA = sumBA / countB;
      bB = sumBB / countB;
    }
  }

  let pattern = 0;
  for (let index = 0; index < COUNT; index++) {
    if (assignments[index] === 1) pattern |= 1 << index;
  }
  if (pattern === 0 || pattern === 0xff) {
    const average = meanLinear(0xff);
    return { pattern: 0xff, fg: average, bg: average, error: measureError ? reconstructionError(0xff, average, average) : 0 };
  }

  let fg = meanLinear(pattern);
  let bg = meanLinear((~pattern) & 0xff);
  ({ pattern, fg, bg } = orientLightForeground(pattern, fg, bg));
  return { pattern, fg, bg, error: measureError ? reconstructionError(pattern, fg, bg) : 0 };
}

function fitExhaustive(measureError: boolean): OctantFit {
  let bestPattern = 1;
  let bestFg = meanLinear(1);
  let bestBg = meanLinear(0xfe);
  let bestError = Number.POSITIVE_INFINITY;

  // Complementary masks describe the same reconstruction after fg/bg swap,
  // so 1..127 covers every non-trivial two-colour partition exactly once.
  for (let pattern = 1; pattern < 0x80; pattern++) {
    const fg = meanLinear(pattern);
    const bg = meanLinear((~pattern) & 0xff);
    const error = reconstructionError(pattern, fg, bg);
    if (error < bestError) {
      bestPattern = pattern;
      bestFg = fg;
      bestBg = bg;
      bestError = error;
    }
  }

  const solid = meanLinear(0xff);
  const solidError = reconstructionError(0xff, solid, solid);
  if (solidError <= bestError) {
    return { pattern: 0xff, fg: solid, bg: solid, error: measureError ? solidError : 0 };
  }

  const oriented = orientLightForeground(bestPattern, bestFg, bestBg);
  return {
    ...oriented,
    error: measureError ? reconstructionError(oriented.pattern, oriented.fg, oriented.bg) : 0,
  };
}

function orientLightForeground(pattern: number, fg: RGB, bg: RGB): { pattern: number; fg: RGB; bg: RGB } {
  if (rgbToOklab(fg).l >= rgbToOklab(bg).l) return { pattern, fg, bg };
  return { pattern: (~pattern) & 0xff, fg: bg, bg: fg };
}

function meanLinear(mask: number): RGB {
  let red = 0, green = 0, blue = 0, count = 0;
  for (let index = 0; index < COUNT; index++) {
    if ((mask & (1 << index)) === 0) continue;
    red += linearR[index]!;
    green += linearG[index]!;
    blue += linearB[index]!;
    count++;
  }
  if (count === 0) return DEFAULT_BG;
  return {
    r: linearToByte(red / count),
    g: linearToByte(green / count),
    b: linearToByte(blue / count),
  };
}

function meanSrgb(pixels: ReadonlyArray<Pixel>, mask: number, defaultBackground: RGB): RGB {
  let red = 0, green = 0, blue = 0, count = 0;
  for (let index = 0; index < COUNT; index++) {
    if ((mask & (1 << index)) === 0) continue;
    const pixel = pixels[index] ?? defaultBackground;
    red += pixel.r;
    green += pixel.g;
    blue += pixel.b;
    count++;
  }
  if (count === 0) return defaultBackground;
  return {
    r: Math.round(red / count),
    g: Math.round(green / count),
    b: Math.round(blue / count),
  };
}

function reconstructionError(pattern: number, fg: RGB, bg: RGB): number {
  const foreground = rgbToOklab(fg);
  const background = rgbToOklab(bg);
  let error = 0;
  for (let index = 0; index < COUNT; index++) {
    const target = (pattern & (1 << index)) === 0 ? background : foreground;
    error += labDistance(index, target.l, target.a, target.b);
  }
  return error;
}

function sampleDistance(first: number, second: number): number {
  const dl = labL[first]! - labL[second]!;
  const da = labA[first]! - labA[second]!;
  const db = labB[first]! - labB[second]!;
  return dl * dl + da * da + db * db;
}

function labDistance(index: number, l: number, a: number, b: number): number {
  const dl = labL[index]! - l;
  const da = labA[index]! - a;
  const db = labB[index]! - b;
  return dl * dl + da * da + db * db;
}

function linearRgbToOklab(r: number, g: number, b: number): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function srgbByteToLinear(value: number): number {
  if (Number.isInteger(value) && value >= 0 && value <= 255) {
    return SRGB_BYTE_TO_LINEAR[value]!;
  }
  return srgbToLinear(value / 255);
}

function linearToByte(value: number): number {
  const encoded = value <= 0.0031308
    ? 12.92 * value
    : 1.055 * value ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(1, encoded)) * 255);
}
