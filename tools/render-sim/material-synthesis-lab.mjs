#!/usr/bin/env node
/**
 * Phase-0 / Track-1 experiment: recover the diversity currently discarded
 * when a 1254px terrain master is collapsed into four 96px quadrant tiles.
 *
 * Identical paving content is reconstructed by five strategies:
 *   1. the production four-tile baseline;
 *   2. continuous linear-light lattice blending;
 *   3. contrast-preserving two-band lattice blending;
 *   4. minimum-error image quilting from the full exemplar;
 *   5. corner-coded stochastic tiles synthesized from the full exemplar.
 *
 * Evidence is written to the mounted research drive. The experiment is fixed,
 * deterministic, and emits both source PNGs and real TerminalCodec streams.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const PROFILE = process.argv[3] ?? 'v1';
if (!['v1', 'v2', 'v3', 'v4', 'v5'].includes(PROFILE)) throw new Error(`Unknown synthesis profile: ${PROFILE}`);
const OUTPUT = path.resolve(process.argv[2] ??
  `/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/interior-synthesis-${PROFILE}`);
const ATLAS_OUTPUT = process.argv[4] ? path.resolve(process.argv[4]) : null;
const MASTER = path.join(REPO, 'assets/canal-town/terrain/paving-stone-master.png');
const TILE = 96;
const TILES_WIDE = 10;
const TILES_HIGH = 6;
const WIDTH = TILE * TILES_WIDE;
const HEIGHT = TILE * TILES_HIGH;
const ANSI_COLS = 120;
const ANSI_ROWS = 36;
const WORLD_SEED = 0x71aa31;
const CANDIDATES = [
  'baseline-four-tiles',
  'lattice-linear',
  'lattice-multiband',
  'quilt-minerror',
  'wang-corner-coded',
];
const SRGB_TO_LINEAR = Float64Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
});

const { renderOctantGridCells } = await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { TerminalCodec } = await import(`${REPO}/packages/render/dist/pixel/terminal-codec.js`);
fs.mkdirSync(OUTPUT, { recursive: true });

const legacy = await loadLegacyVariants();
const legacyLow = await Promise.all(legacy.map((variant) => blurRaw(variant, TILE, TILE, 5.5)));
// V1 intentionally tested the full exemplar too literally and promoted its
// largest grout bars into the synthesis. V2 reconstructs at the production
// texel scale: the full master corresponds to roughly two 96px world tiles.
const exemplar = await loadExemplar(PROFILE === 'v1' ? 512 : 192);
const outputs = new Map();
const timings = {};
let lastCornerBank = null;

await timed('baseline-four-tiles', () => renderBaseline(legacy));
await timed('lattice-linear', () => renderLattice(legacy, legacyLow, false));
await timed('lattice-multiband', () => renderLattice(legacy, legacyLow, true));
await timed('quilt-minerror', () => PROFILE === 'v1'
  ? quiltTexture(exemplar, 72, 18, 40)
  : quiltTexture(exemplar, 48, 12, 56));
await timed('wang-corner-coded', () => renderCornerCoded(exemplar));

for (const [name, data] of outputs) {
  const sourcePath = path.join(OUTPUT, `${name}-source.png`);
  await sharp(data, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(sourcePath);
  await writeAnsiCapture(name, sourcePath);
}
await writeComparison();
if (ATLAS_OUTPUT) await writeCornerAtlas(ATLAS_OUTPUT);

const metrics = {
  experiment: `track-1-material-blending/interior-synthesis-${PROFILE}`,
  generatedAt: new Date().toISOString(),
  worldSeed: WORLD_SEED,
  dimensions: {
    sourceMaster: [exemplar.width, exemplar.height],
    tiles: [TILES_WIDE, TILES_HIGH],
    sourcePixels: [WIDTH, HEIGHT],
    ansi: [ANSI_COLS, ANSI_ROWS],
  },
  candidates: Object.fromEntries(CANDIDATES.map((name) => [name, {
    generationMs: Number(timings[name].toFixed(1)),
    ...measure(outputs.get(name)),
  }])),
  interpretation: {
    tileBoundaryRatio: 'mean adjacent-pixel delta at tile boundaries divided by the same delta away from boundaries; 1 is texture-like, high values expose seams',
    uniqueTileSignatures: `distinct ${TILES_WIDE * TILES_HIGH} tile signatures after 16x16 luminance reduction; low values expose exact repetition`,
    maximumTileLagCorrelation: 'largest positive luminance correlation at offsets of 1..5 whole tiles; lower is less periodic',
    localContrast: 'RMS four-neighbour luminance difference; compare against baseline for blur or over-sharpening',
  },
  limitations: [
    'This benchmark isolates paving interiors; material transitions, buildings, lighting, and animation are deliberately absent.',
    'The corner-coded candidate guarantees matching boundary samples but its inward edge synthesis still needs direct visual review for mirrored ridges.',
    'Minimum-error quilting is an offline quality reference, not yet an infinite-runtime architecture.',
    'Metrics diagnose failure modes; faithful ANSI and direct visual comparison remain authoritative.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

async function timed(name, build) {
  const started = performance.now();
  outputs.set(name, await build());
  timings[name] = performance.now() - started;
}

async function loadLegacyVariants() {
  const metadata = await sharp(MASTER).metadata();
  const cropWidth = Math.floor(metadata.width / 2);
  const cropHeight = Math.floor(metadata.height / 2);
  return Promise.all(Array.from({ length: 4 }, async (_, index) => {
    const { data } = await sharp(MASTER)
      .extract({
        left: (index % 2) * cropWidth,
        top: Math.floor(index / 2) * cropHeight,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(TILE, TILE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return data;
  }));
}

async function loadExemplar(size) {
  const { data, info } = await sharp(MASTER)
    .resize(size, size, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function blurRaw(input, width, height, sigma) {
  const { data } = await sharp(input, { raw: { width, height, channels: 3 } })
    .blur(sigma)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data;
}

function renderBaseline(variants) {
  const output = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let tileY = 0; tileY < TILES_HIGH; tileY++) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX++) {
      const variant = variants[hash2(tileX, tileY, 0x1217) % variants.length];
      blit(output, WIDTH, HEIGHT, variant, TILE, TILE, tileX * TILE, tileY * TILE);
    }
  }
  return output;
}

function renderLattice(variants, lowVariants, multiband) {
  const output = Buffer.alloc(WIDTH * HEIGHT * 3);
  const periodPixels = TILE * 3.5;
  for (let y = 0; y < HEIGHT; y++) {
    const fieldY = (y + 0.5) / periodPixels;
    const cellY = Math.floor(fieldY);
    const blendY = smoothstep01(fieldY - cellY);
    for (let x = 0; x < WIDTH; x++) {
      const fieldX = (x + 0.5) / periodPixels;
      const cellX = Math.floor(fieldX);
      const blendX = smoothstep01(fieldX - cellX);
      const samples = [];
      let sharpWeightSum = 0;
      for (let dy = 0; dy <= 1; dy++) {
        for (let dx = 0; dx <= 1; dx++) {
          const weight = (dx === 0 ? 1 - blendX : blendX) * (dy === 0 ? 1 - blendY : blendY);
          const hash = hash2(cellX + dx, cellY + dy, 0x8da6b3);
          const variantIndex = hash % variants.length;
          const phaseX = (hash >>> 8) % TILE;
          const phaseY = (hash >>> 17) % TILE;
          const sourceX = mirrorIndex(x + phaseX, TILE);
          const sourceY = mirrorIndex(y + phaseY, TILE);
          const source = (sourceY * TILE + sourceX) * 3;
          const sharpWeight = multiband ? Math.pow(weight, 3.5) : weight;
          sharpWeightSum += sharpWeight;
          samples.push({ weight, sharpWeight, variantIndex, source });
        }
      }
      const target = (y * WIDTH + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        let low = 0;
        let detail = 0;
        for (const sample of samples) {
          const raw = SRGB_TO_LINEAR[variants[sample.variantIndex][sample.source + channel]];
          if (!multiband) {
            low += raw * sample.weight;
            continue;
          }
          const blurred = SRGB_TO_LINEAR[lowVariants[sample.variantIndex][sample.source + channel]];
          low += blurred * sample.weight;
          detail += (raw - blurred) * sample.sharpWeight / Math.max(1e-9, sharpWeightSum);
        }
        output[target + channel] = linearToSrgb(low + detail);
      }
    }
  }
  return output;
}

function quiltTexture(exemplar, patchSize, overlap, candidateCount) {
  const output = Buffer.alloc(WIDTH * HEIGHT * 3);
  const occupied = new Uint8Array(WIDTH * HEIGHT);
  const step = patchSize - overlap;
  for (let outputY = 0; outputY < HEIGHT; outputY += step) {
    for (let outputX = 0; outputX < WIDTH; outputX += step) {
      const copyWidth = Math.min(patchSize, WIDTH - outputX);
      const copyHeight = Math.min(patchSize, HEIGHT - outputY);
      const candidates = [];
      for (let candidate = 0; candidate < candidateCount; candidate++) {
        const hash = hash2(outputX + candidate * 37, outputY - candidate * 19, 0x9e3779);
        const sourceX = hash % (exemplar.width - patchSize + 1);
        const sourceY = (hash >>> 12) % (exemplar.height - patchSize + 1);
        candidates.push({
          sourceX,
          sourceY,
          score: overlapScore(output, occupied, exemplar, outputX, outputY, sourceX, sourceY, copyWidth, copyHeight, overlap),
        });
      }
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0].score;
      const near = candidates.filter((candidate) => candidate.score <= best * 1.08 + 1);
      const chosen = near[hash2(outputX, outputY, 0xc2b2ae) % near.length];
      const vertical = outputX === 0 ? null : minimumVerticalSeam(
        output, exemplar, outputX, outputY, chosen.sourceX, chosen.sourceY, Math.min(overlap, copyWidth), copyHeight,
      );
      const horizontal = outputY === 0 ? null : minimumHorizontalSeam(
        output, exemplar, outputX, outputY, chosen.sourceX, chosen.sourceY, copyWidth, Math.min(overlap, copyHeight),
      );
      for (let y = 0; y < copyHeight; y++) {
        for (let x = 0; x < copyWidth; x++) {
          const targetPixel = (outputY + y) * WIDTH + outputX + x;
          let takeCandidate = occupied[targetPixel] === 0;
          if (!takeCandidate) {
            const leftDecision = vertical && x < overlap ? x >= vertical[y] : true;
            const topDecision = horizontal && y < overlap ? y >= horizontal[x] : true;
            takeCandidate = leftDecision && topDecision;
          }
          if (takeCandidate) {
            const source = ((chosen.sourceY + y) * exemplar.width + chosen.sourceX + x) * 3;
            const target = targetPixel * 3;
            output[target] = exemplar.data[source];
            output[target + 1] = exemplar.data[source + 1];
            output[target + 2] = exemplar.data[source + 2];
          }
          occupied[targetPixel] = 1;
        }
      }
    }
  }
  return output;
}

function overlapScore(output, occupied, exemplar, outputX, outputY, sourceX, sourceY, width, height, overlap) {
  let score = 0;
  let samples = 0;
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      if (x >= overlap && y >= overlap) continue;
      const targetPixel = (outputY + y) * WIDTH + outputX + x;
      if (!occupied[targetPixel]) continue;
      const target = targetPixel * 3;
      const source = ((sourceY + y) * exemplar.width + sourceX + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        const delta = output[target + channel] - exemplar.data[source + channel];
        score += delta * delta;
      }
      samples++;
    }
  }
  return samples === 0 ? 0 : score / samples;
}

function minimumVerticalSeam(output, exemplar, outputX, outputY, sourceX, sourceY, overlap, height) {
  const cost = new Float64Array(overlap * height);
  const parent = new Int8Array(overlap * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < overlap; x++) {
      const local = y * overlap + x;
      const target = ((outputY + y) * WIDTH + outputX + x) * 3;
      const source = ((sourceY + y) * exemplar.width + sourceX + x) * 3;
      let pixelCost = 0;
      for (let channel = 0; channel < 3; channel++) {
        const delta = output[target + channel] - exemplar.data[source + channel];
        pixelCost += delta * delta;
      }
      if (y === 0) {
        cost[local] = pixelCost;
        continue;
      }
      let bestX = x;
      let best = cost[(y - 1) * overlap + x];
      if (x > 0 && cost[(y - 1) * overlap + x - 1] < best) {
        best = cost[(y - 1) * overlap + x - 1];
        bestX = x - 1;
      }
      if (x + 1 < overlap && cost[(y - 1) * overlap + x + 1] < best) {
        best = cost[(y - 1) * overlap + x + 1];
        bestX = x + 1;
      }
      cost[local] = pixelCost + best;
      parent[local] = bestX - x;
    }
  }
  const seam = new Uint8Array(height);
  let x = 0;
  for (let candidate = 1; candidate < overlap; candidate++) {
    if (cost[(height - 1) * overlap + candidate] < cost[(height - 1) * overlap + x]) x = candidate;
  }
  for (let y = height - 1; y >= 0; y--) {
    seam[y] = x;
    x += parent[y * overlap + x];
  }
  return seam;
}

function minimumHorizontalSeam(output, exemplar, outputX, outputY, sourceX, sourceY, width, overlap) {
  const cost = new Float64Array(width * overlap);
  const parent = new Int8Array(width * overlap);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < overlap; y++) {
      const local = x * overlap + y;
      const target = ((outputY + y) * WIDTH + outputX + x) * 3;
      const source = ((sourceY + y) * exemplar.width + sourceX + x) * 3;
      let pixelCost = 0;
      for (let channel = 0; channel < 3; channel++) {
        const delta = output[target + channel] - exemplar.data[source + channel];
        pixelCost += delta * delta;
      }
      if (x === 0) {
        cost[local] = pixelCost;
        continue;
      }
      let bestY = y;
      let best = cost[(x - 1) * overlap + y];
      if (y > 0 && cost[(x - 1) * overlap + y - 1] < best) {
        best = cost[(x - 1) * overlap + y - 1];
        bestY = y - 1;
      }
      if (y + 1 < overlap && cost[(x - 1) * overlap + y + 1] < best) {
        best = cost[(x - 1) * overlap + y + 1];
        bestY = y + 1;
      }
      cost[local] = pixelCost + best;
      parent[local] = bestY - y;
    }
  }
  const seam = new Uint8Array(width);
  let y = 0;
  for (let candidate = 1; candidate < overlap; candidate++) {
    if (cost[(width - 1) * overlap + candidate] < cost[(width - 1) * overlap + y]) y = candidate;
  }
  for (let x = width - 1; x >= 0; x--) {
    seam[x] = y;
    y += parent[x * overlap + y];
  }
  return seam;
}

function renderCornerCoded(exemplar) {
  const cornerColours = 2;
  const variantsPerCombination = ['v3', 'v4', 'v5'].includes(PROFILE) ? 8 : 3;
  const bank = new Map();
  for (let combination = 0; combination < 16; combination++) {
    const variants = [];
    for (let variant = 0; variant < variantsPerCombination; variant++) {
      variants.push(synthesizeCornerTile(exemplar, combination, variant, cornerColours));
    }
    bank.set(combination, variants);
  }
  lastCornerBank = bank;
  const output = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let tileY = 0; tileY < TILES_HIGH; tileY++) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX++) {
      const nw = cornerCode(tileX, tileY, cornerColours);
      const ne = cornerCode(tileX + 1, tileY, cornerColours);
      const sw = cornerCode(tileX, tileY + 1, cornerColours);
      const se = cornerCode(tileX + 1, tileY + 1, cornerColours);
      const combination = nw | (ne << 1) | (sw << 2) | (se << 3);
      const variants = bank.get(combination);
      const tile = variants[hash2(tileX, tileY, 0x3f84d5) % variants.length];
      blit(output, WIDTH, HEIGHT, tile, TILE, TILE, tileX * TILE, tileY * TILE);
    }
  }
  return output;
}

async function writeCornerAtlas(outputPath) {
  if (!lastCornerBank) throw new Error('Corner tile bank was not generated');
  const combinations = 16;
  const variants = lastCornerBank.get(0).length;
  const width = combinations * TILE;
  const height = variants * TILE;
  const atlas = Buffer.alloc(width * height * 3);
  for (let combination = 0; combination < combinations; combination++) {
    const tiles = lastCornerBank.get(combination);
    for (let variant = 0; variant < variants; variant++) {
      blit(atlas, width, height, tiles[variant], TILE, TILE, combination * TILE, variant * TILE);
    }
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await sharp(atlas, { raw: { width, height, channels: 3 } }).png().toFile(outputPath);
  fs.writeFileSync(`${outputPath}.json`, `${JSON.stringify({
    version: 1,
    method: 'corner-coded continuous-apron Wang tiles with constraint-matched quilting cores',
    source: path.relative(REPO, MASTER),
    profile: PROFILE,
    tileSize: TILE,
    cornerColours: 2,
    combinations,
    variants,
    layout: 'combination-columns, variant-rows',
    seed: WORLD_SEED,
  }, null, 2)}\n`);
}

function synthesizeCornerTile(exemplar, combination, variant, cornerColours) {
  const band = PROFILE === 'v1' ? 18 : 8;
  const continuousAprons = PROFILE === 'v4' || PROFILE === 'v5';
  const corners = [
    combination & 1,
    (combination >>> 1) & 1,
    (combination >>> 2) & 1,
    (combination >>> 3) & 1,
  ];
  const horizontal = new Map();
  const vertical = new Map();
  for (let a = 0; a < cornerColours; a++) {
    for (let b = 0; b < cornerColours; b++) {
      const key = a | (b << 1);
      horizontal.set(key, exemplarPatch(exemplar, TILE, continuousAprons ? band * 2 : band, hash2(a, b, 0x11c4e7)));
      vertical.set(key, exemplarPatch(exemplar, continuousAprons ? band * 2 : band, TILE, hash2(a, b, 0x9bb31d)));
    }
  }
  const cornerPatches = Array.from({ length: cornerColours }, (_, code) =>
    exemplarPatch(exemplar, continuousAprons ? band * 2 : band, continuousAprons ? band * 2 : band, hash2(code, 0, 0xf0719a)));
  const base = PROFILE === 'v5'
    ? chooseConstraintMatchedBase(exemplar, corners, horizontal, vertical, band, combination, variant)
    : exemplarPatch(exemplar, TILE, TILE, hash2(combination, variant, 0xa8f113));
  const output = Buffer.alloc(TILE * TILE * 3);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      const north = 1 - smoothstep01(y / band);
      const south = 1 - smoothstep01((TILE - 1 - y) / band);
      const west = 1 - smoothstep01(x / band);
      const east = 1 - smoothstep01((TILE - 1 - x) / band);
      const horizontalWeight = Math.max(north, south);
      const verticalWeight = Math.max(west, east);
      const cornerWeight = horizontalWeight > 0 && verticalWeight > 0
        ? Math.min(1, horizontalWeight + verticalWeight)
        : 0;
      const northPair = corners[0] | (corners[1] << 1);
      const southPair = corners[2] | (corners[3] << 1);
      const westPair = corners[0] | (corners[2] << 1);
      const eastPair = corners[1] | (corners[3] << 1);
      const horizontalPatch = north >= south ? horizontal.get(northPair) : horizontal.get(southPair);
      const verticalPatch = west >= east ? vertical.get(westPair) : vertical.get(eastPair);
      const horizontalDepth = north >= south ? y : TILE - 1 - y;
      const verticalDepth = west >= east ? x : TILE - 1 - x;
      const horizontalRow = continuousAprons
        ? (north >= south ? band + horizontalDepth : band - 1 - horizontalDepth)
        : horizontalDepth;
      const verticalColumn = continuousAprons
        ? (west >= east ? band + verticalDepth : band - 1 - verticalDepth)
        : verticalDepth;
      const horizontalSource = (horizontalRow * TILE + x) * 3;
      const verticalStride = continuousAprons ? band * 2 : band;
      const verticalSource = (y * verticalStride + verticalColumn) * 3;
      const cornerIndex = north >= south
        ? (west >= east ? 0 : 1)
        : (west >= east ? 2 : 3);
      const cornerDepthX = west >= east ? x : TILE - 1 - x;
      const cornerDepthY = north >= south ? y : TILE - 1 - y;
      const cornerX = continuousAprons
        ? (west >= east ? band + cornerDepthX : band - 1 - cornerDepthX)
        : cornerDepthX;
      const cornerY = continuousAprons
        ? (north >= south ? band + cornerDepthY : band - 1 - cornerDepthY)
        : cornerDepthY;
      const cornerStride = continuousAprons ? band * 2 : band;
      const cornerSource = (cornerY * cornerStride + cornerX) * 3;
      const target = (y * TILE + x) * 3;
      for (let channel = 0; channel < 3; channel++) {
        let value = SRGB_TO_LINEAR[base[target + channel]];
        if (horizontalWeight > 0) {
          value = lerp(value, SRGB_TO_LINEAR[horizontalPatch[horizontalSource + channel]], horizontalWeight);
        }
        if (verticalWeight > 0) {
          value = lerp(value, SRGB_TO_LINEAR[verticalPatch[verticalSource + channel]], verticalWeight);
        }
        if (cornerWeight > 0) {
          value = lerp(value, SRGB_TO_LINEAR[cornerPatches[corners[cornerIndex]][cornerSource + channel]], cornerWeight);
        }
        output[target + channel] = linearToSrgb(value);
      }
    }
  }
  return output;
}

/** Fill the corner-coded tile from the exemplar region whose border statistics
 * best match its shared two-sided aprons. This is the quilting step the first
 * Wang candidate omitted; without it, a valid edge can still read as a pale
 * corridor because its mean/structure differs from the random core. */
