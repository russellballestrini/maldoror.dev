/** Four-state real regional-provider atmosphere atlas for gallery inspection. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { loadRegionalWorldProvider } from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_LIVING_WORLD_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/living-world-research/deterministic-life-v1';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const WIDTH = 320;
const HEIGHT = 176;
const TILE_SIZE = 16;
const assets = {
  biomeMaterials: path.join(ROOT, 'assets/biomes/manifest.json'),
  routeMaterials: path.join(ROOT, 'assets/routes/manifest.json'),
  landmarks: path.join(ROOT, 'assets/biomes/landmarks-manifest.json'),
  ambient: path.join(ROOT, 'assets/biomes/ambient-manifest.json'),
  routeContacts: path.join(ROOT, 'assets/biomes/route-contacts-manifest.json'),
  parcelComponents: path.join(ROOT, 'assets/biomes/parcel-components-manifest.json'),
  environmentContacts: path.join(ROOT, 'assets/biomes/environment-contacts-manifest.json'),
};
const states = [
  { label: 'DAWN / MIST', worldMinute: 390, weather: 'mist', weatherIntensity: 0.7 },
  { label: 'NOON / CLEAR', worldMinute: 720, weather: 'clear', weatherIntensity: 0.12 },
  { label: 'DUSK / RAIN', worldMinute: 1080, weather: 'rain', weatherIntensity: 0.72 },
  { label: 'MIDNIGHT / STORM', worldMinute: 0, weather: 'storm', weatherIntensity: 0.92 },
];

fs.mkdirSync(OUTPUT, { recursive: true });
const { world } = await loadRegionalWorldProvider({ worldSeed: WORLD_SEED, assets });
let currentLife = null;
world.getWorldLifeState = () => currentLife;

function renderer() {
  const value = new ViewportRenderer({
    widthTiles: Math.ceil(WIDTH / TILE_SIZE),
    heightTiles: Math.ceil(HEIGHT / TILE_SIZE),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    tileRenderSize: TILE_SIZE,
  });
  value.setCamera(0, 0);
  return value;
}

async function pngFromGrid(grid) {
  const bytes = Buffer.alloc(WIDTH * HEIGHT * 3);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const pixel = grid[y]?.[x] ?? { r: 8, g: 7, b: 12 };
      const offset = (y * WIDTH + x) * 3;
      bytes[offset] = pixel.r;
      bytes[offset + 1] = pixel.g;
      bytes[offset + 2] = pixel.b;
    }
  }
  return sharp(bytes, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toBuffer();
}

const frames = [];
for (const [index, state] of states.entries()) {
  currentLife = {
    worldId: 'primary',
    worldSeed: WORLD_SEED.toString(),
    worldMinute: state.worldMinute,
    weather: state.weather,
    weatherIntensity: state.weatherIntensity,
    weatherUntilWorldMinute: state.worldMinute + 100,
    season: 'summer',
    rngState: 1234567,
  };
  frames.push(await pngFromGrid(renderer().renderToBuffer(world, 31 + index).buffer));
}

const labelHeight = 34;
const gap = 14;
const atlasWidth = WIDTH * 2 + gap * 3;
const atlasHeight = (HEIGHT + labelHeight) * 2 + gap * 3;
const composites = [];
for (const [index, state] of states.entries()) {
  const column = index % 2;
  const row = Math.floor(index / 2);
  const left = gap + column * (WIDTH + gap);
  const top = gap + row * (HEIGHT + labelHeight + gap);
  const label = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${labelHeight}"><rect width="100%" height="100%" fill="#171220"/><text x="12" y="23" fill="#e1c8dd" font-family="DejaVu Sans Mono, monospace" font-size="14">${state.label}</text></svg>`);
  composites.push({ input: label, left, top });
  composites.push({ input: frames[index], left, top: top + labelHeight });
}
const target = path.join(OUTPUT, 'living-atmosphere-four-state-atlas.png');
await sharp({
  create: {
    width: atlasWidth,
    height: atlasHeight,
    channels: 3,
    background: '#0c0912',
  },
}).composite(composites).png().toFile(target);
console.log(JSON.stringify({ target, states, coordinate: [0, 0], dimensions: [atlasWidth, atlasHeight] }, null, 2));
