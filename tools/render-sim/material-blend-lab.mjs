#!/usr/bin/env node
/**
 * Phase-0 / Track-1 fixed experiment: hard square terrain versus the first
 * continuous world-space material compositor. Outputs live on the mounted
 * research drive; no generated evidence is committed to the boot disk.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const PROFILE = process.argv[3] ?? 'v2';
if (!['v1', 'v2', 'v3', 'v4'].includes(PROFILE)) throw new Error(`Unknown material profile: ${PROFILE}`);
const CANDIDATE = `candidate-${PROFILE}`;
const OUTPUT = path.resolve(
  process.argv[2] ?? `/mnt/donto-data/donto-resources/maldoror/rendering-research/track-1-material-blending/${CANDIDATE}`,
);
const TILE = 96;
const TILES_WIDE = 12;
const TILES_HIGH = 8;
const WIDTH = TILE * TILES_WIDE;
const HEIGHT = TILE * TILES_HIGH;
const ANSI_COLS = 160;
const ANSI_ROWS = 54;

const { CanalMaterialCompositor } = await import(`${REPO}/packages/world/dist/index.js`);
const { renderOctantGridCells } = await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { TerminalCodec } = await import(`${REPO}/packages/render/dist/pixel/terminal-codec.js`);

fs.mkdirSync(OUTPUT, { recursive: true });

const terrainDir = path.join(REPO, 'assets/canal-town/terrain');
const water = await loadVariants(path.join(terrainDir, 'water-master.png'), 'water', false, 4, 'water');
const paving = await loadVariants(path.join(terrainDir, 'paving-stone-master.png'), 'paving', true, 4);
const edge = await loadVariants(path.join(terrainDir, 'curb-master.png'), 'edge', true, 4);
const compositor = new CanalMaterialCompositor({
  worldSeed: 8801799478018485n,
  water,
  paving,
  edge,
  maxCachedTiles: 96,
  variantPeriodTiles: 4,
  ...(PROFILE === 'v1'
    ? { materialTransitionWidth: 0.26, edgeBandWidth: 0.19, edgeStrength: 0.82, constructedEdgeDetail: false }
    : PROFILE === 'v2'
      ? { materialTransitionWidth: 0.09, edgeBandWidth: 0.085, edgeStrength: 0.94, constructedEdgeDetail: false }
      : PROFILE === 'v3'
        ? { materialTransitionWidth: 0.075, edgeBandWidth: 0.12, edgeStrength: 0.98, constructedEdgeDetail: true }
        : { materialTransitionWidth: 0.065, edgeBandWidth: 0.15, edgeStrength: 1, constructedEdgeDetail: true }),
});

// Two curved waterways make edge direction, corners, and a crossing visible.
// The classifier is deliberately discrete at tile centres: any sub-tile
// continuity in candidate-v1 comes from the compositor, not a flattering input.
const isWaterAt = (x, y) => {
  const vertical = Math.abs(x - (3.0 + Math.sin(y * 0.72) * 1.15)) <= 1.35;
  const horizontal = Math.abs(y - (4.3 + Math.sin(x * 0.58 + 0.8) * 0.85)) <= 0.8;
  return vertical || horizontal;
};

const baseline = composeTerrain(false);
const candidate = composeTerrain(true);
const overlays = await diagnosticOverlays();
await writeScene('baseline-source.png', baseline.rgb, overlays);
await writeScene(`${CANDIDATE}-source.png`, candidate.rgb, overlays);
await writeMask(`${CANDIDATE}-material-mask.png`, candidate.mask);
await writeComparison();
await writeAnsiCapture('baseline', path.join(OUTPUT, 'baseline-source.png'));
await writeAnsiCapture(CANDIDATE, path.join(OUTPUT, `${CANDIDATE}-source.png`));

const metrics = {
  experiment: `track-1-material-blending/${CANDIDATE}`,
  generatedAt: new Date().toISOString(),
  worldSeed: '8801799478018485',
  dimensions: { tiles: [TILES_WIDE, TILES_HIGH], sourcePixels: [WIDTH, HEIGHT], ansi: [ANSI_COLS, ANSI_ROWS] },
  method: {
    baseline: 'opaque square material tiles selected at tile centres',
    candidate: 'shared-corner coverage + world-space value-noise perturbation + linear-light texture/curb blending',
  },
  materialBoundaryMeanRgbDelta: {
    baseline: Number(materialBoundaryDelta(baseline.rgb).toFixed(2)),
    [CANDIDATE]: Number(materialBoundaryDelta(candidate.rgb).toFixed(2)),
  },
  compositor: compositor.getStats(),
  limitations: [
    `${CANDIDATE} only blends water, paving, and a curb material at transition tiles.`,
    'Flat material interiors still use the existing four square variants.',
    'Building contact, lighting, paths, garden/soil, and semantic LOD are held constant rather than solved.',
    'Metrics are diagnostic only; direct source and faithful-ANSI visual review is authoritative.',
  ],
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));

function composeTerrain(blended) {
  const rgb = Buffer.alloc(WIDTH * HEIGHT * 3);
  const mask = Buffer.alloc(WIDTH * HEIGHT);
  for (let tileY = 0; tileY < TILES_HIGH; tileY++) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX++) {
      const waterCell = isWaterAt(tileX, tileY);
      const transition = blended
        ? compositor.getTransitionTile(tileX, tileY, isWaterAt)
        : null;
      const tile = transition ?? pickTile(waterCell ? water : paving, tileX, tileY);
      for (let y = 0; y < TILE; y++) {
        for (let x = 0; x < TILE; x++) {
          const pixel = tile.pixels[y]?.[x] ?? { r: 0, g: 0, b: 0 };
          const targetX = tileX * TILE + x;
          const targetY = tileY * TILE + y;
          const target = (targetY * WIDTH + targetX) * 3;
          rgb[target] = pixel.r;
          rgb[target + 1] = pixel.g;
          rgb[target + 2] = pixel.b;
          mask[targetY * WIDTH + targetX] = tile.materialMask
            ? tile.materialMask[y]?.[x] ?? 0
            : Number(waterCell);
        }
      }
    }
  }
  return { rgb, mask };
}

function pickTile(tiles, x, y) {
  return tiles[hash2(x, y) % tiles.length];
}

function hash2(x, y) {
  let value = Math.imul(x ^ 0x9e3779b9, 0x85ebca6b);
  value = Math.imul(value ^ y, 0xc2b2ae35);
  return (value ^ (value >>> 16)) >>> 0;
}

async function loadVariants(file, prefix, walkable, count, material) {
  const metadata = await sharp(file).metadata();
  const columns = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / columns);
  const cropWidth = Math.floor(metadata.width / columns);
  const cropHeight = Math.floor(metadata.height / rows);
  const variants = [];
  for (let index = 0; index < count; index++) {
    const { data, info } = await sharp(file)
      .extract({
        left: (index % columns) * cropWidth,
        top: Math.floor(index / columns) * cropHeight,
        width: cropWidth,
        height: cropHeight,
      })
      .resize(TILE, TILE, { fit: 'cover', kernel: sharp.kernel.lanczos3 })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const pixels = Array.from({ length: info.height }, (_, y) =>
      Array.from({ length: info.width }, (_, x) => {
        const offset = (y * info.width + x) * info.channels;
        return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
      }),
    );
    variants.push({
      id: `${prefix}-${index}`,
      name: `${prefix}-${index}`,
      walkable,
      material,
      pixels,
    });
  }
  return variants;
}

async function diagnosticOverlays() {
  const specs = [
    ['bookshop.png', 255, 6.8, 3.0],
    ['ivy-cafe.png', 245, 8.9, 6.0],
    ['olive-tree.png', 165, 1.2, 2.0],
    ['flowering-shrub.png', 120, 6.1, 6.9],
    ['stone-bridge.png', 250, 2.1, 4.0],
    ['lily-cluster.png', 100, 3.4, 1.2],
  ];
  const spriteDir = path.join(REPO, 'assets/canal-town/sprites');
  return Promise.all(specs.map(async ([name, width, tileX, tileY]) => ({
    input: await sharp(path.join(spriteDir, name)).resize({ width, fit: 'inside' }).png().toBuffer(),
    left: Math.round(tileX * TILE),
    top: Math.round(tileY * TILE),
  })));
}

async function writeScene(name, rgb, overlays) {
  await sharp(rgb, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } })
    .composite(overlays)
    .png()
    .toFile(path.join(OUTPUT, name));
}

async function writeMask(name, mask) {
  await sharp(mask, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } })
    .linear(255)
    .png()
    .toFile(path.join(OUTPUT, name));
}

async function writeComparison() {
  const labelHeight = 54;
  const [baselineImage, candidateImage] = await Promise.all([
    sharp(path.join(OUTPUT, 'baseline-source.png')).extend({ top: labelHeight, background: '#111118' }).png().toBuffer(),
    sharp(path.join(OUTPUT, `${CANDIDATE}-source.png`)).extend({ top: labelHeight, background: '#111118' }).png().toBuffer(),
  ]);
  const labels = [
    { input: Buffer.from(`<svg width="${WIDTH}" height="${labelHeight}"><text x="24" y="37" fill="#f2e9dc" font-family="sans-serif" font-size="28">BASELINE — opaque square tiles</text></svg>`), left: 0, top: 0 },
    { input: Buffer.from(`<svg width="${WIDTH}" height="${labelHeight}"><text x="24" y="37" fill="#f2e9dc" font-family="sans-serif" font-size="28">${CANDIDATE.toUpperCase()} — continuous material field</text></svg>`), left: WIDTH, top: 0 },
  ];
  await sharp({
    create: { width: WIDTH * 2, height: HEIGHT + labelHeight, channels: 3, background: '#111118' },
  })
    .composite([
      { input: baselineImage, left: 0, top: 0 },
      { input: candidateImage, left: WIDTH, top: 0 },
      ...labels,
    ])
    .png()
    .toFile(path.join(OUTPUT, 'comparison-source.png'));
}

async function writeAnsiCapture(prefix, sourcePath) {
  const pixelWidth = ANSI_COLS * 2;
  const pixelHeight = ANSI_ROWS * 4;
  const { data, info } = await sharp(sourcePath)
    .resize(pixelWidth, pixelHeight, { fit: 'fill', kernel: sharp.kernel.lanczos3 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const grid = Array.from({ length: info.height }, (_, y) =>
    Array.from({ length: info.width }, (_, x) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset], g: data[offset + 1], b: data[offset + 2] };
    }),
  );
  const cells = renderOctantGridCells(grid);
  const codec = new TerminalCodec({ headerRows: 0, terminalCols: ANSI_COLS, terminalRows: ANSI_ROWS });
  const frame = codec.encode(cells, { x: 0, y: 0, cellPixelWidth: 2, cellPixelHeight: 4 });
  fs.writeFileSync(
    path.join(OUTPUT, `${prefix}-ansi.bin`),
    `\x1b[?2026h${frame.output}\x1b[?2026l`,
  );
}

function materialBoundaryDelta(rgb) {
  let total = 0;
  let samples = 0;
  for (let tileY = 0; tileY < TILES_HIGH; tileY++) {
    for (let tileX = 0; tileX < TILES_WIDE; tileX++) {
      if (tileX + 1 < TILES_WIDE && isWaterAt(tileX, tileY) !== isWaterAt(tileX + 1, tileY)) {
        const leftX = (tileX + 1) * TILE - 1;
        const rightX = leftX + 1;
        for (let y = tileY * TILE; y < (tileY + 1) * TILE; y++) {
          total += pixelDelta(rgb, leftX, y, rightX, y);
          samples++;
        }
      }
      if (tileY + 1 < TILES_HIGH && isWaterAt(tileX, tileY) !== isWaterAt(tileX, tileY + 1)) {
        const topY = (tileY + 1) * TILE - 1;
        const bottomY = topY + 1;
        for (let x = tileX * TILE; x < (tileX + 1) * TILE; x++) {
          total += pixelDelta(rgb, x, topY, x, bottomY);
          samples++;
        }
      }
    }
  }
  return samples === 0 ? 0 : total / samples;
}

function pixelDelta(rgb, ax, ay, bx, by) {
  const a = (ay * WIDTH + ax) * 3;
  const b = (by * WIDTH + bx) * 3;
  return Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2]);
}
