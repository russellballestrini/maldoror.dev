/**
 * Headless render-engine simulator: drives the REAL render pipeline
 * (TileProvider terrain + real sprite PNGs + ViewportRenderer + cell
 * renderers) and rasterizes the resulting terminal cells into PNG
 * "screenshots" — what a terminal would display, without a terminal.
 *
 * Usage: node tools/render-sim/sim.mjs [outdir]
 * Produces <outdir>/sim_<mode>_z<tileSize>.png
 *
 * The point: a fast visual iteration loop for renderer work. Change the
 * renderer, re-run, LOOK at the output.
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

const { TileProvider, setTerrainTile } = await import(`${REPO}/packages/world/dist/index.js`);
const { ViewportRenderer } = await import(`${REPO}/packages/render/dist/pixel/viewport-renderer.js`);
const {
  renderHalfBlockGridCells,
  renderBrailleGridCells,
  quantizeGridDithered,
} = await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);

const OUT = process.argv[2] || path.join(REPO, 'tools/render-sim/out');
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Sprite loading (standalone; mirrors apps/ssh-world png-storage without db)
// ---------------------------------------------------------------------------
const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];
const DIRECTIONS = ['up', 'down', 'left', 'right'];

async function pngToPixelGrid(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const grid = [];
  for (let y = 0; y < info.height; y++) {
    const row = [];
    for (let x = 0; x < info.width; x++) {
      const i = (y * info.width + x) * 4;
      row.push(data[i + 3] < 32 ? null : { r: data[i], g: data[i + 1], b: data[i + 2] });
    }
    grid.push(row);
  }
  return grid;
}

/**
 * Remove baked-in dark fringe speckles from sprite edges.
 * Generation-era alpha threshold (32) let anti-aliased near-black edge pixels
 * become opaque; they render as dot noise around every sprite. A speckle is a
 * DARK pixel mostly surrounded by transparency; solid dark regions (boots,
 * outlines) keep >=4 opaque neighbours and survive.
 */
function despeckle(grid, erodePasses = 2, lumMax = 90) {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const lum = (p) => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;

  // Pass A: erode the dark anti-aliased halo — dark pixels TOUCHING
  // transparency are fringe, regardless of how many opaque neighbours they
  // have (the halo is contiguous). 1-2px erosion at 256px is invisible after
  // downscale but removes the ring that nearest-neighbour sampling turns
  // into scattered black dots at low resolutions.
  for (let pass = 0; pass < erodePasses; pass++) {
    const kill = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = grid[y][x];
        if (!p || lum(p) >= lumMax) continue;
        let touchesAir = false;
        for (let dy = -1; dy <= 1 && !touchesAir; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = y + dy, nx = x + dx;
            if (ny < 0 || ny >= h || nx < 0 || nx >= w || !grid[ny][nx]) { touchesAir = true; break; }
          }
        }
        if (touchesAir) kill.push([y, x]);
      }
    }
    for (const [y, x] of kill) grid[y][x] = null;
    if (!kill.length) break;
  }

  // Pass B: remove isolated specks (dark or not) left floating
  const kill = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y][x]) continue;
      let opaque = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        if (grid[y + dy]?.[x + dx]) opaque++;
      }
      if (opaque <= 2) kill.push([y, x]);
    }
  }
  for (const [y, x] of kill) grid[y][x] = null;
  return grid;
}

/** Nearest-neighbour downscale of a PixelGrid. */
function downscale(grid, target) {
  const src = grid.length;
  if (src === target) return grid;
  const out = [];
  for (let y = 0; y < target; y++) {
    const row = [];
    const sy = Math.floor(y * src / target);
    for (let x = 0; x < target; x++) {
      row.push(grid[sy][Math.floor(x * src / target)] ?? null);
    }
    out.push(row);
  }
  return out;
}