function chooseConstraintMatchedBase(exemplar, corners, horizontal, vertical, band, combination, variant) {
  const candidates = [];
  for (let candidate = 0; candidate < 64; candidate++) {
    const hash = hash2(combination * 97 + candidate, variant * 53 - candidate, 0x7f4a21);
    const patch = exemplarPatch(exemplar, TILE, TILE, hash);
    let score = 0;
    let samples = 0;
    const north = horizontal.get(corners[0] | (corners[1] << 1));
    const south = horizontal.get(corners[2] | (corners[3] << 1));
    const west = vertical.get(corners[0] | (corners[2] << 1));
    const east = vertical.get(corners[1] | (corners[3] << 1));
    for (let along = band; along < TILE - band; along += 2) {
      for (let depth = 0; depth < band; depth += 2) {
        const constraints = [
          [(depth * TILE + along) * 3, ((band + depth) * TILE + along) * 3, north],
          [((TILE - 1 - depth) * TILE + along) * 3, ((band - 1 - depth) * TILE + along) * 3, south],
          [(along * TILE + depth) * 3, (along * band * 2 + band + depth) * 3, west],
          [(along * TILE + TILE - 1 - depth) * 3, (along * band * 2 + band - 1 - depth) * 3, east],
        ];
        for (const [baseIndex, edgeIndex, edge] of constraints) {
          for (let channel = 0; channel < 3; channel++) {
            const delta = patch[baseIndex + channel] - edge[edgeIndex + channel];
            score += delta * delta;
          }
          samples++;
        }
      }
    }
    candidates.push({ patch, score: score / samples });
  }
  candidates.sort((a, b) => a.score - b.score);
  const best = candidates[0].score;
  const near = candidates.filter((candidate) => candidate.score <= best * 1.035 + 1);
  return near[hash2(combination, variant, 0x62a9d9) % near.length].patch;
}

