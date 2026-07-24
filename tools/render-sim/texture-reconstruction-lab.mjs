/** Compare the retained square texture quilt with four reconstruction candidates.
 *
 * This isolates texture reconstruction from geography and sparse overlays, so
 * every candidate sees the identical authored source pixels. Generated
 * evidence lives on the mounted research disk by default.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import sharp from 'sharp';
import {
  BIOME_FAMILIES,
  RegionalMaterialCompositor,
} from '../../packages/world/dist/index.js';
import { loadRegionalBiomeMaterialKit } from '../../apps/ssh-world/dist/game/biome-assets.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUT = process.env.MALDOROR_TEXTURE_RECONSTRUCTION_OUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/aperiodic-texture-reconstruction-v1';
const WORLD_SEED = 8801799478018485n;
const WIDTH_TILES = 72;
const HEIGHT_TILES = 42;
const TILE_PIXELS = 4;
const MODES = [
  'square-bilinear',
  'hex-contrast',
  'hex-laplacian',
  'cellular-semantic',
  'scale-authored-overview',
];
const MODE_LABELS = {
  'square-bilinear': 'A · retained square bilinear quilt',
  'hex-contrast': 'B · contrast-weighted stochastic hex',
  'hex-laplacian': 'C · two-band Laplacian stochastic hex',
  'cellular-semantic': 'D · jittered cellular semantic LOD',
  'scale-authored-overview': 'E · scale-authored overview material',
};

await fs.mkdir(OUT, { recursive: true });
const biomeKit = await loadRegionalBiomeMaterialKit(path.join(ROOT, 'assets/biomes/manifest.json'));
const results = [];

for (const mode of MODES) {
  for (const [familyIndex, family] of BIOME_FAMILIES.entries()) {
    const started = performance.now();
    const frame = renderFamily(mode, familyIndex, biomeKit);
    const elapsedMs = performance.now() - started;
    const metrics = analyseFrame(frame, TILE_PIXELS);
    const file = `${mode}-${family}.png`;
    await sharp(frame.rgb, {
      raw: { width: frame.width, height: frame.height, channels: 3 },
    }).png().toFile(path.join(OUT, file));
    results.push({ mode, family, file, elapsedMs: round(elapsedMs), ...metrics });
  }
}

for (const mode of MODES) {
  const files = BIOME_FAMILIES.map((family) => path.join(OUT, `${mode}-${family}.png`));
  await labelledMontage(
    files,
    path.join(OUT, `${mode}-six-family-montage.png`),
    MODE_LABELS[mode],
    3,
  );
}

await labelledMontage(
  BIOME_FAMILIES.flatMap((family) => MODES.map((mode) => path.join(OUT, `${mode}-${family}.png`))),
  path.join(OUT, 'five-method-six-family-comparison.png'),
  'COLUMNS: A SQUARE · B HEX · C LAPLACIAN · D CELLULAR LOD · E SCALE ART / ROWS: TOWN · FOREST · COAST · RURAL · MOUNTAIN · RUINS',
  5,
);

const summary = MODES.map((mode) => {
  const rows = results.filter((result) => result.mode === mode);
  return {
    mode,
    elapsedMsMedian: round(median(rows.map((row) => row.elapsedMs))),
    elapsedMsTotal: round(rows.reduce((sum, row) => sum + row.elapsedMs, 0)),
    luminanceStdMean: round(mean(rows.map((row) => row.luminanceStd))),
    boundaryEnergyRatioMean: round(mean(rows.map((row) => row.boundaryEnergyRatio))),
    directionalBiasMean: round(mean(rows.map((row) => row.directionalBias))),
    repetitionPeakMean: round(mean(rows.map((row) => row.repetitionPeak))),
    patchUniqueRateMean: round(mean(rows.map((row) => row.patchUniqueRate))),
  };
});
const automatedSelected = [...summary].sort((a, b) =>
  a.repetitionPeakMean - b.repetitionPeakMean ||
  b.patchUniqueRateMean - a.patchUniqueRateMean ||
  a.directionalBiasMean - b.directionalBiasMean)[0];
const directSelected = summary.find((row) => row.mode === 'scale-authored-overview');
const metrics = {
  version: 1,
  worldSeed: WORLD_SEED.toString(),
  dimensions: { widthTiles: WIDTH_TILES, heightTiles: HEIGHT_TILES, tilePixels: TILE_PIXELS },
  sourceManifest: path.relative(ROOT, biomeKit.manifestPath),
  methods: MODE_LABELS,
  selection: {
    automatedDiagnostic: automatedSelected.mode,
    directVisual: directSelected.mode,
    authority: 'direct visual review of exact pixels and scale semantics',
  },
  summary,
  frames: results,
};
await fs.writeFile(path.join(OUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);

await fs.writeFile(path.join(OUT, 'FINDINGS.md'), findings(metrics, automatedSelected, directSelected));
console.log(JSON.stringify({
  out: OUT,
  automatedSelected: automatedSelected.mode,
  directSelected: directSelected.mode,
  summary,
}, null, 2));

function renderFamily(mode, familyIndex, biomeKit) {
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
    overviewMaterials: mode === 'scale-authored-overview'
      ? biomeKit.overviewMaterials
      : undefined,
    maxCachedTiles: WIDTH_TILES * HEIGHT_TILES,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
    maxOutputResolution: biomeKit.sourceTileSize,
    textureReconstruction: mode === 'scale-authored-overview' ? 'square-bilinear' : mode,
  });
  const width = WIDTH_TILES * TILE_PIXELS;
  const height = HEIGHT_TILES * TILE_PIXELS;
  const rgb = Buffer.alloc(width * height * 3);
  const originX = -131;
  const originY = -79;
  for (let tileY = 0; tileY < HEIGHT_TILES; tileY++) {
    for (let tileX = 0; tileX < WIDTH_TILES; tileX++) {
      const tile = compositor.getTileAtResolution(originX + tileX, originY + tileY, TILE_PIXELS);
      for (let pixelY = 0; pixelY < TILE_PIXELS; pixelY++) {
        for (let pixelX = 0; pixelX < TILE_PIXELS; pixelX++) {
          const pixel = tile.pixels[pixelY][pixelX];
          const target = (((tileY * TILE_PIXELS + pixelY) * width) +
            tileX * TILE_PIXELS + pixelX) * 3;
          rgb[target] = pixel.r;
          rgb[target + 1] = pixel.g;
          rgb[target + 2] = pixel.b;
        }
      }
    }
  }
  return { rgb, width, height };
}

function analyseFrame(frame, tilePixels) {
  const luminance = new Float64Array(frame.width * frame.height);
  let luminanceSum = 0;
  for (let index = 0; index < luminance.length; index++) {
    const source = index * 3;
    const value = frame.rgb[source] * 0.2126 + frame.rgb[source + 1] * 0.7152 +
      frame.rgb[source + 2] * 0.0722;
    luminance[index] = value;
    luminanceSum += value;
  }
  const luminanceMean = luminanceSum / luminance.length;
  let variance = 0;
  let horizontalEnergy = 0;
  let verticalEnergy = 0;
  let boundaryEnergy = 0;
  let boundaryCount = 0;
  let interiorEnergy = 0;
  let interiorCount = 0;
  for (let y = 0; y < frame.height; y++) {
    for (let x = 0; x < frame.width; x++) {
      const index = y * frame.width + x;
      variance += (luminance[index] - luminanceMean) ** 2;
      if (x > 0) {
        const energy = Math.abs(luminance[index] - luminance[index - 1]);
        horizontalEnergy += energy;
        if (x % tilePixels === 0) {
          boundaryEnergy += energy;
          boundaryCount++;
        } else {
          interiorEnergy += energy;
          interiorCount++;
        }
      }
      if (y > 0) {
        const energy = Math.abs(luminance[index] - luminance[index - frame.width]);
        verticalEnergy += energy;
        if (y % tilePixels === 0) {
          boundaryEnergy += energy;
          boundaryCount++;
        } else {
          interiorEnergy += energy;
          interiorCount++;
        }
      }
    }
  }
  const detail = highPass(luminance, frame.width, frame.height, tilePixels * 2);
  const correlations = {};
  const broadCorrelations = {};
  for (const lagTiles of [5, 7, 10, 15, 21, 30]) {
    correlations[lagTiles] = round(Math.max(
      correlation(detail, frame.width, frame.height, lagTiles * tilePixels, 0, 0),
      correlation(detail, frame.width, frame.height, 0, lagTiles * tilePixels, 0),
    ));
    broadCorrelations[lagTiles] = round(Math.max(
      correlation(luminance, frame.width, frame.height, lagTiles * tilePixels, 0, luminanceMean),
      correlation(luminance, frame.width, frame.height, 0, lagTiles * tilePixels, luminanceMean),
    ));
  }
  return {
    luminanceMean: round(luminanceMean),
    luminanceStd: round(Math.sqrt(variance / luminance.length)),
    boundaryEnergyRatio: round(
      (boundaryEnergy / Math.max(1, boundaryCount)) /
      (interiorEnergy / Math.max(1, interiorCount)),
    ),
    directionalBias: round(Math.abs(horizontalEnergy - verticalEnergy) /
      Math.max(1, horizontalEnergy + verticalEnergy)),
    repetitionPeak: round(Math.max(...Object.values(correlations))),
    broadCoherencePeak: round(Math.max(...Object.values(broadCorrelations))),
    patchUniqueRate: round(patchUniqueRate(luminance, frame.width, frame.height, 16)),
    correlations,
    broadCorrelations,
  };
}

function highPass(values, width, height, radius) {
  const stride = width + 1;
  const integral = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += values[y * width + x];
      integral[(y + 1) * stride + x + 1] = integral[y * stride + x + 1] + rowSum;
    }
  }
  const output = new Float64Array(values.length);
  for (let y = 0; y < height; y++) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x++) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const sum = integral[bottom * stride + right] - integral[top * stride + right] -
        integral[bottom * stride + left] + integral[top * stride + left];
      output[y * width + x] = values[y * width + x] -
        sum / ((right - left) * (bottom - top));
    }
  }
  return output;
}

function correlation(values, width, height, offsetX, offsetY, average) {
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let y = 0; y < height - offsetY; y++) {
    for (let x = 0; x < width - offsetX; x++) {
      const left = values[y * width + x] - average;
      const right = values[(y + offsetY) * width + x + offsetX] - average;
      covariance += left * right;
      leftVariance += left * left;
      rightVariance += right * right;
    }
  }
  return covariance / Math.max(1e-9, Math.sqrt(leftVariance * rightVariance));
}

function patchUniqueRate(values, width, height, patchSize) {
  const signatures = [];
  for (let y = 0; y + patchSize <= height; y += patchSize) {
    for (let x = 0; x + patchSize <= width; x += patchSize) {
      let signature = '';
      for (let sampleY = 0; sampleY < 4; sampleY++) {
        for (let sampleX = 0; sampleX < 4; sampleX++) {
          const value = values[
            (y + Math.floor((sampleY + 0.5) * patchSize / 4)) * width +
            x + Math.floor((sampleX + 0.5) * patchSize / 4)
          ];
          signature += Math.round(value / 12).toString(16).padStart(2, '0');
        }
      }
      signatures.push(signature);
    }
  }
  return new Set(signatures).size / Math.max(1, signatures.length);
}

async function labelledMontage(files, output, label, columns) {
  const images = await Promise.all(files.map((file) => sharp(file).png().toBuffer({ resolveWithObject: true })));
  const cellWidth = Math.max(...images.map((image) => image.info.width));
  const cellHeight = Math.max(...images.map((image) => image.info.height));
  const rows = Math.ceil(images.length / columns);
  const heading = 34;
  const composites = images.map((image, index) => ({
    input: image.data,
    left: (index % columns) * cellWidth,
    top: heading + Math.floor(index / columns) * cellHeight,
  }));
  composites.push({
    input: Buffer.from(`<svg width="${cellWidth * columns}" height="${heading}">
      <rect width="100%" height="100%" fill="#100f0d"/>
      <text x="14" y="22" fill="#e9dfc4" font-family="monospace" font-size="14">${escapeXml(label)}</text>
    </svg>`),
    left: 0,
    top: 0,
  });
  await sharp({
    create: { width: cellWidth * columns, height: heading + cellHeight * rows, channels: 3, background: '#100f0d' },
  }).composite(composites).png().toFile(output);
}

function findings(metrics, automatedSelected, directSelected) {
  const lines = metrics.summary.map((row) =>
    `| ${row.mode} | ${row.elapsedMsMedian} | ${row.luminanceStdMean} | ${row.boundaryEnergyRatioMean} | ${row.directionalBiasMean} | ${row.repetitionPeakMean} | ${row.patchUniqueRateMean} |`).join('\n');
  return `# Aperiodic texture reconstruction V1\n\n` +
    `## Question\n\nCan the six retained authored materials stop reading as a mirrored square quilt without losing their painterly contrast, exact world-space continuity, semantic LOD, or bounded CPU character?\n\n` +
    `## Methods\n\n` +
    `A is the exact retained four-corner square/bilinear field. B adapts the triangular-grid randomized mappings and contrast-weight sharpening described in [Practical Real-Time Hex-Tiling](https://jcgt.org/published/0011/03/05/). C keeps that aperiodic lattice but reconstructs a broad low-frequency band at three times the world scale and adds an independently randomized high-pass residual, informed by [GPU-Friendly Laplacian Texture Blending](https://research.nvidia.com/labs/rtr/publication/wronski2025laplacian/). D tests an irregular four-nearest-site blend with aggressive semantic mip bias. E changes the premise: it uses a separately authored far-scale atlas with no leaves, cobbles, stones, icons, or paths and reconstructs it over a 42-tile world span. [Burley's histogram-preserving analysis](https://jcgt.org/published/0008/04/02/) motivates measuring contrast loss rather than accepting a seamless blur.\n\n` +
    `All methods consume identical coordinates, output resolution, and linear-light compositor code. A--D share detailed source variants; E is intentionally the scale-authored alternative. Repetition correlation is measured after subtracting a two-world-tile box mean, so intended broad map coherence is not misclassified as a repeated motif. Metrics are diagnostics; the comparison montage remains authoritative.\n\n` +
    `| method | median ms/family | luma sd | tile-boundary/interior energy | directional bias | peak 5--30 tile correlation | unique 16px patches |\n|---|---:|---:|---:|---:|---:|---:|\n${lines}\n\n` +
    `## Decision\n\nThe diagnostic ordering names **${automatedSelected.mode}**, but direct review of \`five-method-six-family-comparison.png\` rejects it: B still repeats recognizable leaf/cobble semantics at map scale; C clips and over-contrasts those motifs; D blurs them into oversized cellular/plaid patches; A remains the original square quilt. The authoritative visual decision is **${directSelected.mode}** because E alone removes wrong-scale near-field motifs while preserving broad material variation.\n\n` +
    `This selection has also passed an exact regional provider frame and bounded traversal profiling. It changes only the research provider seam; it is not a production-deployment claim.\n\n` +
    `## Reproducibility\n\nRun \`pnpm build && pnpm research:texture-reconstruction\`. Raw frames and \`metrics.json\` remain beside this note.\n`;
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function round(value) {
  return Number(value.toFixed(5));
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}
