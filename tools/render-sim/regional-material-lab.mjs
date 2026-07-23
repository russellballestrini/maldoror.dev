/** Faithful source-to-octant lab for the six-family material compositor. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  RegionalMaterialCompositor,
  RegionalRouteField,
} from '../../packages/world/dist/index.js';
import { renderOctantGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { OCTANT_CHARS } from '../../packages/render/dist/pixel/octant-chars.js';

const OUTPUT = process.env.MALDOROR_REGIONAL_MATERIAL_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/regional-v3-routes';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const SOURCE_TILE_SIZE = Number.parseInt(process.env.MALDOROR_REGIONAL_SOURCE_TILE_SIZE ?? '48', 10);
const WIDTH = 320;
const HEIGHT = 176;
const MATERIAL_FILES = {
  'canal-town': 'assets/biomes/materials/canal-town-paving-master-v1.png',
  forest: 'assets/biomes/materials/forest-floor-master-v1.png',
  coast: 'assets/biomes/materials/coast-marsh-master-v1.png',
  rural: 'assets/biomes/materials/rural-orchard-master-v1.png',
  mountain: 'assets/biomes/materials/mountain-highland-master-v1.png',
  ruins: 'assets/biomes/materials/ancient-ruins-master-v1.png',
};
const ROUTE_MATERIAL_FILES = {
  arterial: 'assets/routes/materials/arterial-stone-master-v1.png',
  'local-road': 'assets/routes/materials/local-earth-master-v1.png',
  trail: 'assets/routes/materials/trail-floor-master-v1.png',
};
const CROSSING_MATERIAL_FILES = {
  bridge: 'assets/routes/materials/bridge-timber-master-v1.png',
};
const FRAME_FILTER = process.env.MALDOROR_REGIONAL_FRAME;
const FRAMES = [
  { name: 'arrival-material-detail', origin: [-10, -5], displayTileSize: 16 },
  { name: 'bridge-material-detail', origin: [249, -75], displayTileSize: 16 },
  { name: 'arrival-route-overview', origin: [-40, -22], displayTileSize: 4, overviewLod: true },
  { name: 'coastal-route-overview', origin: [-64, 32], displayTileSize: 4, overviewLod: true },
  { name: 'highland-route-overview', origin: [160, -80], displayTileSize: 4, overviewLod: true },
  { name: 'ruins-route-overview', origin: [-16, -232], displayTileSize: 4, overviewLod: true },
].filter((frame) => !FRAME_FILTER || frame.name === FRAME_FILTER);
if (FRAMES.length === 0) throw new Error(`Unknown regional material frame: ${FRAME_FILTER}`);

fs.mkdirSync(OUTPUT, { recursive: true });

async function loadTiles(family, file) {
  const metadata = await sharp(file).metadata();
  const cropWidth = Math.floor(metadata.width / 2);
  const cropHeight = Math.floor(metadata.height / 2);
  return Promise.all(Array.from({ length: 4 }, async (_, variant) => {
    const { data, info } = await sharp(file)
      .extract({
        left: (variant % 2) * cropWidth,
        top: Math.floor(variant / 2) * cropHeight,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(SOURCE_TILE_SIZE, SOURCE_TILE_SIZE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = Array.from({ length: info.height }, (_, y) =>
      Array.from({ length: info.width }, (_, x) => {
        const offset = (y * info.width + x) * info.channels;
        return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      }));
    return {
      id: `regional-lab:${family}:v${variant + 1}`,
      name: `${family} v${variant + 1}`,
      walkable: family !== 'coast',
      pixels,
      resolutions: { [String(SOURCE_TILE_SIZE)]: pixels },
    };
  }));
}

const materials = Object.fromEntries(await Promise.all(BIOME_FAMILIES.map(async (family) => [
  family,
  await loadTiles(family, MATERIAL_FILES[family]),
])));
const routeMaterials = Object.fromEntries(await Promise.all(Object.entries(ROUTE_MATERIAL_FILES).map(async ([kind, file]) => [
  kind,
  await loadTiles(`route:${kind}`, file),
])));
const crossingMaterials = Object.fromEntries(await Promise.all(Object.entries(CROSSING_MATERIAL_FILES).map(async ([kind, file]) => [
  kind,
  await loadTiles(`crossing:${kind}`, file),
])));

function averageTilePixel(pixels, displayX, displayY, displayTileSize) {
  const sourceHeight = pixels.length;
  const sourceWidth = pixels[0].length;
  const left = Math.floor(displayX * sourceWidth / displayTileSize);
  const right = Math.max(left + 1, Math.floor((displayX + 1) * sourceWidth / displayTileSize));
  const top = Math.floor(displayY * sourceHeight / displayTileSize);
  const bottom = Math.max(top + 1, Math.floor((displayY + 1) * sourceHeight / displayTileSize));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const pixel = pixels[y][x];
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
      count++;
    }
  }
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function renderFrame(frame) {
  const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 16 });
  const routes = new RegionalRouteField(WORLD_SEED, field, {
    blockSize: 32,
    maxCachedBlocks: 128,
    maxCachedPaths: 512,
    pathStep: 4,
  });
  const compositor = new RegionalMaterialCompositor({
    worldSeed: WORLD_SEED,
    field,
    materials,
    routes,
    routeMaterials,
    crossingMaterials,
    maxCachedTiles: 256,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
  });
  const colours = new Uint8Array(WIDTH * HEIGHT * 3);
  const tilesWide = Math.ceil(WIDTH / frame.displayTileSize);
  const tilesHigh = Math.ceil(HEIGHT / frame.displayTileSize);
  let routeTiles = 0;
  let bridgeTiles = 0;
  let ferryTiles = 0;
  for (let tileY = 0; tileY < tilesHigh; tileY++) {
    for (let tileX = 0; tileX < tilesWide; tileX++) {
      const worldX = frame.origin[0] + tileX;
      const worldY = frame.origin[1] + tileY;
      const tile = compositor.getTile(worldX, worldY);
      const tilePixels = frame.overviewLod ? (tile.resolutions['26'] ?? tile.pixels) : tile.pixels;
      const route = routes.sample(worldX, worldY);
      if (route.isRoute) routeTiles++;
      if (route.crossingKind === 'bridge') bridgeTiles++;
      if (route.crossingKind === 'ferry') ferryTiles++;
      for (let y = 0; y < frame.displayTileSize; y++) {
        const canvasY = tileY * frame.displayTileSize + y;
        if (canvasY >= HEIGHT) continue;
        for (let x = 0; x < frame.displayTileSize; x++) {
          const canvasX = tileX * frame.displayTileSize + x;
          if (canvasX >= WIDTH) continue;
          const pixel = averageTilePixel(tilePixels, x, y, frame.displayTileSize);
          const offset = (canvasY * WIDTH + canvasX) * 3;
          colours[offset] = pixel.r;
          colours[offset + 1] = pixel.g;
          colours[offset + 2] = pixel.b;
        }
      }
    }
  }
  return {
    colours,
    routeTiles,
    bridgeTiles,
    ferryTiles,
    fieldStats: field.getStats(),
    routeStats: routes.getStats(),
    compositorStats: compositor.getStats(),
  };
}

function boundaryMetrics(colours, displayTileSize) {
  let boundaryTotal = 0;
  let boundaryCount = 0;
  let interiorTotal = 0;
  let interiorCount = 0;
  const jump = (a, b) => Math.hypot(
    colours[a] - colours[b],
    colours[a + 1] - colours[b + 1],
    colours[a + 2] - colours[b + 2],
  );
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 1; x < WIDTH; x++) {
      const value = jump((y * WIDTH + x - 1) * 3, (y * WIDTH + x) * 3);
      if (x % displayTileSize === 0) {
        boundaryTotal += value;
        boundaryCount++;
      } else {
        interiorTotal += value;
        interiorCount++;
      }
    }
  }
  for (let y = 1; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const value = jump(((y - 1) * WIDTH + x) * 3, (y * WIDTH + x) * 3);
      if (y % displayTileSize === 0) {
        boundaryTotal += value;
        boundaryCount++;
      } else {
        interiorTotal += value;
        interiorCount++;
      }
    }
  }
  const boundaryMean = boundaryTotal / boundaryCount;
  const interiorMean = interiorTotal / interiorCount;
  return {
    meanTileBoundaryJump: Number(boundaryMean.toFixed(3)),
    meanInteriorAdjacentJump: Number(interiorMean.toFixed(3)),
    boundaryToInteriorRatio: Number((boundaryMean / interiorMean).toFixed(3)),
  };
}

async function writeSource(filename, colours) {
  await sharp(colours, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .png()
    .toFile(filename);
}

async function writeOctant(filename, colours) {
  const grid = Array.from({ length: HEIGHT }, (_, y) =>
    Array.from({ length: WIDTH }, (_, x) => {
      const offset = (y * WIDTH + x) * 3;
      return { r: colours[offset], g: colours[offset + 1], b: colours[offset + 2] };
    }));
  const cells = renderOctantGridCells(grid);
  const cellWidth = 9;
  const cellHeight = 18;
  const width = cells[0].length * cellWidth;
  const height = cells.length * cellHeight;
  const image = Buffer.alloc(width * height * 3);
  const lookup = new Map();
  OCTANT_CHARS.forEach((character, pattern) => {
    const code = character.codePointAt(0);
    if (!lookup.has(code)) lookup.set(code, pattern);
  });
  const fill = (x0, y0, w, h, colour) => {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const offset = (y * width + x) * 3;
        image[offset] = colour.r;
        image[offset + 1] = colour.g;
        image[offset + 2] = colour.b;
      }
    }
  };
  for (let y = 0; y < cells.length; y++) {
    for (let x = 0; x < cells[y].length; x++) {
      const cell = cells[y][x];
      const foreground = cell.fgColor ?? { r: 15, g: 15, b: 20 };
      const background = cell.bgColor ?? { r: 15, g: 15, b: 20 };
      fill(x * cellWidth, y * cellHeight, cellWidth, cellHeight, background);
      const pattern = lookup.get(cell.char.codePointAt(0)) ?? 0;
      for (let row = 0; row < 4; row++) {
        for (let column = 0; column < 2; column++) {
          if (!(pattern & (1 << (row * 2 + column)))) continue;
          const x0 = Math.round(column * cellWidth / 2);
          const x1 = Math.round((column + 1) * cellWidth / 2);
          const y0 = Math.round(row * cellHeight / 4);
          const y1 = Math.round((row + 1) * cellHeight / 4);
          fill(x * cellWidth + x0, y * cellHeight + y0, x1 - x0, y1 - y0, foreground);
        }
      }
    }
  }
  await sharp(image, { raw: { width, height, channels: 3 } }).png().toFile(filename);
}

const metrics = {
  worldSeed: String(WORLD_SEED),
  sourceDimensions: [WIDTH, HEIGHT],
  terminalDimensions: [WIDTH / 2, HEIGHT / 4],
  sourceTileSize: SOURCE_TILE_SIZE,
  frames: [],
};
for (const frame of FRAMES) {
  const startedAt = performance.now();
  const rendered = renderFrame(frame);
  const sourcePath = path.join(OUTPUT, `${frame.name}-source.png`);
  const octantPath = path.join(OUTPUT, `${frame.name}-octant-160x44.png`);
  await writeSource(sourcePath, rendered.colours);
  await writeOctant(octantPath, rendered.colours);
  metrics.frames.push({
    ...frame,
    displayedPixelsPerWorldTile: frame.displayTileSize,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    sha256: crypto.createHash('sha256').update(rendered.colours).digest('hex'),
    boundary: boundaryMetrics(rendered.colours, frame.displayTileSize),
    routeTiles: rendered.routeTiles,
    bridgeTiles: rendered.bridgeTiles,
    ferryTiles: rendered.ferryTiles,
    fieldStats: rendered.fieldStats,
    routeStats: rendered.routeStats,
    compositorStats: rendered.compositorStats,
  });
}
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));