function exemplarPatch(exemplar, width, height, hash) {
  const sourceX = hash % (exemplar.width - width + 1);
  const sourceY = (hash >>> 12) % (exemplar.height - height + 1);
  const output = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    const sourceStart = ((sourceY + y) * exemplar.width + sourceX) * 3;
    exemplar.data.copy(output, y * width * 3, sourceStart, sourceStart + width * 3);
  }
  return output;
}

function cornerCode(x, y, colours) {
  return hash2(x, y, 0xd1b54a) % colours;
}

function measure(data) {
  return {
    tileBoundaryRatio: Number(tileBoundaryRatio(data).toFixed(3)),
    uniqueTileSignatures: uniqueTileSignatures(data),
    maximumTileLagCorrelation: Number(maximumTileLagCorrelation(data).toFixed(3)),
    localContrast: Number(localContrast(data).toFixed(3)),
  };
}

function tileBoundaryRatio(data) {
  let boundaryTotal = 0;
  let boundarySamples = 0;
  let interiorTotal = 0;
  let interiorSamples = 0;
  for (let y = 0; y < HEIGHT; y += 3) {
    for (let x = 1; x < WIDTH; x++) {
      const delta = luminanceDelta(data, x - 1, y, x, y);
      if (x % TILE === 0) {
        boundaryTotal += delta;
        boundarySamples++;
      } else if (x % TILE === Math.floor(TILE / 2)) {
        interiorTotal += delta;
        interiorSamples++;
      }
    }
  }
  for (let y = 1; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x += 3) {
      const delta = luminanceDelta(data, x, y - 1, x, y);
      if (y % TILE === 0) {
        boundaryTotal += delta;
        boundarySamples++;
      } else if (y % TILE === Math.floor(TILE / 2)) {
        interiorTotal += delta;
        interiorSamples++;
      }
    }
  }
  return (boundaryTotal / boundarySamples) / Math.max(1e-9, interiorTotal / interiorSamples);
}