async function loadSprite(dir) {
  const sprite = { width: 256, height: 256, frames: {}, resolutions: {} };
  for (const res of RESOLUTIONS) sprite.resolutions[String(res)] = {};
  for (const d of DIRECTIONS) {
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const file = path.join(dir, `frame_${d}_${f}_256.png`);
      // Load ONLY the 256px base, despeckle hard, and rebuild the resolution
      // pyramid from the cleaned base — the on-disk small PNGs carry the
      // baked-in fringe and can't be reliably despeckled at low res.
      frames.push(fs.existsSync(file) ? despeckle(await pngToPixelGrid(file), 3, 80) : null);
    }
    const base = frames.find(Boolean);
    sprite.frames[d] = frames.map(f => f ?? base);
    for (const res of RESOLUTIONS) {
      sprite.resolutions[String(res)][d] = sprite.frames[d].map(f => downscale(f, res));
    }
  }
  return sprite;
}

function pickSpriteDirs(base, n) {
  if (!fs.existsSync(base)) return [];
  return fs.readdirSync(base)
    .filter(d => fs.existsSync(path.join(base, d, 'frame_down_0_256.png')))
    .slice(0, n)
    .map(d => path.join(base, d));
}

// ---------------------------------------------------------------------------
// AI terrain tiles (same data/terrain PNGs the live game loads)
// ---------------------------------------------------------------------------
const TERRAIN_DIR = path.join(REPO, 'apps/ssh-world/data/terrain');
let aiTerrainCount = 0;
if (fs.existsSync(TERRAIN_DIR)) {
  for (const id of fs.readdirSync(TERRAIN_DIR)) {
    const base = path.join(TERRAIN_DIR, id, '256.png');
    if (!fs.existsSync(base)) continue;
    const pixels = await pngToPixelGrid(base);
    const resolutions = {};
    for (const res of RESOLUTIONS) {
      const f = path.join(TERRAIN_DIR, id, `${res}.png`);
      resolutions[String(res)] = fs.existsSync(f) ? await pngToPixelGrid(f) : downscale(pixels, res);
    }
    setTerrainTile({
      id, name: id, pixels,
      walkable: !id.includes('water'),
      resolutions,
    });
    aiTerrainCount++;
  }
}
console.log(`AI terrain tiles registered: ${aiTerrainCount}`);

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------
const WORLD_SEED = 8801799478018485n; // the live world's seed
const tileProvider = new TileProvider({ worldSeed: WORLD_SEED, chunkCacheSize: 64 });

const playerDirs = pickSpriteDirs(path.join(REPO, 'sprites'), 1);
const npcDirs = pickSpriteDirs(path.join(REPO, 'npcs'), 4);

const playerSprite = playerDirs.length ? await loadSprite(playerDirs[0]) : null;
const npcSprites = [];
for (const d of npcDirs) npcSprites.push(await loadSprite(d));

// Find open grass-ish area: scan for a walkable tile cluster
function findOpenSpot() {
  for (let r = 0; r < 200; r++) {
    for (let x = -r; x <= r; x++) for (let y of [-r, r]) {
      if (ok(x, y)) return { x, y };
    }
    for (let y = -r + 1; y < r; y++) for (let x of [-r, r]) {
      if (ok(x, y)) return { x, y };
    }
  }
  return { x: 0, y: 0 };
  function ok(x, y) {
    let good = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) {
      const t = tileProvider.getTile(x + dx, y + dy);
      if (t && t.walkable) good++;
    }
    return good === 25;
  }
}
const spot = findOpenSpot();
console.log('scene at', spot);

const players = [{
  userId: 'sim-player', username: 'wanderer', x: spot.x, y: spot.y,
  direction: 'down', animationFrame: 0, isMoving: false, isOnline: true,
}];
const npcs = npcSprites.map((s, i) => ({
  npcId: `sim-npc-${i}`, name: ['korov', 'ezera', 'mald', 'yezh'][i] ?? `npc${i}`,
  x: spot.x + [-2, 2, -1, 2][i], y: spot.y + [-1, -2, 2, 1][i],
  direction: ['down', 'left', 'right', 'up'][i], animationFrame: i % 4,
}));

const world = {
  getTile: (x, y) => tileProvider.getTile(x, y),
  getRoadTileAt: (x, y) => tileProvider.getRoadTileAt(x, y),
  getBuildingTileAt: (x, y, d) => tileProvider.getBuildingTileAt(x, y, d),
  getPlayers: () => players,
  getNPCs: () => npcs,
  getLocalPlayerId: () => 'sim-player',
  getPlayerSprite: () => playerSprite,
  getNPCSprite: (id) => npcSprites[parseInt(id.split('-').pop(), 10)] ?? null,
};

