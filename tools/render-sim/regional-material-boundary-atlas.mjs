#!/usr/bin/env node
/**
 * Dynamically discover material ownership adjacencies emitted by the fixed
 * production world, then retain scale-authored crops and tile-seam metrics.
 * This is a diagnostic atlas: direct review remains authoritative.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadRegionalBiomeMaterialKit,
  loadRegionalRouteMaterialKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  RegionalMaterialCompositor,
  RegionalRouteField,
} from '../../packages/world/dist/index.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_MATERIAL_BOUNDARY_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/regional-boundaries-v154';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const SCAN_RADIUS = integerEnvironment('MALDOROR_MATERIAL_BOUNDARY_RADIUS', 384, 128, 1024);
const TEXTURE_SCALE_TILES = integerEnvironment('MALDOROR_MATERIAL_TEXTURE_SCALE', 7, 2, 48);
const CROP_WIDTH_TILES = 8;
const CROP_HEIGHT_TILES = 6;
const SCALES = [
  { id: 'near', resolution: 26 },
  { id: 'walking', resolution: 16 },
  { id: 'district', resolution: 8 },
];

fs.mkdirSync(OUTPUT, { recursive: true });
const [biomeKit, routeKit] = await Promise.all([
  loadRegionalBiomeMaterialKit(path.join(ROOT, 'assets/biomes/manifest.json')),
  loadRegionalRouteMaterialKit(path.join(ROOT, 'assets/routes/manifest.json')),
]);
const field = new BiomeWorldField(WORLD_SEED, {
  blockSize: 16,
  maxCachedBlocks: 96,
  arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
});
const routes = new RegionalRouteField(WORLD_SEED, field, {
  blockSize: 32,
  maxCachedBlocks: 192,
  maxCachedPaths: 768,
  maxCachedSites: 8192,
  pathStep: 4,
});
const compositor = new RegionalMaterialCompositor({
  worldSeed: WORLD_SEED,
  field,
  materials: biomeKit.materials,
  overviewMaterials: biomeKit.overviewMaterials,
  landmarkFabricMaterials: biomeKit.landmarkFabricMaterials,
  routes,
  routeMaterials: routeKit.routeMaterials,
  crossingMaterials: routeKit.crossingMaterials,
  routeSurfaceStyles: routeKit.routeSurfaceStyles,
  crossingSurfaceStyles: routeKit.crossingSurfaceStyles,
  maxCachedTiles: 4096,
  variantPeriodTiles: 5,
  textureScaleTiles: TEXTURE_SCALE_TILES,
  maxOutputResolution: Math.min(biomeKit.sourceTileSize, routeKit.sourceTileSize),
});

const discoveryStartedAt = performance.now();
const discovered = discoverAdjacencies();
const discoveryElapsedMs = performance.now() - discoveryStartedAt;
const pairDirectory = path.join(OUTPUT, 'pairs');
fs.mkdirSync(pairDirectory, { recursive: true });
const pairReports = [];
for (let index = 0; index < discovered.pairs.length; index++) {
  const pair = discovered.pairs[index];
  const pairId = `${String(index + 1).padStart(2, '0')}-${safeName(pair.key)}`;
  const scaleReports = [];
  for (const scale of SCALES) {
    const crop = composeCrop(pair, scale.resolution);
    const cropPath = path.join(pairDirectory, `${pairId}--${scale.id}.png`);
    await writeCrop(crop, cropPath, pair, scale);
    scaleReports.push({
      ...scale,
      path: cropPath,
      sha256: sha256File(cropPath),
      ...measureTileSeams(crop),
    });
  }
  const sheetPath = path.join(pairDirectory, `${pairId}--three-scale.png`);
  await composeScaleSheet(scaleReports, sheetPath, pair);
  pairReports.push({
    ...pair,
    pairId,
    scales: scaleReports,
    sheetPath,
    sheetSha256: sha256File(sheetPath),
  });
  console.log(JSON.stringify({
    event: 'material_boundary_pair_complete',
    index: index + 1,
    total: discovered.pairs.length,
    pair: pair.key,
    occurrences: pair.occurrences,
  }));
}

const atlasPath = path.join(OUTPUT, 'material-boundary-atlas.png');
await composeAtlas(pairReports, atlasPath);
const report = {
  schemaVersion: 1,
  worldSeed: String(WORLD_SEED),
  textureScaleTiles: TEXTURE_SCALE_TILES,
  scanBounds: [-SCAN_RADIUS, -SCAN_RADIUS, SCAN_RADIUS, SCAN_RADIUS],
  scannedTiles: discovered.scannedTiles,
  emittedClasses: discovered.classCounts,
  discoveredPairCount: pairReports.length,
  discoveryElapsedMs: Number(discoveryElapsedMs.toFixed(3)),
  totalElapsedMs: Number((performance.now() - discoveryStartedAt).toFixed(3)),
  cropDimensionsTiles: [CROP_WIDTH_TILES, CROP_HEIGHT_TILES],
  scales: SCALES,
  pairs: pairReports,
  atlasPath,
  atlasSha256: sha256File(atlasPath),
  fieldStats: field.getStats(),
  routeStats: routes.getStats(),
  compositorStats: compositor.getStats(),
  interpretation: [
    'Pairs are discovered from adjacent production ownership samples, not a hand-maintained pair list.',
    'Seam ratios compare RGB deltas exactly across world-tile edges with ordinary within-tile adjacent deltas.',
    'Metrics locate suspicious crops; they do not overrule direct near/walking/district review.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  discoveredPairCount: pairReports.length,
  atlasPath,
  atlasSha256: report.atlasSha256,
}, null, 2));

function discoverAdjacencies() {
  const pairs = new Map();
  const classCounts = new Map();
  let previousRow = null;
  let scannedTiles = 0;
  for (let y = -SCAN_RADIUS; y < SCAN_RADIUS; y++) {
    const row = new Array(SCAN_RADIUS * 2);
    let left = null;
    for (let x = -SCAN_RADIUS; x < SCAN_RADIUS; x++) {
      const current = materialOwnership(x, y);
      const rowIndex = x + SCAN_RADIUS;
      row[rowIndex] = current;
      scannedTiles++;
      classCounts.set(current.id, (classCounts.get(current.id) ?? 0) + 1);
      if (left && left.id !== current.id) retainPair(pairs, left, current, x - 0.5, y, 'vertical');
      const above = previousRow?.[rowIndex];
      if (above && above.id !== current.id) retainPair(pairs, above, current, x, y - 0.5, 'horizontal');
      left = current;
    }
    previousRow = row;
    if ((y + SCAN_RADIUS + 1) % 64 === 0) {
      console.log(JSON.stringify({
        event: 'material_boundary_scan_progress',
        rows: y + SCAN_RADIUS + 1,
        totalRows: SCAN_RADIUS * 2,
        discoveredPairs: pairs.size,
      }));
    }
  }
  return {
    scannedTiles,
    classCounts: Object.fromEntries([...classCounts.entries()].sort()),
    pairs: [...pairs.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

function materialOwnership(x, y) {
  const route = routes.sample(x, y);
  if (route.crossingKind) return { id: `crossing:${route.crossingKind}`, confidence: 1 };
  if (route.isRoute && route.routeKind) return { id: `route:${route.routeKind}`, confidence: 1 };
  const biome = field.sample(x, y);
  const strongest = Math.max(...biome.weights);
  return {
    id: biome.isWater ? `water:${biome.primary}` : `family:${biome.primary}`,
    confidence: strongest,
  };
}

function retainPair(pairs, first, second, x, y, orientation) {
  const classes = [first.id, second.id].sort();
  const key = classes.join('__');
  const score = Math.min(first.confidence, second.confidence);
  const retained = pairs.get(key);
  if (retained) {
    retained.occurrences++;
    if (score <= retained.score) return;
    Object.assign(retained, { x, y, orientation, score });
    return;
  }
  pairs.set(key, { key, classes, x, y, orientation, score, occurrences: 1 });
}

function composeCrop(pair, resolution) {
  const originX = Math.floor(pair.x - CROP_WIDTH_TILES / 2);
  const originY = Math.floor(pair.y - CROP_HEIGHT_TILES / 2);
  const width = CROP_WIDTH_TILES * resolution;
  const height = CROP_HEIGHT_TILES * resolution;
  const rgb = Buffer.alloc(width * height * 3);
  for (let tileY = 0; tileY < CROP_HEIGHT_TILES; tileY++) {
    for (let tileX = 0; tileX < CROP_WIDTH_TILES; tileX++) {
      const tile = compositor.getTileAtResolution(originX + tileX, originY + tileY, resolution);
      for (let pixelY = 0; pixelY < resolution; pixelY++) {
        for (let pixelX = 0; pixelX < resolution; pixelX++) {
          const pixel = tile.pixels[pixelY]?.[pixelX] ?? { r: 0, g: 0, b: 0 };
          const targetX = tileX * resolution + pixelX;
          const targetY = tileY * resolution + pixelY;
          const offset = (targetY * width + targetX) * 3;
          rgb[offset] = pixel.r;
          rgb[offset + 1] = pixel.g;
          rgb[offset + 2] = pixel.b;
        }
      }
    }
  }
  return { rgb, width, height, resolution, originX, originY };
}

async function writeCrop(crop, destination, pair, scale) {
  const labelHeight = 38;
  const label = `${pair.classes.join(' ↔ ')} · ${scale.id} ${scale.resolution}px/tile · (${pair.x}, ${pair.y})`;
  await sharp({
    create: {
      width: crop.width,
      height: crop.height + labelHeight,
      channels: 3,
      background: '#111118',
    },
  }).composite([
    { input: crop.rgb, raw: { width: crop.width, height: crop.height, channels: 3 }, top: labelHeight, left: 0 },
    { input: labelSvg(crop.width, labelHeight, label), top: 0, left: 0 },
  ]).png().toFile(destination);
}

function measureTileSeams(crop) {
  let seamDelta = 0;
  let seamSamples = 0;
  let interiorDelta = 0;
  let interiorSamples = 0;
  const signatures = [];
  for (let x = 1; x < crop.width; x++) {
    const isSeam = x % crop.resolution === 0;
    const signature = crypto.createHash('sha256');
    for (let y = 0; y < crop.height; y++) {
      const delta = pixelDelta(crop, x - 1, y, x, y);
      if (isSeam) {
        seamDelta += delta;
        seamSamples++;
        signature.update(Buffer.from([Math.min(255, Math.round(delta))]));
      } else {
        interiorDelta += delta;
        interiorSamples++;
      }
    }
    if (isSeam) signatures.push(signature.digest('hex'));
  }
  for (let y = 1; y < crop.height; y++) {
    const isSeam = y % crop.resolution === 0;
    const signature = crypto.createHash('sha256');
    for (let x = 0; x < crop.width; x++) {
      const delta = pixelDelta(crop, x, y - 1, x, y);
      if (isSeam) {
        seamDelta += delta;
        seamSamples++;
        signature.update(Buffer.from([Math.min(255, Math.round(delta))]));
      } else {
        interiorDelta += delta;
        interiorSamples++;
      }
    }
    if (isSeam) signatures.push(signature.digest('hex'));
  }
  const seamMean = seamDelta / Math.max(1, seamSamples);
  const interiorMean = interiorDelta / Math.max(1, interiorSamples);
  return {
    tileSeamMeanRgbDelta: Number(seamMean.toFixed(4)),
    interiorAdjacentMeanRgbDelta: Number(interiorMean.toFixed(4)),
    seamToInteriorRatio: Number((seamMean / Math.max(1e-9, interiorMean)).toFixed(4)),
    tileEdgeSignatureCount: signatures.length,
    repeatedTileEdgeSignatureRate: Number((
      1 - new Set(signatures).size / Math.max(1, signatures.length)
    ).toFixed(4)),
  };
}

function pixelDelta(crop, ax, ay, bx, by) {
  const a = (ay * crop.width + ax) * 3;
  const b = (by * crop.width + bx) * 3;
  return Math.abs(crop.rgb[a] - crop.rgb[b]) +
    Math.abs(crop.rgb[a + 1] - crop.rgb[b + 1]) +
    Math.abs(crop.rgb[a + 2] - crop.rgb[b + 2]);
}

async function composeScaleSheet(scales, destination, pair) {
  const panelWidth = 416;
  const panelHeight = 350;
  const composites = [];
  for (let index = 0; index < scales.length; index++) {
    const input = await sharp(scales[index].path)
      .resize(panelWidth, panelHeight, { fit: 'fill', kernel: sharp.kernel.nearest })
      .png().toBuffer();
    composites.push({ input, left: index * panelWidth, top: 0 });
  }
  await sharp({
    create: {
      width: panelWidth * scales.length,
      height: panelHeight,
      channels: 3,
      background: '#0d0d12',
    },
  }).composite(composites).png().toFile(destination);
}

async function composeAtlas(pairs, destination) {
  const panelWidth = 624;
  const panelHeight = 175;
  const columns = 2;
  const rows = Math.ceil(pairs.length / columns);
  const composites = [];
  for (let index = 0; index < pairs.length; index++) {
    const input = await sharp(pairs[index].sheetPath)
      .resize(panelWidth, panelHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
      .png().toBuffer();
    composites.push({
      input,
      left: (index % columns) * panelWidth,
      top: Math.floor(index / columns) * panelHeight,
    });
  }
  await sharp({
    create: {
      width: panelWidth * columns,
      height: panelHeight * rows,
      channels: 3,
      background: '#09090d',
    },
  }).composite(composites).png().toFile(destination);
}

function labelSvg(width, height, label) {
  const escaped = label.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <rect width="100%" height="100%" fill="#15131d"/>
    <text x="10" y="25" fill="#eee8dc" font-family="DejaVu Sans Mono, monospace" font-size="12">${escaped}</text>
  </svg>`);
}

function safeName(value) {
  return value.replaceAll(':', '-').replaceAll('__', '--').replace(/[^a-z0-9-]+/gi, '-').toLowerCase();
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function integerEnvironment(name, fallback, minimum, maximum) {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}
