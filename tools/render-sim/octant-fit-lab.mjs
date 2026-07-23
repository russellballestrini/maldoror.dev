#!/usr/bin/env node

/**
 * Fixed Phase-0 terminal reconstruction laboratory.
 *
 * Compares the production luminance split with perceptual two-cluster fitting
 * and the exhaustive two-colour optimum on both the visual target and a
 * deterministic edge/chroma stress scene. Outputs source images, reconstructed
 * subpixels, Ghostty-shaped cell replays, raw ANSI keyframes, error maps,
 * timings, byte costs, and machine-readable metrics.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const outputRoot = process.env.MALDOROR_RECON_LAB_OUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-2-3-alpha-terminal/octant-fit-v1';
const { fitOctant, rgbToOklab } = await import(`${repo}/packages/render/dist/pixel/octant-fitter.js`);
const { OCTANT_CHARS } = await import(`${repo}/packages/render/dist/pixel/octant-chars.js`);

const WIDTH = 320;
const HEIGHT = 184;
const COLS = WIDTH / 2;
const ROWS = HEIGHT / 4;
const MODES = ['brightness', 'chroma-gated', 'oklab-kmeans', 'oklab-exhaustive'];
const LABELS = {
  brightness: 'production brightness split',
  'chroma-gated': 'production split plus ambiguous-chroma Oklab gate',
  'oklab-kmeans': 'Oklab two-cluster candidate',
  'oklab-exhaustive': 'exhaustive Oklab optimum',
};

await fs.mkdir(outputRoot, { recursive: true });

const cases = [
  await targetCase(),
  await stressCase(),
];
const report = {
  generatedAt: new Date().toISOString(),
  geometry: { sourceWidth: WIDTH, sourceHeight: HEIGHT, cols: COLS, rows: ROWS, cellPixels: '2x4' },
  modes: LABELS,
  cases: {},
};

for (const testCase of cases) {
  const caseDir = path.join(outputRoot, testCase.name);
  await fs.mkdir(caseDir, { recursive: true });
  await writeRgb(path.join(caseDir, 'source.png'), testCase.pixels);
  report.cases[testCase.name] = {};

  for (const mode of MODES) {
    // Warm conversion/JIT before the retained timing samples.
    fitScene(testCase.pixels, mode);
    const timings = [];
    let fitted;
    const beforeRss = process.memoryUsage().rss;
    for (let repeat = 0; repeat < 5; repeat++) {
      const start = performance.now();
      fitted = fitScene(testCase.pixels, mode);
      timings.push(performance.now() - start);
    }
    const afterRss = process.memoryUsage().rss;
    const reconstruction = reconstruct(fitted.cells);
    const ansi = encodeAnsi(fitted.cells);
    const metrics = measure(testCase.pixels, reconstruction, fitted.cells, ansi, timings, afterRss - beforeRss);
    report.cases[testCase.name][mode] = metrics;

    await writeRgb(path.join(caseDir, `${mode}-reconstruction.png`), reconstruction);
    await writeFaithful(path.join(caseDir, `${mode}-cells.png`), fitted.cells);
    await writeError(path.join(caseDir, `${mode}-error.png`), testCase.pixels, reconstruction);
    await fs.writeFile(path.join(caseDir, `${mode}.bin`), ansi);
  }
}

await fs.writeFile(path.join(outputRoot, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
await fs.writeFile(path.join(outputRoot, 'README.md'), markdown(report));
console.log(JSON.stringify(report, null, 2));
console.log(`retained experiment: ${outputRoot}`);

async function targetCase() {
  const target = path.join(repo, 'tools/render-sim/gallery/TARGET.png');
  const { data } = await sharp(target)
    .extract({ left: 8, top: 100, width: 1440, height: 828 })
    .resize(WIDTH, HEIGHT, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { name: 'target', pixels: bufferToPixels(data) };
}

async function stressCase() {
  const pixels = new Array(WIDTH * HEIGHT);
  const waterBoundary = (y) => 103 + 21 * Math.sin(y / 23) + 8 * Math.sin(y / 7);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const noise = hash(x, y) - 0.5;
      let color = rgb(190 + 15 * noise, 164 + 13 * noise, 119 + 10 * noise);
      const waterDistance = x - waterBoundary(y);
      if (waterDistance < 0) {
        color = rgb(23 + 10 * noise, 111 + 25 * noise, 124 + 22 * noise);
        const glint = Math.sin(x * 0.19 + y * 0.11) > 0.91 ? 0.75 : 0;
        color = mix(color, { r: 166, g: 224, b: 205 }, glint);
      } else if (waterDistance < 8) {
        color = mix({ r: 70, g: 120, b: 112 }, { r: 210, g: 189, b: 148 }, waterDistance / 8);
      }

      // Two intersecting routes with irregular edges.
      const verticalPath = Math.abs(x - 155 - 5 * Math.sin(y / 31)) < 18 + 2 * Math.sin(y / 9);
      const horizontalPath = Math.abs(y - 139 - 4 * Math.sin(x / 27)) < 10;
      if (verticalPath || horizontalPath) {
        const grout = (x % 13 < 1) || (y % 11 < 1);
        color = grout ? { r: 126, g: 119, b: 103 } : rgb(207 + 10 * noise, 190 + 9 * noise, 158 + 8 * noise);
      }

      // Cast shadow precedes the building, then the warm integrated facade.
      if (x >= 202 && x < 287 && y >= 56 && y < 125) color = mix(color, { r: 48, g: 43, b: 46 }, 0.36);
      if (x >= 193 && x < 278 && y >= 43 && y < 112) {
        const roof = y < 64 + Math.abs(x - 235) * 0.28;
        color = roof
          ? rgb(154 + 22 * noise, 68 + 12 * noise, 43 + 8 * noise)
          : rgb(190 + 10 * noise, 142 + 12 * noise, 92 + 8 * noise);
        if ((x - 198) % 14 < 2 || (y - 68) % 17 < 2) color = mix(color, { r: 74, g: 55, b: 44 }, 0.45);
      }

      // Soft-alpha canopy and fine foliage challenge both silhouette coverage
      // and chromatic clustering without relying on a checkerboard everywhere.
      const canopyDistance = Math.hypot(x - 282, y - 143);
      if (canopyDistance < 32) {
        const alpha = Math.max(0, Math.min(1, (34 - canopyDistance) / 4));
        const leaf = hash(x * 3, y * 5) > 0.72
          ? { r: 179, g: 181, b: 79 }
          : { r: 61, g: 103, b: 64 };
        color = mix(color, leaf, alpha * 0.9);
      }
      if (hash(x + 911, y + 127) > 0.992 && x > 110) color = { r: 242, g: 204, b: 211 };

      // Equal-luminance red/green microstructure: the old brightness split
      // sees one tone, while the terminal can preserve both hues.
      if (x >= 8 && x < 88 && y >= 126 && y < 176) {
        const phase = (x + (y >> 1)) & 1;
        color = phase ? { r: 255, g: 0, b: 0 } : { r: 0, g: 130, b: 0 };
      }

      // Player silhouette and readable one-pixel structural edges.
      if (x >= 160 && x <= 166 && y >= 113 && y <= 132) color = { r: 30, g: 33, b: 58 };
      if ((x === 160 || x === 166) && y >= 114 && y <= 126) color = { r: 44, g: 91, b: 190 };
      if ((x === 181 || y === 23) && x >= 122 && x <= 190 && y >= 18 && y <= 80) color = { r: 238, g: 226, b: 183 };

      pixels[y * WIDTH + x] = color;
    }
  }
  return { name: 'stress', pixels };
}

function fitScene(pixels, mode) {
  const cells = [];
  const block = new Array(8);
  for (let cellY = 0; cellY < ROWS; cellY++) {
    const row = [];
    for (let cellX = 0; cellX < COLS; cellX++) {
      let index = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          block[index++] = pixels[(cellY * 4 + dy) * WIDTH + cellX * 2 + dx];
        }
      }
      row.push(
        mode === 'brightness'
          ? fitProductionBrightness(block)
          : mode === 'chroma-gated'
            ? fitChromaGated(block)
            : fitOctant(block, mode),
      );
    }
    cells.push(row);
  }
  return { cells };
}

// Exact shape/color behavior of the current production fitter, kept local so
// its timing is not charged for Oklab metric preparation used by candidates.
function fitProductionBrightness(block) {
  let minimum = Infinity, maximum = -Infinity;
  const values = new Float64Array(8);
  for (let index = 0; index < 8; index++) {
    const pixel = block[index];
    const value = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
    values[index] = value;
    minimum = Math.min(minimum, value);
    maximum = Math.max(maximum, value);
  }
  if (maximum - minimum <= 10) {
    const average = meanMask(block, 0xff);
    return { pattern: 0xff, fg: average, bg: average };
  }
  const threshold = (minimum + maximum) / 2;
  let pattern = 0;
  for (let index = 0; index < 8; index++) if (values[index] >= threshold) pattern |= 1 << index;
  return { pattern, fg: meanMask(block, pattern), bg: meanMask(block, (~pattern) & 0xff) };
}

function fitChromaGated(block) {
  let minimumLuma = Infinity, maximumLuma = -Infinity;
  let minimumCo = Infinity, maximumCo = -Infinity;
  let minimumCg = Infinity, maximumCg = -Infinity;
  for (const pixel of block) {
    const luma = 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
    const co = pixel.r - pixel.b;
    const cg = pixel.g - (pixel.r + pixel.b) / 2;
    minimumLuma = Math.min(minimumLuma, luma);
    maximumLuma = Math.max(maximumLuma, luma);
    minimumCo = Math.min(minimumCo, co);
    maximumCo = Math.max(maximumCo, co);
    minimumCg = Math.min(minimumCg, cg);
    maximumCg = Math.max(maximumCg, cg);
  }
  const ambiguousLuma = maximumLuma - minimumLuma <= 20;
  const chromaSpan = Math.max(maximumCo - minimumCo, maximumCg - minimumCg);
  if (!ambiguousLuma || chromaSpan < 30) return fitProductionBrightness(block);
  return { ...fitOctant(block, 'oklab-kmeans'), perceptualGate: true };
}

function meanMask(block, mask) {
  let red = 0, green = 0, blue = 0, count = 0;
  for (let index = 0; index < 8; index++) {
    if ((mask & (1 << index)) === 0) continue;
    const pixel = block[index];
    red += pixel.r;
    green += pixel.g;
    blue += pixel.b;
    count++;
  }
  return rgb(red / count, green / count, blue / count);
}

function reconstruct(cells) {
  const pixels = new Array(WIDTH * HEIGHT);
  for (let cellY = 0; cellY < ROWS; cellY++) {
    for (let cellX = 0; cellX < COLS; cellX++) {
      const cell = cells[cellY][cellX];
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const bit = 1 << (dy * 2 + dx);
          pixels[(cellY * 4 + dy) * WIDTH + cellX * 2 + dx] = (cell.pattern & bit) ? cell.fg : cell.bg;
        }
      }
    }
  }
  return pixels;
}

function encodeAnsi(cells) {
  let ansi = '\x1b[?2026h\x1b[2J\x1b[H';
  for (const row of cells) {
    let previous = '';
    for (const cell of row) {
      const signature = `${cell.fg.r},${cell.fg.g},${cell.fg.b};${cell.bg.r},${cell.bg.g},${cell.bg.b}`;
      if (signature !== previous) {
        ansi += `\x1b[38;2;${cell.fg.r};${cell.fg.g};${cell.fg.b};48;2;${cell.bg.r};${cell.bg.g};${cell.bg.b}m`;
        previous = signature;
      }
      ansi += OCTANT_CHARS[cell.pattern];
    }
    ansi += '\x1b[0m\r\n';
  }
  return `${ansi}\x1b[?2026l`;
}

function measure(source, reconstruction, cells, ansi, timings, rssDelta) {
  const errors = new Array(source.length);
  const sourceLightness = new Float64Array(source.length);
  const reconstructionLightness = new Float64Array(source.length);
  for (let index = 0; index < source.length; index++) {
    const a = rgbToOklab(source[index]);
    const b = rgbToOklab(reconstruction[index]);
    const dl = a.l - b.l, da = a.a - b.a, db = a.b - b.b;
    errors[index] = Math.sqrt(dl * dl + da * da + db * db) * 100;
    sourceLightness[index] = a.l;
    reconstructionLightness[index] = b.l;
  }
  const sourceEdges = gradients(sourceLightness);
  const reconstructionEdges = gradients(reconstructionLightness);
  let colorChanges = 0, glyphChanges = 0, gatedCells = 0, priorSignature = '', priorPattern = -1;
  const patterns = new Set();
  for (const row of cells) {
    priorSignature = '';
    priorPattern = -1;
    for (const cell of row) {
      const signature = `${cell.fg.r},${cell.fg.g},${cell.fg.b};${cell.bg.r},${cell.bg.g},${cell.bg.b}`;
      if (priorSignature && signature !== priorSignature) colorChanges++;
      if (priorPattern >= 0 && cell.pattern !== priorPattern) glyphChanges++;
      priorSignature = signature;
      priorPattern = cell.pattern;
      patterns.add(cell.pattern);
      if (cell.perceptualGate) gatedCells++;
    }
  }
  const orderedErrors = [...errors].sort((a, b) => a - b);
  const orderedTimings = [...timings].sort((a, b) => a - b);
  return {
    deltaEOkMean: round(mean(errors)),
    deltaEOkP95: round(percentile(orderedErrors, 0.95)),
    edgeCorrelation: round(correlation(sourceEdges, reconstructionEdges)),
    edgeEnergyRatio: round(sum(reconstructionEdges) / Math.max(1e-9, sum(sourceEdges))),
    boundaryExcess: round(boundaryExcess(sourceLightness, reconstructionLightness)),
    uniquePatterns: patterns.size,
    horizontalColorChanges: colorChanges,
    horizontalGlyphChanges: glyphChanges,
    perceptualGatedCells: gatedCells,
    ansiBytes: Buffer.byteLength(ansi),
    fitMsP50: round(percentile(orderedTimings, 0.5)),
    fitMsP95: round(percentile(orderedTimings, 0.95)),
    rssDeltaMiB: round(rssDelta / 1024 / 1024),
  };
}

function gradients(values) {
  const result = [];
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      if (x + 1 < WIDTH) result.push(Math.abs(values[y * WIDTH + x] - values[y * WIDTH + x + 1]));
      if (y + 1 < HEIGHT) result.push(Math.abs(values[y * WIDTH + x] - values[(y + 1) * WIDTH + x]));
    }
  }
  return result;
}

function boundaryExcess(source, reconstruction) {
  let excess = 0, count = 0;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 2; x < WIDTH; x += 2) {
      const index = y * WIDTH + x;
      excess += Math.max(0, Math.abs(reconstruction[index] - reconstruction[index - 1]) - Math.abs(source[index] - source[index - 1]));
      count++;
    }
  }
  for (let y = 4; y < HEIGHT; y += 4) {
    for (let x = 0; x < WIDTH; x++) {
      const index = y * WIDTH + x;
      excess += Math.max(0, Math.abs(reconstruction[index] - reconstruction[index - WIDTH]) - Math.abs(source[index] - source[index - WIDTH]));
      count++;
    }
  }
  return excess / Math.max(1, count);
}

async function writeRgb(file, pixels) {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
  pixels.forEach((pixel, index) => {
    buffer[index * 3] = pixel.r;
    buffer[index * 3 + 1] = pixel.g;
    buffer[index * 3 + 2] = pixel.b;
  });
  await sharp(buffer, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(file);
}

async function writeFaithful(file, cells) {
  const cellWidth = 9, cellHeight = 18;
  const width = COLS * cellWidth, height = ROWS * cellHeight;
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" shape-rendering="crispEdges">`];
  for (let cellY = 0; cellY < ROWS; cellY++) {
    for (let cellX = 0; cellX < COLS; cellX++) {
      const cell = cells[cellY][cellX];
      svg.push(`<rect x="${cellX * cellWidth}" y="${cellY * cellHeight}" width="${cellWidth}" height="${cellHeight}" fill="rgb(${cell.bg.r},${cell.bg.g},${cell.bg.b})"/>`);
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 2; column++) {
          if ((cell.pattern & (1 << (row * 2 + column))) === 0) continue;
          svg.push(`<rect x="${cellX * cellWidth + column * 4.5}" y="${cellY * cellHeight + row * 4.5}" width="4.5" height="4.5" fill="rgb(${cell.fg.r},${cell.fg.g},${cell.fg.b})"/>`);
        }
      }
    }
  }
  svg.push('</svg>');
  await sharp(Buffer.from(svg.join(''))).png().toFile(file);
}

async function writeError(file, source, reconstruction) {
  const buffer = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let index = 0; index < source.length; index++) {
    const a = rgbToOklab(source[index]);
    const b = rgbToOklab(reconstruction[index]);
    const error = Math.min(1, Math.hypot(a.l - b.l, a.a - b.a, a.b - b.b) / 0.18);
    buffer[index * 3] = Math.round(255 * Math.min(1, error * 1.7));
    buffer[index * 3 + 1] = Math.round(210 * Math.max(0, error - 0.25));
    buffer[index * 3 + 2] = Math.round(120 * Math.max(0, error - 0.7));
  }
  await sharp(buffer, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(file);
}

function bufferToPixels(data) {
  return Array.from({ length: WIDTH * HEIGHT }, (_, index) => ({
    r: data[index * 3], g: data[index * 3 + 1], b: data[index * 3 + 2],
  }));
}

function hash(x, y) {
  let value = Math.imul(Math.trunc(x) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(Math.trunc(y) ^ 0xc2b2ae35, 0x27d4eb2f);
  value ^= value >>> 15;
  value = Math.imul(value, 0x2c1b3c6d);
  value ^= value >>> 12;
  return (value >>> 0) / 0xffffffff;
}

function rgb(r, g, b) {
  return { r: clampByte(r), g: clampByte(g), b: clampByte(b) };
}

function mix(a, b, t) {
  return rgb(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t);
}

function clampByte(value) { return Math.max(0, Math.min(255, Math.round(value))); }
function mean(values) { return sum(values) / Math.max(1, values.length); }
function sum(values) { return values.reduce((total, value) => total + value, 0); }
function percentile(sorted, fraction) { return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))]; }
function round(value) { return Math.round(value * 1000) / 1000; }

function correlation(a, b) {
  const meanA = mean(a), meanB = mean(b);
  let numerator = 0, denominatorA = 0, denominatorB = 0;
  for (let index = 0; index < a.length; index++) {
    const da = a[index] - meanA, db = b[index] - meanB;
    numerator += da * db;
    denominatorA += da * da;
    denominatorB += db * db;
  }
  return numerator / Math.sqrt(Math.max(1e-18, denominatorA * denominatorB));
}

function markdown(data) {
  const lines = [
    '# Octant fitting laboratory V1',
    '',
    'Fixed 160x46-cell comparison. Each mode receives identical 320x184 source subpixels.',
    'Raw ANSI keyframes, cell-faithful replays, reconstruction images, and error maps are retained per case.',
    '',
  ];
  for (const [caseName, modes] of Object.entries(data.cases)) {
    lines.push(`## ${caseName}`, '', '| mode | mean dEOK | p95 dEOK | edge corr | boundary excess | p50 ms | ANSI bytes |', '|---|---:|---:|---:|---:|---:|---:|');
    for (const [mode, metrics] of Object.entries(modes)) {
      lines.push(`| ${mode} | ${metrics.deltaEOkMean} | ${metrics.deltaEOkP95} | ${metrics.edgeCorrelation} | ${metrics.boundaryExcess} | ${metrics.fitMsP50} | ${metrics.ansiBytes} |`);
    }
    lines.push('');
  }
  lines.push('Selection is intentionally not automated. Metrics locate losses; direct faithful comparison remains authoritative.', '');
  return `${lines.join('\n')}\n`;
}
