#!/usr/bin/env node
/**
 * Isolate detailed-material reconstruction from geography and overlays.
 * The manifest and texture scale remain explicit so equal-density source
 * layouts can be compared without confusing a larger motif for less repeat.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  BIOME_FAMILIES,
  RegionalMaterialCompositor,
} from '../../packages/world/dist/index.js';
import { loadRegionalBiomeMaterialKit } from '../../apps/ssh-world/dist/game/biome-assets.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const MANIFEST_PATH = path.join(ROOT, 'assets/biomes/manifest.json');
const OUTPUT = process.env.MALDOROR_TEXTURE_HORIZON_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/texture-horizon-latest';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const TEXTURE_SCALE_TILES = integerEnvironment('MALDOROR_TEXTURE_HORIZON_SCALE', 7, 2, 48);
const VARIANT_PERIOD_TILES = integerEnvironment('MALDOROR_TEXTURE_HORIZON_VARIANT_PERIOD', 3, 2, 32);
const TEXTURE_RECONSTRUCTION = reconstructionEnvironment();
const WIDTH_TILES = 40;
const HEIGHT_TILES = 32;
const ORIGIN_X = -173;
const ORIGIN_Y = -91;
const SCALES = [
  { id: 'near', resolution: 26 },
  { id: 'walking', resolution: 16 },
];
const CORRELATION_LAGS_TILES = [5, 7, 10, 14, 20, 28];

fs.mkdirSync(OUTPUT, { recursive: true });
const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
const kit = await loadRegionalBiomeMaterialKit(MANIFEST_PATH);
const sourceCoveragePixels = Object.fromEntries(await Promise.all(
  manifest.materialMasters.map(async (entry) => {
    const metadata = await sharp(path.join(path.dirname(MANIFEST_PATH), entry.file)).metadata();
    const sourceWidth = metadata.width ?? 0;
    const sourceHeight = metadata.height ?? 0;
    if (sourceWidth === 0 || sourceHeight === 0) {
      throw new Error(`Unreadable material master: ${entry.file}`);
    }
    const columns = Math.ceil(Math.sqrt(entry.variants));
    const rows = Math.ceil(entry.variants / columns);
    return [entry.family, { x: sourceWidth / columns, y: sourceHeight / rows }];
  }),
));
const reports = [];
for (const [familyIndex, family] of BIOME_FAMILIES.entries()) {
  for (const scale of SCALES) {
    const startedAt = performance.now();
    const frame = renderFamily(kit, familyIndex, scale.resolution);
    const destination = path.join(OUTPUT, `${family}--${scale.id}.png`);
    await sharp(frame.rgb, {
      raw: { width: frame.width, height: frame.height, channels: 3 },
    }).png().toFile(destination);
    reports.push({
      family,
      ...scale,
      path: destination,
      sha256: sha256File(destination),
      elapsedMs: round(performance.now() - startedAt),
      ...analyseFrame(frame),
    });
    console.log(JSON.stringify({ event: 'texture_horizon_frame_complete', family, scale: scale.id }));
  }
}

const atlasPath = path.join(OUTPUT, 'texture-horizon-atlas.png');
await composeAtlas(reports, atlasPath);
const report = {
  schemaVersion: 1,
  worldSeed: String(WORLD_SEED),
  sourceManifest: path.relative(ROOT, MANIFEST_PATH),
  manifestSamplingTextureSize: manifest.samplingTextureSize,
  manifestVariantCounts: Object.fromEntries(
    manifest.materialMasters.map((entry) => [entry.family, entry.variants]),
  ),
  textureScaleTiles: TEXTURE_SCALE_TILES,
  variantPeriodTiles: VARIANT_PERIOD_TILES,
  textureReconstruction: TEXTURE_RECONSTRUCTION,
  sourceDensity: {
    explanation: 'Full-source pixels represented per world tile; equal values make horizon comparisons scale-fair.',
    values: Object.fromEntries(manifest.materialMasters.map((entry) => [
      entry.family,
      {
        x: round(sourceCoveragePixels[entry.family].x / TEXTURE_SCALE_TILES),
        y: round(sourceCoveragePixels[entry.family].y / TEXTURE_SCALE_TILES),
      },
    ])),
  },
  dimensions: { widthTiles: WIDTH_TILES, heightTiles: HEIGHT_TILES, originX: ORIGIN_X, originY: ORIGIN_Y },
  correlationLagsTiles: CORRELATION_LAGS_TILES,
  frames: reports,
  summary: SCALES.map((scale) => {
    const rows = reports.filter((row) => row.id === scale.id);
    return {
      scale: scale.id,
      frameCount: rows.length,
      elapsedMsMedian: round(median(rows.map((row) => row.elapsedMs))),
      luminanceStdMean: round(mean(rows.map((row) => row.luminanceStd))),
      seamToInteriorRatioMean: round(mean(rows.map((row) => row.seamToInteriorRatio))),
      repetitionPeakMean: round(mean(rows.map((row) => row.repetitionPeak))),
      reflectionP95Mean: round(mean(rows.map((row) => row.reflectionP95))),
    };
  }),
  atlasPath,
  atlasSha256: sha256File(atlasPath),
  interpretation: [
    'The lab holds world coordinates, authored source, source-pixel density, and output scales constant across intended A/B runs.',
    'Translation correlation is measured after subtracting a two-world-tile box mean so broad painterly value does not count as a repeated motif.',
    'Reflection p95 scans local vertical and horizontal axes over two-world-tile windows; it detects mirror quilts that translation-only correlation misses.',
    'Metrics are diagnostics; direct exact-pixel comparison remains authoritative.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, atlasPath, atlasSha256: report.atlasSha256, summary: report.summary }, null, 2));

function renderFamily(biomeKit, familyIndex, resolution) {
  const weights = BIOME_FAMILIES.map((_, index) => Number(index === familyIndex));
  const ecologicalIndex = familyIndex === 0 || familyIndex === 5 ? 3 : familyIndex;
  const sample = {
    weights,
    primary: BIOME_FAMILIES[familyIndex],
    ecologicalPrimary: BIOME_FAMILIES[ecologicalIndex],
    elevation: familyIndex === 4 ? 0.78 : 0.52,
    slope: familyIndex === 4 ? 0.06 : 0.01,
    waterDistance: familyIndex === 2 ? 0 : 18,
    isWater: familyIndex === 2,
    isRiver: false,
  };
  const compositor = new RegionalMaterialCompositor({
    worldSeed: WORLD_SEED,
    field: { sample: () => sample },
    materials: biomeKit.materials,
    maxCachedTiles: WIDTH_TILES * HEIGHT_TILES,
    variantPeriodTiles: VARIANT_PERIOD_TILES,
    textureScaleTiles: TEXTURE_SCALE_TILES,
    textureReconstruction: TEXTURE_RECONSTRUCTION,
    maxOutputResolution: biomeKit.sourceTileSize,
  });
  const width = WIDTH_TILES * resolution;
  const height = HEIGHT_TILES * resolution;
  const rgb = Buffer.alloc(width * height * 3);
  for (let tileY = 0; tileY < HEIGHT_TILES; tileY++) {
    for (let tileX = 0; tileX < WIDTH_TILES; tileX++) {
      const tile = compositor.getTileAtResolution(ORIGIN_X + tileX, ORIGIN_Y + tileY, resolution);
      for (let pixelY = 0; pixelY < resolution; pixelY++) {
        for (let pixelX = 0; pixelX < resolution; pixelX++) {
          const pixel = tile.pixels[pixelY][pixelX];
          const target = (((tileY * resolution + pixelY) * width) +
            tileX * resolution + pixelX) * 3;
          rgb[target] = pixel.r;
          rgb[target + 1] = pixel.g;
          rgb[target + 2] = pixel.b;
        }
      }
    }
  }
  return { rgb, width, height, resolution };
}

function analyseFrame(frame) {
  const luminance = new Float64Array(frame.width * frame.height);
  let sum = 0;
  for (let index = 0; index < luminance.length; index++) {
    const source = index * 3;
    const value = frame.rgb[source] * 0.2126 + frame.rgb[source + 1] * 0.7152 +
      frame.rgb[source + 2] * 0.0722;
    luminance[index] = value;
    sum += value;
  }
  const luminanceMean = sum / luminance.length;
  let variance = 0;
  let seamDelta = 0;
  let seamSamples = 0;
  let interiorDelta = 0;
  let interiorSamples = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const index = y * frame.width + x;
      variance += (luminance[index] - luminanceMean) ** 2;
      if (x > 0) accumulateDelta(Math.abs(luminance[index] - luminance[index - 1]), x % frame.resolution === 0);
      if (y > 0) accumulateDelta(Math.abs(luminance[index] - luminance[index - frame.width]), y % frame.resolution === 0);
    }
  }
  const detail = highPass(luminance, frame.width, frame.height, frame.resolution * 2);
  const correlations = Object.fromEntries(CORRELATION_LAGS_TILES.map((lag) => {
    const pixels = lag * frame.resolution;
    return [lag, round(Math.max(
      correlation(detail, frame.width, frame.height, pixels, 0),
      correlation(detail, frame.width, frame.height, 0, pixels),
    ))];
  }));
  const reflection = reflectionStatistics(detail, frame.width, frame.height, frame.resolution);
  return {
    luminanceStd: round(Math.sqrt(variance / luminance.length)),
    tileSeamMeanLuminanceDelta: round(seamDelta / Math.max(1, seamSamples)),
    interiorAdjacentMeanLuminanceDelta: round(interiorDelta / Math.max(1, interiorSamples)),
    seamToInteriorRatio: round(
      (seamDelta / Math.max(1, seamSamples)) /
      Math.max(1e-9, interiorDelta / Math.max(1, interiorSamples)),
    ),
    correlations,
    repetitionPeak: round(Math.max(...Object.values(correlations))),
    ...reflection,
  };

  function accumulateDelta(delta, seam) {
    if (seam) {
      seamDelta += delta;
      seamSamples++;
    } else {
      interiorDelta += delta;
      interiorSamples++;
    }
  }
}

function reflectionStatistics(values, width, height, resolution) {
  const radius = resolution * 2;
  const stride = Math.max(1, Math.floor(resolution / 4));
  const vertical = [];
  const horizontal = [];
  for (let axis = radius; axis < width - radius; axis += stride) {
    vertical.push(reflectionCorrelation(values, width, height, axis, radius, stride, true));
  }
  for (let axis = radius; axis < height - radius; axis += stride) {
    horizontal.push(reflectionCorrelation(values, width, height, axis, radius, stride, false));
  }
  const verticalP95 = percentile(vertical, 0.95);
  const horizontalP95 = percentile(horizontal, 0.95);
  return {
    reflectionWindowTiles: 2,
    verticalReflectionP95: round(verticalP95),
    horizontalReflectionP95: round(horizontalP95),
    reflectionP95: round(Math.max(verticalP95, horizontalP95)),
  };
}

function reflectionCorrelation(values, width, height, axis, radius, stride, vertical) {
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  if (vertical) {
    for (let y = 0; y < height; y += stride) {
      for (let distance = 0; distance < radius; distance += stride) {
        const left = values[y * width + axis - 1 - distance];
        const right = values[y * width + axis + distance];
        numerator += left * right;
        leftEnergy += left * left;
        rightEnergy += right * right;
      }
    }
  } else {
    for (let x = 0; x < width; x += stride) {
      for (let distance = 0; distance < radius; distance += stride) {
        const left = values[(axis - 1 - distance) * width + x];
        const right = values[(axis + distance) * width + x];
        numerator += left * right;
        leftEnergy += left * left;
        rightEnergy += right * right;
      }
    }
  }
  return numerator / Math.max(1e-9, Math.sqrt(leftEnergy * rightEnergy));
}

function highPass(values, width, height, radius) {
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += values[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] = integral[y * (width + 1) + x + 1] + row;
    }
  }
  const output = new Float64Array(values.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const top = Math.max(0, y - radius);
      const bottom = Math.min(height, y + radius + 1);
      const area = (right - left) * (bottom - top);
      const box = integral[bottom * (width + 1) + right] - integral[top * (width + 1) + right] -
        integral[bottom * (width + 1) + left] + integral[top * (width + 1) + left];
      output[y * width + x] = values[y * width + x] - box / area;
    }
  }
  return output;
}

function correlation(values, width, height, offsetX, offsetY) {
  if (offsetX >= width || offsetY >= height) return -1;
  let numerator = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  for (let y = 0; y < height - offsetY; y++) {
    for (let x = 0; x < width - offsetX; x++) {
      const left = values[y * width + x];
      const right = values[(y + offsetY) * width + x + offsetX];
      numerator += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }
  }
  return numerator / Math.max(1e-9, Math.sqrt(leftEnergy * rightEnergy));
}

async function composeAtlas(frames, destination) {
  const panelWidth = 520;
  const panelHeight = 300;
  const labelHeight = 34;
  const composites = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const image = await sharp(frame.path)
      .resize(panelWidth, panelHeight - labelHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png().toBuffer();
    const left = (index % SCALES.length) * panelWidth;
    const top = Math.floor(index / SCALES.length) * panelHeight;
    composites.push({ input: labelSvg(panelWidth, labelHeight, `${frame.family} · ${frame.id} ${frame.resolution}px/tile`), left, top });
    composites.push({ input: image, left, top: top + labelHeight });
  }
  await sharp({
    create: {
      width: panelWidth * SCALES.length,
      height: panelHeight * BIOME_FAMILIES.length,
      channels: 3,
      background: '#0d0d12',
    },
  }).composite(composites).png().toFile(destination);
}

function labelSvg(width, height, label) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#15131d"/>
    <text x="10" y="23" fill="#eee8dc" font-family="DejaVu Sans Mono, monospace" font-size="13">${label}</text>
  </svg>`);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function round(value) {
  return Number(value.toFixed(5));
}

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

function reconstructionEnvironment() {
  const value = process.env.MALDOROR_TEXTURE_HORIZON_RECONSTRUCTION ?? 'triangle-bounded-window';
  const allowed = [
    'square-bilinear',
    'triangle-bounded-window',
    'hex-contrast',
    'hex-laplacian',
    'cellular-semantic',
  ];
  if (!allowed.includes(value)) {
    throw new Error(`MALDOROR_TEXTURE_HORIZON_RECONSTRUCTION must be one of: ${allowed.join(', ')}`);
  }
  return value;
}
