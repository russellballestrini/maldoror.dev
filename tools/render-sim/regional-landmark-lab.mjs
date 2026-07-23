/** Faithful production-provider lab for route-site regional landmarks. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalLandmarkKit,
  loadRegionalRouteMaterialKit,
  loadRegionalRouteContactKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  BiomeWorldField,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldTileProvider,
} from '../../packages/world/dist/index.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { renderOctantGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { OCTANT_CHARS } from '../../packages/render/dist/pixel/octant-chars.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_REGIONAL_LANDMARK_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-4-world-composition/regional-landmark-v2-alpha';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const WIDTH = 320;
const HEIGHT = 176;
const FRAME_FILTER = process.env.MALDOROR_REGIONAL_LANDMARK_FRAME;
let FRAMES = [
  { name: 'arrival-landmark-walking', centre: [0, 0], displayTileSize: 16 },
  { name: 'arrival-landmark-district', centre: [0, 0], displayTileSize: 8 },
  { name: 'arrival-landmark-regional', centre: [0, 0], displayTileSize: 4 },
].filter((frame) => !FRAME_FILTER || frame.name === FRAME_FILTER);
if (FRAMES.length === 0) throw new Error(`Unknown landmark frame: ${FRAME_FILTER}`);
const CENTRE_OVERRIDE = process.env.MALDOROR_REGIONAL_LANDMARK_CENTRE;
if (CENTRE_OVERRIDE) {
  const centre = CENTRE_OVERRIDE.split(',').map(Number);
  if (centre.length !== 2 || centre.some((value) => !Number.isFinite(value))) {
    throw new Error(`Invalid landmark centre: ${CENTRE_OVERRIDE}`);
  }
  FRAMES = [{ name: 'custom-walking', centre, displayTileSize: 16 }];
}

fs.mkdirSync(OUTPUT, { recursive: true });
const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 32 });
const routes = new RegionalRouteField(WORLD_SEED, field, {
  blockSize: 32,
  maxCachedBlocks: 128,
  maxCachedPaths: 512,
  pathStep: 4,
});
const [biomeKit, routeKit, landmarkKit, ambientKit, routeContactKit] = await Promise.all([
  loadRegionalBiomeMaterialKit(path.join(ROOT, 'assets/biomes/manifest.json')),
  loadRegionalRouteMaterialKit(path.join(ROOT, 'assets/routes/manifest.json')),
  loadRegionalLandmarkKit(path.join(ROOT, 'assets/biomes/landmarks-manifest.json')),
  loadRegionalAmbientKit(path.join(ROOT, 'assets/biomes/ambient-manifest.json')),
  loadRegionalRouteContactKit(path.join(ROOT, 'assets/biomes/route-contacts-manifest.json')),
]);
if (new Set([landmarkKit.blockSize, ambientKit.blockSize, routeContactKit.blockSize]).size !== 1) {
  throw new Error('Regional landmark, ambient, and route-contact block sizes disagree');
}
const compositor = new RegionalMaterialCompositor({
  worldSeed: WORLD_SEED,
  field,
  materials: biomeKit.materials,
  routes,
  routeMaterials: routeKit.routeMaterials,
  crossingMaterials: routeKit.crossingMaterials,
  maxCachedTiles: 4096,
  variantPeriodTiles: 5,
  textureScaleTiles: 7,
});
const world = new RegionalWorldTileProvider({
  worldSeed: WORLD_SEED,
  field,
  routes,
  compositor,
  landmarks: landmarkKit.assets,
  ambient: ambientKit.assets,
  routeContacts: routeContactKit.assets,
  blockSize: landmarkKit.blockSize,
  maxCachedBlocks: 64,
  ambientCellSize: ambientKit.cellSize,
  ambientDensity: ambientKit.density,
  ambientLandmarkClearance: ambientKit.landmarkClearance,
  routeContactCellSize: routeContactKit.cellSize,
  routeContactDensity: routeContactKit.density,
  routeContactLandmarkClearance: routeContactKit.landmarkClearance,
});

function locateLandmarkFamilies() {
  const assetIds = new Set(landmarkKit.assets.map((asset) => asset.id));
  const found = new Map();
  const seenSites = new Set();
  for (const radius of [160, 320, 640, 960, 1280]) {
    for (const site of routes.getLandmarkSites(-radius, -radius, radius, radius)) {
      if (seenSites.has(site.id)) continue;
      seenSites.add(site.id);
      const placement = world.resolveLandmarkPlacement(site.x, site.y);
      if (placement && assetIds.has(placement.assetId) && !found.has(placement.assetId)) {
        found.set(placement.assetId, { site, placement });
      }
    }
    if (found.size === assetIds.size) break;
  }
  const missing = [...assetIds].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Could not locate regional landmarks: ${missing.join(', ')}`);
  return found;
}

const ATLAS_MODES = [
  process.env.MALDOROR_REGIONAL_LANDMARK_ATLAS,
  process.env.MALDOROR_REGIONAL_AMBIENT_ATLAS,
  process.env.MALDOROR_REGIONAL_CONTACT_ATLAS,
].filter((value) => value === '1').length;
if (ATLAS_MODES > 1) {
  throw new Error('Choose one regional atlas mode');
}

if (process.env.MALDOROR_REGIONAL_LANDMARK_ATLAS === '1') {
  const found = locateLandmarkFamilies();
  FRAMES = landmarkKit.assets.map((asset) => {
    const match = found.get(asset.id);
    return {
      name: `${asset.families[0]}-landmark-walking`,
      centre: [match.site.x, match.site.y],
      displayTileSize: 16,
      assetId: asset.id,
      landmarkKind: match.site.landmarkKind,
      anchor: [match.placement.anchorX, match.placement.anchorY],
    };
  });
}

if (process.env.MALDOROR_REGIONAL_AMBIENT_ATLAS === '1') {
  const landmarks = locateLandmarkFamilies();
  FRAMES = landmarkKit.assets.map((landmarkAsset) => {
    const family = landmarkAsset.families[0];
    const landmark = landmarks.get(landmarkAsset.id);
    let candidates = [];
    for (const radius of [32, 64, 96]) {
      candidates = world.getAmbientPlacementsInBounds(
        landmark.site.x - radius,
        landmark.site.y - radius,
        landmark.site.x + radius,
        landmark.site.y + radius,
      ).filter((placement) => placement.families.includes(family));
      if (candidates.length > 0) break;
    }
    if (candidates.length === 0) throw new Error(`Could not locate ambient family: ${family}`);
    candidates.sort((a, b) => (
      Math.hypot(a.anchorX - landmark.site.x, a.anchorY - landmark.site.y) -
      Math.hypot(b.anchorX - landmark.site.x, b.anchorY - landmark.site.y)
    ));
    const placement = candidates[0];
    return {
      name: `${family}-ambient-walking`,
      centre: [placement.anchorX, placement.anchorY],
      displayTileSize: 16,
      assetId: placement.assetId,
      anchor: [placement.anchorX, placement.anchorY],
      nearestLandmark: [landmark.site.x, landmark.site.y],
    };
  });
}

if (process.env.MALDOROR_REGIONAL_CONTACT_ATLAS === '1') {
  const wanted = new Set(routeContactKit.assets.map((asset) => asset.id));
  const found = new Map();
  let previousRadius = 0;
  for (const radius of [128, 256, 384, 512, 768]) {
    const strips = [
      [-radius, -radius, radius, -previousRadius - 1],
      [-radius, previousRadius + 1, radius, radius],
      [-radius, -previousRadius, -previousRadius - 1, previousRadius],
      [previousRadius + 1, -previousRadius, radius, previousRadius],
    ];
    for (const bounds of strips) {
      if (bounds[0] > bounds[2] || bounds[1] > bounds[3]) continue;
      for (const placement of world.getRouteContactPlacementsInBounds(...bounds)) {
        if (wanted.has(placement.assetId) && !found.has(placement.assetId)) {
          found.set(placement.assetId, placement);
        }
      }
    }
    if (found.size === wanted.size) break;
    previousRadius = radius;
  }
  const missing = [...wanted].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Could not locate regional route contacts: ${missing.join(', ')}`);
  FRAMES = routeContactKit.assets.map((asset) => {
    const placement = found.get(asset.id);
    return {
      name: `${asset.families[0]}-route-contact-${asset.accessAxis}-walking`,
      centre: [placement.anchorX, placement.anchorY],
      displayTileSize: 16,
      assetId: asset.id,
      parcelId: placement.parcelId,
      accessAxis: placement.accessAxis,
    };
  });
}

function renderFrame(frame) {
  const renderer = new ViewportRenderer({
    widthTiles: Math.ceil(WIDTH / frame.displayTileSize),
    heightTiles: Math.ceil(HEIGHT / frame.displayTileSize),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    tileRenderSize: frame.displayTileSize,
  });
  renderer.setCamera(frame.centre[0], frame.centre[1]);
  return renderer.renderToBuffer(world, 0).buffer;
}

async function writeSource(filename, grid) {
  const colours = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pixel = grid[y]?.[x] ?? { r: 8, g: 8, b: 12 };
      const offset = (y * WIDTH + x) * 3;
      colours[offset] = pixel.r;
      colours[offset + 1] = pixel.g;
      colours[offset + 2] = pixel.b;
    }
  }
  await sharp(colours, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(filename);
  return colours;
}

async function writeOctant(filename, grid) {
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
  const fill = (x0, y0, fillWidth, fillHeight, colour) => {
    for (let y = y0; y < y0 + fillHeight; y++) {
      for (let x = x0; x < x0 + fillWidth; x++) {
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
  landmarkManifest: path.relative(ROOT, landmarkKit.manifestPath),
  landmarkAssets: landmarkKit.assets.length,
  ambientManifest: path.relative(ROOT, ambientKit.manifestPath),
  ambientAssets: ambientKit.assets.length,
  routeContactManifest: path.relative(ROOT, routeContactKit.manifestPath),
  routeContactAssets: routeContactKit.assets.length,
  frames: [],
};
for (const frame of FRAMES) {
  const startedAt = performance.now();
  const grid = renderFrame(frame);
  const sourcePath = path.join(OUTPUT, `${frame.name}-source.png`);
  const octantPath = path.join(OUTPUT, `${frame.name}-octant-160x44.png`);
  const colours = await writeSource(sourcePath, grid);
  await writeOctant(octantPath, grid);
  metrics.frames.push({
    ...frame,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    sha256: crypto.createHash('sha256').update(colours).digest('hex'),
    fieldStats: field.getStats(),
    routeStats: routes.getStats(),
    compositorStats: compositor.getStats(),
    providerStats: world.getRegionalStats(),
    visibleAmbient: world.getAmbientPlacementsInBounds(
      frame.centre[0] - Math.ceil(WIDTH / frame.displayTileSize / 2),
      frame.centre[1] - Math.ceil(HEIGHT / frame.displayTileSize / 2),
      frame.centre[0] + Math.ceil(WIDTH / frame.displayTileSize / 2),
      frame.centre[1] + Math.ceil(HEIGHT / frame.displayTileSize / 2),
    ),
    visibleRouteContacts: world.getRouteContactPlacementsInBounds(
      frame.centre[0] - Math.ceil(WIDTH / frame.displayTileSize / 2),
      frame.centre[1] - Math.ceil(HEIGHT / frame.displayTileSize / 2),
      frame.centre[0] + Math.ceil(WIDTH / frame.displayTileSize / 2),
      frame.centre[1] + Math.ceil(HEIGHT / frame.displayTileSize / 2),
    ),
  });
}
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...metrics }, null, 2));