function uniqueTileSignatures(data) {
  const signatures = new Set();
  for (let tileY = 0; tileY < TILES_HIGH; tileY++) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX++) {
      const signature = Buffer.alloc(16 * 16);
      for (let sy = 0; sy < 16; sy++) {
        for (let sx = 0; sx < 16; sx++) {
          const x = tileX * TILE + Math.floor((sx + 0.5) * TILE / 16);
          const y = tileY * TILE + Math.floor((sy + 0.5) * TILE / 16);
          signature[sy * 16 + sx] = Math.round(luminance(data, x, y));
        }
      }
      signatures.add(createHash('sha1').update(signature).digest('hex'));
    }
  }
  return signatures.size;
}

function maximumTileLagCorrelation(data) {
  let maximum = -1;
  for (let lag = 1; lag <= 5; lag++) {
    maximum = Math.max(maximum, correlation(data, lag * TILE, 0), correlation(data, 0, lag * TILE));
  }
  return maximum;
}

function correlation(data, offsetX, offsetY) {
  let count = 0;
  let sumA = 0;
  let sumB = 0;
  let sumAA = 0;
  let sumBB = 0;
  let sumAB = 0;
  for (let y = 0; y + offsetY < HEIGHT; y += 4) {
    for (let x = 0; x + offsetX < WIDTH; x += 4) {
      const a = luminance(data, x, y);
      const b = luminance(data, x + offsetX, y + offsetY);
      sumA += a;
      sumB += b;
      sumAA += a * a;
      sumBB += b * b;
      sumAB += a * b;
      count++;
    }
  }
  const covariance = sumAB - sumA * sumB / count;
  const varianceA = sumAA - sumA * sumA / count;
  const varianceB = sumBB - sumB * sumB / count;
  return covariance / Math.max(1e-9, Math.sqrt(varianceA * varianceB));
}

