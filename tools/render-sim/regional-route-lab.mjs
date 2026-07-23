/** Research renderer for the coordinate-stable terrain-aware route field. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  RegionalRouteField,
} from '../../packages/world/dist/index.js';

const OUTPUT = process.env.MALDOROR_ROUTE_LAB_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-6-route-topology/regional-route-v4';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const WORLD_WIDTH = 320;
const WORLD_HEIGHT = 240;
const SCALE = 2;
const FRAMES = [
  { name: 'arrival-network', origin: [-160, -120] },
  { name: 'coastal-crossings', origin: [-64, 32] },
  { name: 'highland-roads', origin: [160, -80] },
  { name: 'ruin-country', origin: [-16, -232] },
];
const PALETTE = [
  [116, 92, 72],
  [43, 74, 51],
  [52, 91, 96],
  [111, 101, 64],
  [91, 88, 86],
  [92, 69, 61],
];

fs.mkdirSync(OUTPUT, { recursive: true });

function blendBiome(sample) {
  const result = [0, 0, 0];
  for (let family = 0; family < BIOME_FAMILIES.length; family++) {
    for (let channel = 0; channel < 3; channel++) {
      result[channel] += PALETTE[family][channel] * sample.weights[family];
    }
  }
  const relief = 0.76 + sample.elevation * 0.42 - Math.min(0.16, sample.slope * 2.2);
  return result.map((channel) => Math.round(Math.max(0, Math.min(255, channel * relief))));
}

function routeColour(sample) {
  if (sample.crossingKind === 'ferry') return [89, 158, 173];
  if (sample.crossingKind === 'bridge') return [194, 216, 218];
  if (sample.crossingKind === 'ford') return [151, 186, 177];
  if (sample.routeKind === 'arterial') return [225, 176, 91];
  if (sample.routeKind === 'local-road') return [203, 176, 129];
  return [142, 128, 94];
}

function landmarkColour(kind) {
  if (kind === 'arrival') return [255, 84, 137];
  if (kind === 'settlement') return [248, 216, 116];
  if (kind === 'ruin') return [214, 126, 196];
  return [173, 200, 143];
}

async function renderFrame(frame) {
  const biomes = new BiomeWorldField(WORLD_SEED, { blockSize: 32, maxCachedBlocks: 96 });
  const routes = new RegionalRouteField(WORLD_SEED, biomes, {
    blockSize: 32,
    maxCachedBlocks: 128,
    maxCachedPaths: 512,
    pathStep: 4,
  });
  const width = WORLD_WIDTH * SCALE;
  const height = WORLD_HEIGHT * SCALE;
  const pixels = Buffer.alloc(width * height * 3);
  const metrics = {
    routeTiles: 0,
    crossingTiles: 0,
    crossingKinds: {},
    routeKinds: {},
    landmarks: {},
  };
  const startedAt = performance.now();
  for (let worldRow = 0; worldRow < WORLD_HEIGHT; worldRow++) {
    for (let worldColumn = 0; worldColumn < WORLD_WIDTH; worldColumn++) {
      const worldX = frame.origin[0] + worldColumn;
      const worldY = frame.origin[1] + worldRow;
      const biome = biomes.sample(worldX, worldY);
      const route = routes.sample(worldX, worldY);
      let colour = blendBiome(biome);
      if (route.isRoute) {
        const ferryGap = route.crossingKind === 'ferry' &&
          Math.abs((worldX + worldY) % 7) >= 3;
        if (!ferryGap) colour = routeColour(route);
        metrics.routeTiles++;
        metrics.routeKinds[route.routeKind] = (metrics.routeKinds[route.routeKind] ?? 0) + 1;
      }
      if (route.isCrossing) {
        metrics.crossingTiles++;
        metrics.crossingKinds[route.crossingKind] = (metrics.crossingKinds[route.crossingKind] ?? 0) + 1;
      }
      if (route.landmarkKind && route.landmarkDistance <= 2.2) {
        colour = landmarkColour(route.landmarkKind);
        metrics.landmarks[route.landmarkKind] = (metrics.landmarks[route.landmarkKind] ?? 0) + 1;
      }
      for (let offsetY = 0; offsetY < SCALE; offsetY++) {
        for (let offsetX = 0; offsetX < SCALE; offsetX++) {
          const x = worldColumn * SCALE + offsetX;
          const y = worldRow * SCALE + offsetY;
          const index = (y * width + x) * 3;
          pixels[index] = colour[0];
          pixels[index + 1] = colour[1];
          pixels[index + 2] = colour[2];
        }
      }
    }
  }
  const filename = path.join(OUTPUT, `${frame.name}.png`);
  await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toFile(filename);
  return {
    ...frame,
    filename,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    routeCoverage: Number((metrics.routeTiles / (WORLD_WIDTH * WORLD_HEIGHT)).toFixed(4)),
    ...metrics,
    fieldStats: biomes.getStats(),
    routeStats: routes.getStats(),
  };
}

const frames = [];
for (const frame of FRAMES) {
  const result = await renderFrame(frame);
  frames.push(result);
  console.log(JSON.stringify(result));
}

const panelWidth = WORLD_WIDTH * SCALE;
const panelHeight = WORLD_HEIGHT * SCALE;
const labelHeight = 42;
const atlasComposites = [];
for (let index = 0; index < frames.length; index++) {
  const frame = frames[index];
  const left = (index % 2) * panelWidth;
  const top = Math.floor(index / 2) * (panelHeight + labelHeight);
  atlasComposites.push({ input: frame.filename, left, top: top + labelHeight });
  const label = `${frame.name.toUpperCase().replaceAll('-', ' ')} · ${(frame.routeCoverage * 100).toFixed(2)}% ROUTE`;
  atlasComposites.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${panelWidth}" height="${labelHeight}">` +
      `<rect width="100%" height="100%" fill="#0d0d12"/>` +
      `<text x="${panelWidth / 2}" y="28" fill="#f3eee7" text-anchor="middle" ` +
      `font-family="DejaVu Sans Mono, monospace" font-size="17">${label}</text></svg>`,
    ),
    left,
    top,
  });
}
await sharp({
  create: {
    width: panelWidth * 2,
    height: (panelHeight + labelHeight) * 2,
    channels: 3,
    background: '#0d0d12',
  },
}).composite(atlasComposites).png().toFile(path.join(OUTPUT, 'ATLAS.png'));

const exactFineBiomes = new BiomeWorldField(WORLD_SEED, { blockSize: 16 });
const exactCoarseBiomes = new BiomeWorldField(WORLD_SEED, { blockSize: 48 });
const exactFine = new RegionalRouteField(WORLD_SEED, exactFineBiomes, { blockSize: 16, pathStep: 4 });
const exactCoarse = new RegionalRouteField(WORLD_SEED, exactCoarseBiomes, { blockSize: 48, pathStep: 4 });
const probes = [[0, 0], [47, -31], [-129, 77], [288, 105], [91, -226]];
const exactCoordinateStability = probes.every(([x, y]) =>
  JSON.stringify(exactFine.sample(x, y)) === JSON.stringify(exactCoarse.sample(x, y)));
const report = {
  worldSeed: String(WORLD_SEED),
  worldDimensions: [WORLD_WIDTH, WORLD_HEIGHT],
  imageScale: SCALE,
  exactCoordinateStability,
  probes,
  frames,
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, exactCoordinateStability }, null, 2));