// ---------------------------------------------------------------------------
// Cell rasterizer: CellGrid -> PNG (a faithful terminal "screenshot")
// ---------------------------------------------------------------------------
const CELL_W = 10, CELL_H = 20; // 1:2 terminal cell aspect

function rasterize(cells, mode) {
  const rows = cells.length, cols = Math.max(...cells.map(r => r.length));
  const W = cols * CELL_W, H = rows * CELL_H;
  const img = Buffer.alloc(W * H * 3);
  const put = (x, y, c) => {
    const i = (y * W + x) * 3;
    img[i] = c.r; img[i + 1] = c.g; img[i + 2] = c.b;
  };
  const fillRect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, c);
  };
  const DEF = { r: 20, g: 20, b: 25 };

  for (let cy = 0; cy < rows; cy++) {
    const row = cells[cy];
    for (let cx = 0; cx < cols; cx++) {
      const cell = row?.[cx];
      const px = cx * CELL_W, py = cy * CELL_H;
      if (!cell) { fillRect(px, py, CELL_W, CELL_H, DEF); continue; }
      const fg = cell.fgColor ?? DEF, bg = cell.bgColor ?? DEF;
      if (mode === 'halfblock') {
        // ▀ : top half fg, bottom half bg
        fillRect(px, py, CELL_W, CELL_H / 2, fg);
        fillRect(px, py + CELL_H / 2, CELL_W, CELL_H / 2, bg);
      } else if (mode === 'braille') {
        // bg fill + 2x4 dot matrix in fg for set dots
        fillRect(px, py, CELL_W, CELL_H, bg);
        const code = cell.char.charCodeAt(0) - 0x2800;
        const DOTBITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
        for (let dr = 0; dr < 4; dr++) for (let dc = 0; dc < 2; dc++) {
          if (code & DOTBITS[dr][dc]) {
            // dot cell region ~ (CELL_W/2 x CELL_H/4), draw filled square inset 1px
            const dx0 = px + dc * (CELL_W / 2) + 1, dy0 = py + dr * (CELL_H / 4) + 1;
            fillRect(dx0, dy0, CELL_W / 2 - 1, CELL_H / 4 - 1, fg);
          }
        }
      } else {
        fillRect(px, py, CELL_W, CELL_H, bg);
      }
    }
  }
  return { img, W, H };
}

// ---------------------------------------------------------------------------
// Render scenes
// ---------------------------------------------------------------------------
const COLS = 160, ROWS = 44; // typical terminal viewport (minus header)

async function shoot(mode, tileRenderSize, label, quantBits = 0) {
  const pxW = mode === 'braille' ? COLS * 2 : COLS;
  const pxH = mode === 'braille' ? ROWS * 4 : ROWS * 2;
  const vr = new ViewportRenderer({
    widthTiles: Math.max(1, Math.floor(pxW / tileRenderSize)),
    heightTiles: Math.max(1, Math.floor(pxH / tileRenderSize)),
    pixelWidth: pxW, pixelHeight: pxH, tileRenderSize,
  });
  vr.setCamera(spot.x, spot.y);
  let { buffer } = vr.renderToBuffer(world, 0);
  // Mirror the live renderer's zoom-based quantization+dithering
  if (quantBits > 0) buffer = quantizeGridDithered(buffer, quantBits);
  const cells = mode === 'braille'
    ? renderBrailleGridCells(buffer)
    : renderHalfBlockGridCells(buffer);
  const { img, W, H } = rasterize(cells, mode);
  const file = path.join(OUT, `sim_${label}.png`);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(file);
  console.log(`wrote ${file}  (${W}x${H}, cells ${cells[0]?.length}x${cells.length}, tile=${tileRenderSize}px)`);
}

// quantBits mirrors the game: zoom>70 -> 4-bit, zoom>50 -> 5-bit, else none
await shoot('halfblock', 26, 'halfblock_z26', 5);
await shoot('halfblock', 51, 'halfblock_z51', 4);
await shoot('halfblock', 88, 'halfblock_z88', 4);
await shoot('braille', 51, 'braille_z51', 5);
await shoot('braille', 102, 'braille_z102', 4);
console.log('done');