function localContrast(data) {
  let total = 0;
  let count = 0;
  for (let y = 1; y < HEIGHT; y += 2) {
    for (let x = 1; x < WIDTH; x += 2) {
      const centre = luminance(data, x, y);
      const deltaX = centre - luminance(data, x - 1, y);
      const deltaY = centre - luminance(data, x, y - 1);
      total += deltaX * deltaX + deltaY * deltaY;
      count += 2;
    }
  }
  return Math.sqrt(total / count);
}

function luminanceDelta(data, ax, ay, bx, by) {
  return Math.abs(luminance(data, ax, ay) - luminance(data, bx, by));
}

function luminance(data, x, y) {
  const index = (y * WIDTH + x) * 3;
  return data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
}

async function writeComparison() {
  const thumbWidth = 720;
  const thumbHeight = Math.round(thumbWidth * HEIGHT / WIDTH);
  const labelHeight = 44;
  const gap = 12;
  const canvasWidth = thumbWidth * 2 + gap * 3;
  const rows = Math.ceil(CANDIDATES.length / 2);
  const canvasHeight = rows * (thumbHeight + labelHeight) + gap * (rows + 1);
  const composites = [];
  for (let index = 0; index < CANDIDATES.length; index++) {
    const name = CANDIDATES[index];
    const column = index % 2;
    const row = Math.floor(index / 2);
    const left = gap + column * (thumbWidth + gap);
    const top = gap + row * (thumbHeight + labelHeight + gap);
    const image = await sharp(path.join(OUTPUT, `${name}-source.png`))
      .resize(thumbWidth, thumbHeight, { kernel: sharp.kernel.lanczos3 })
      .png()
      .toBuffer();
    composites.push({ input: image, left, top: top + labelHeight });
    composites.push({
      input: Buffer.from(`<svg width="${thumbWidth}" height="${labelHeight}"><text x="10" y="30" fill="#f2e9dc" font-family="sans-serif" font-size="22">${name}</text></svg>`),
      left,
      top,
    });
  }
  await sharp({ create: { width: canvasWidth, height: canvasHeight, channels: 3, background: '#111118' } })
    .composite(composites)
    .png()
    .toFile(path.join(OUTPUT, 'comparison-source.png'));
}

