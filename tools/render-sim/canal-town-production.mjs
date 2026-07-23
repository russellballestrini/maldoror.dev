/** Honest visual gate for the live production provider and asset manifest.
 *
 * Uses the same disk terrain loader, CanalTownTileProvider, ViewportRenderer,
 * octant cell conversion, and avatar sprite format as the SSH worker. It does
 * not hand-compose a scene or render a generated district painting.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const APP = path.join(REPO, 'apps/ssh-world');
const OUT = path.join(HERE, 'out');
const cameraX = Number(process.argv[2] ?? 12);
const cameraY = Number(process.argv[3] ?? 6);
const requestedTileSize = Number(process.argv[4] ?? 12);
// Production's persisted world seed. An explicit override keeps historical or
// alternate-world studies reproducible without pretending they match live.
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
fs.mkdirSync(OUT, { recursive: true });
process.chdir(APP);
process.env.SPRITES_DIR = path.join(REPO, 'sprites');

const { loadCanalTownKit } = await import(`${APP}/dist/game/canal-town-assets.js`);
const { CanalTownTileProvider, setTerrainTiles, createPlaceholderSprite } =
  await import(`${REPO}/packages/world/dist/index.js`);
const { ViewportRenderer } = await import(`${REPO}/packages/render/dist/pixel/viewport-renderer.js`);
const { renderOctantGridCells } = await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { OCTANT_CHARS } = await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`);

const kit = await loadCanalTownKit(undefined, WORLD_SEED);
setTerrainTiles(kit.terrainTiles);
const world = new CanalTownTileProvider({
  worldSeed: WORLD_SEED,
  chunkCacheSize: 64,
  assets: kit.assets,
  terrain: kit.terrain,
  blockSize: kit.blockSize,
  materialCompositor: kit.materialCompositor,
  cornerTerrain: kit.cornerTerrain,
});

const playerId = 'visual-gate-player';
world.setLocalPlayerId(playerId);
world.setPlayerSprite(playerId, kit.defaultAvatar ?? createPlaceholderSprite({ r: 60, g: 120, b: 220 }));
world.updatePlayer({
  userId: playerId,
  username: '',
  x: cameraX,
  y: cameraY,
  direction: 'down',
  animationFrame: 0,
  isMoving: false,
});

const COLS = 160;
const ROWS = 44;
// PixelGameRenderer's exponential zoom curve resolves 30% to 12px at 46 rows.
const TILE_SIZE = Number.isFinite(requestedTileSize) ? Math.max(4, Math.round(requestedTileSize)) : 12;
const viewport = new ViewportRenderer({
  widthTiles: Math.ceil((COLS * 2) / TILE_SIZE),
  heightTiles: Math.ceil((ROWS * 4) / TILE_SIZE),
  pixelWidth: COLS * 2,
  pixelHeight: ROWS * 4,
  tileRenderSize: TILE_SIZE,
});
viewport.setCamera(cameraX, cameraY);
const { buffer, brightnessGrid } = viewport.renderToBuffer(world, 0);
const cells = renderOctantGridCells(buffer, brightnessGrid);

const CELL_W = 10;
const CELL_H = 20;
const width = COLS * CELL_W;
const height = ROWS * CELL_H;
const rgb = Buffer.alloc(width * height * 3);
const fallback = { r: 18, g: 24, b: 28 };
const lookup = new Map();
OCTANT_CHARS.forEach((character, pattern) => {
  const point = character.codePointAt(0);
  if (point !== undefined && !lookup.has(point)) lookup.set(point, pattern);
});
const fill = (x0, y0, w, h, color) => {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const index = (y * width + x) * 3;
      rgb[index] = color.r;
      rgb[index + 1] = color.g;
      rgb[index + 2] = color.b;
    }
  }
};
for (let cy = 0; cy < ROWS; cy++) {
  for (let cx = 0; cx < COLS; cx++) {
    const cell = cells[cy]?.[cx];
    const px = cx * CELL_W;
    const py = cy * CELL_H;
    if (!cell) {
      fill(px, py, CELL_W, CELL_H, fallback);
      continue;
    }
    const foreground = cell.fgColor ?? fallback;
    const background = cell.bgColor ?? fallback;
    fill(px, py, CELL_W, CELL_H, background);
    const pattern = lookup.get(cell.char.codePointAt(0)) ?? 0;
    for (let row = 0; row < 4; row++) {
      for (let column = 0; column < 2; column++) {
        if (pattern & (1 << (row * 2 + column))) {
          fill(
            px + column * (CELL_W / 2),
            py + row * (CELL_H / 4),
            CELL_W / 2,
            CELL_H / 4,
            foreground,
          );
        }
      }
    }
  }
}

const output = path.join(OUT, `canal-town-production-octant-${cameraX}-${cameraY}.png`);
await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toFile(output);
console.log(JSON.stringify({
  output,
  viewport: { cols: COLS, rows: ROWS, tileSize: TILE_SIZE },
  worldSeed: WORLD_SEED.toString(),
  terrainAssets: kit.terrainTiles.length,
  kit: world.getCanalTownStats(),
  rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
}, null, 2));
