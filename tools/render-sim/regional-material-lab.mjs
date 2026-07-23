/** Faithful source-to-octant lab for the six-family material compositor. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  RegionalMaterialCompositor,
} from '../../packages/world/dist/index.js';
import { renderOctantGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { OCTANT_CHARS } from '../../packages/render/dist/pixel/octant-chars.js';

const OUTPUT = process.env.MALDOROR_REGIONAL_MATERIAL_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/regional-v2';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const SOURCE_TILE_SIZE = 48;
const DISPLAY_TILE_SIZE = 16;
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
const FRAMES = [
  { name: 'arrival-transition', origin: [-2, -5] },
  { name: 'highland-ecotone', origin: [30, -5] },
  { name: 'regional-mosaic', origin: [310, -5] },
  { name: 'coast-ecotone', origin: [-10, 72] },
  { name: 'ruins-ecotone', origin: [90, -126] },
];

fs.mkdirSync(OUTPUT, { recursive: true });

async function loadTile(family, file) {
  const { data, info } = await sharp(file)
    .resize(SOURCE_TILE_SIZE, SOURCE_TILE_SIZE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = Array.from({ length: info.height }, (_, y) =>
    Array.from({ length: info.width }, (_, x) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    }));
  return { id: `regional-lab:${family}`, name: family, walkable: family !== 'coast', pixels, resolutions: { [String(SOURCE_TILE_SIZE)]: pixels } };
}

const materials = Object.fromEntries(await Promise.all(BIOME_FAMILIES.map(async (family) => [
  family,
  [await loadTile(family, MATERIAL_FILES[family])],
])));

function averageTilePixel(tile, displayX, displayY) {
  const sourceHeight = tile.pixels.length;
  const sourceWidth = tile.pixels[0].length;
  const left = Math.floor(displayX * sourceWidth / DISPLAY_TILE_SIZE);
  const right = Math.max(left + 1, Math.floor((displayX + 1) * sourceWidth / DISPLAY_TILE_SIZE));
  const top = Math.floor(displayY * sourceHeight / DISPLAY_TILE_SIZE);
  const bottom = Math.max(top + 1, Math.floor((displayY + 1) * sourceHeight / DISPLAY_TILE_SIZE));
  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      const pixel = tile.pixels[y][x];
      r += pixel.r;
      g += pixel.g;
      b += pixel.b;
      count++;
    }
  }
  return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
}

function renderFrame(origin) {
  const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 16 });
  const compositor = new RegionalMaterialCompositor({
    worldSeed: WORLD_SEED,
    field,
    materials,
    maxCachedTiles: 256,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
  });
  const colours = new Uint8Array(WIDTH * HEIGHT * 3);
  const tilesWide = Math.ceil(WIDTH / DISPLAY_TILE_SIZE);
  const tilesHigh = Math.ceil(HEIGHT / DISPLAY_TILE_SIZE);
  for (let tileY = 0; tileY < tilesHigh; tileY++) {
    for (let tileX = 0; tileX < tilesWide; tileX++) {
      const worldX = origin[0] + tileX;
      const worldY = origin[1] + tileY;
      const tile = compositor.getTile(worldX, worldY);
      for (let y = 0; y < DISPLAY_TILE_SIZE; y++) {
        const canvasY = tileY * DISPLAY_TILE_SIZE + y;
        if (canvasY >= HEIGHT) continue;
        for (let x = 0; x < DISPLAY_TILE_SIZE; x++) {
          const canvasX = tileX * DISPLAY_TILE_SIZE + x;
          if (canvasX >= WIDTH) continue;
          const pixel = averageTilePixel(tile, x, y);
          const offset = (canvasY * WIDTH + canvasX) * 3;
          colours[offset] = pixel.r;
          colours[offset + 1] = pixel.g;
          colours[offset + 2] = pixel.b;
        }
      }
    }
  }
  return { colours, fieldStats: field.getStats(), compositorStats: compositor.getStats() };
}

function boundaryMetrics(colours) {
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
      if (x % DISPLAY_TILE_SIZE === 0) {
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
      if (y % DISPLAY_TILE_SIZE === 0) {
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
  displayedPixelsPerWorldTile: DISPLAY_TILE_SIZE,
  frames: [],
};
for (const frame of FRAMES) {
  const startedAt = performance.now();
  const rendered = renderFrame(frame.origin);
  const sourcePath = path.join(OUTPUT, `${frame.name}-source.png`);
  const octantPath = path.join(OUTPUT, `${frame.name}-octant-160x44.png`);
  await writeSource(sourcePath, rendered.colours);
  await writeOctant(octantPath, rendered.colours);
  metrics.frames.push({
    ...frame,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    sha256: crypto.createHash('sha256').update(rendered.colours).digest('hex'),
    boundary: boundaryMetrics(rendered.colours),
    fieldStats: rendered.fieldStats,
    compositorStats: rendered.compositorStats,
  });
}
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));