async function writeAnsiCapture(name, sourcePath) {
  const pixelWidth = ANSI_COLS * 2;
  const pixelHeight = ANSI_ROWS * 4;
  const { data, info } = await sharp(sourcePath)
    .resize(pixelWidth, pixelHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const grid = Array.from({ length: info.height }, (_, y) =>
    Array.from({ length: info.width }, (_, x) => {
      const index = (y * info.width + x) * info.channels;
      return { r: data[index], g: data[index + 1], b: data[index + 2] };
    }));
  const cells = renderOctantGridCells(grid);
  const codec = new TerminalCodec({ headerRows: 0, terminalCols: ANSI_COLS, terminalRows: ANSI_ROWS });
  const frame = codec.encode(cells, { x: 0, y: 0, cellPixelWidth: 2, cellPixelHeight: 4 });
  fs.writeFileSync(path.join(OUTPUT, `${name}-ansi.bin`), `\x1b[?2026h${frame.output}\x1b[?2026l`);
}

function blit(target, targetWidth, targetHeight, source, sourceWidth, sourceHeight, left, top) {
  for (let y = 0; y < sourceHeight && top + y < targetHeight; y++) {
    const targetStart = ((top + y) * targetWidth + left) * 3;
    source.copy(target, targetStart, y * sourceWidth * 3, (y + 1) * sourceWidth * 3);
  }
}

function hash2(x, y, salt) {
  let value = Math.imul((x | 0) ^ WORLD_SEED ^ salt, 0x45d9f3b);
  value = Math.imul(value ^ (y | 0), 0x119de1f3);
  return (value ^ (value >>> 16)) >>> 0;
}

function mirrorIndex(value, size) {
  const period = (size - 1) * 2;
  const wrapped = ((value % period) + period) % period;
  return wrapped < size ? wrapped : period - wrapped;
}

function linearToSrgb(value) {
  const channel = Math.max(0, Math.min(1, value));
  const srgb = channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
  return Math.round(srgb * 255);
}

function smoothstep01(value) {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}
