/**
 * Showcase scene: a hand-authored canal-town layout (plaza + canal cross +
 * curbed water edges) rendered three ways:
 *   1. fullres  — tiles composited at native resolution = what the planned
 *                 kitty-graphics-protocol mode displays in Ghostty (TARGET fidelity)
 *   2. halfblock — the universal cell-mode fallback
 *   3. braille   — high-detail cell mode
 *
 * Usage: node tools/render-sim/showcase.mjs
 * Writes tools/render-sim/out/showcase_*.png
 */
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const { ViewportRenderer } = await import(`${REPO}/packages/render/dist/pixel/viewport-renderer.js`);
const { renderHalfBlockGridCells, renderBrailleGridCells, renderOctantGridCells, quantizeGridDithered } =
  await import(`${REPO}/packages/render/dist/pixel/pixel-renderer.js`);
const { OCTANT_CHARS } = await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`);
const OCT_LOOKUP = new Map();
OCTANT_CHARS.forEach((ch, pat) => { if (!OCT_LOOKUP.has(ch.codePointAt(0))) OCT_LOOKUP.set(ch.codePointAt(0), pat); });

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const TERRAIN_DIR = path.join(REPO, 'apps/ssh-world/data/terrain');
const RESOLUTIONS = [26, 51, 77, 102, 128, 154, 179, 205, 230, 256];

// ---- loaders (shared shapes with sim.mjs) ---------------------------------
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
function despeckle(grid, erodePasses = 2, lumMax = 90) {
  const h = grid.length, w = grid[0]?.length ?? 0;
  const lum = (p) => 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
  for (let pass = 0; pass < erodePasses; pass++) {
    const kill = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = grid[y][x];
      if (!p || lum(p) >= lumMax) continue;
      let air = false;
      for (let dy = -1; dy <= 1 && !air; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const ny = y + dy, nx = x + dx;
        if (ny < 0 || ny >= h || nx < 0 || nx >= w || !grid[ny][nx]) { air = true; break; }
      }
      if (air) kill.push([y, x]);
    }
    for (const [y, x] of kill) grid[y][x] = null;
    if (!kill.length) break;
  }
  return grid;
}
function downscale(grid, target) {
  const src = grid.length;
  if (src === target) return grid;
  const out = [];
  for (let y = 0; y < target; y++) {
    const row = []; const sy = Math.floor(y * src / target);
    for (let x = 0; x < target; x++) row.push(grid[sy][Math.floor(x * src / target)] ?? null);
    out.push(row);
  }
  return out;
}

async function loadTile(id) {
  const dir = path.join(TERRAIN_DIR, id);
  const base = path.join(dir, '256.png');
  if (!fs.existsSync(base)) return null;
  const pixels = await pngToPixelGrid(base);
  const resolutions = {};
  for (const res of RESOLUTIONS) {
    const f = path.join(dir, `${res}.png`);
    resolutions[String(res)] = fs.existsSync(f) ? await pngToPixelGrid(f) : downscale(pixels, res);
  }
  return { id, name: id, pixels, walkable: true, resolutions };
}

async function loadSprite(dir) {
  const sprite = { width: 256, height: 256, frames: {}, resolutions: {} };
  const DIRECTIONS = ['up', 'down', 'left', 'right'];
  for (const res of RESOLUTIONS) sprite.resolutions[String(res)] = {};
  for (const d of DIRECTIONS) {
    const frames = [];
    for (let f = 0; f < 4; f++) {
      const file = path.join(dir, `frame_${d}_${f}_256.png`);
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

// ---- scene layout ----------------------------------------------------------
// Legend: S=stone plaza, W=water, transitions stone_to_water_<edges> by lookup.
// A plaza cross with canals in the quadrants, like the mockup's composition.
const L = [
  'WWWWWSSWWWWWWSSWWWWW',
  'WWWWWSSWWWWWWSSWWWWW',
  'WWWWWSSWWWWWWSSWWWWW',
  'SSSSSSSSSSSSSSSSSSSS',
  'SSSSSSSSSSSSSSSSSSSS',
  'WWWWWSSWWWWWWSSWWWWW',
  'WWWWWSSWWWWWWSSWWWWW',
  'WWWWWSSWWWWWWSSWWWWW',
  'WWWWWSSWWWWWWSSWWWWW',
  'SSSSSSSSSSSSSSSSSSSS',
];
const H = L.length, W = L[0].length;
const at = (x, y) => (y >= 0 && y < H && x >= 0 && x < W) ? L[y][x] : 'S';

const tiles = {};
async function T(id) { if (!(id in tiles)) tiles[id] = await loadTile(id); return tiles[id]; }

function posHash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return Math.abs(h);
}

async function tileFor(x, y) {
  const c = at(x, y);
  if (c === 'S') return T('stone');
  // water with spatial variants (same mechanism as tile-provider __vN picks)
  const variants = ['water'];
  for (const v of [2, 3]) {
    if (fs.existsSync(path.join(TERRAIN_DIR, `water__v${v}`, '256.png'))) variants.push(`water__v${v}`);
  }
  return T(variants[posHash(x * 7 + 3, y * 5 + 1) % variants.length]);
}
async function stoneTileFor(x, y) {
  // stone cell: if water is adjacent, use the transition with water on those edges
  const n = at(x, y - 1) === 'W', e = at(x + 1, y) === 'W', s = at(x, y + 1) === 'W', w = at(x - 1, y) === 'W';
  let name = '';
  if (n) name += 'n'; if (s) name += 's'; if (e) name += 'e'; if (w) name += 'w';
  // normalize to generated set: n,e,s,w,ne,nw,se,sw (fall back to closest)
  const have = ['n', 'e', 's', 'w', 'ne', 'nw', 'se', 'sw'];
  if (!name) return T('stone');
  if (!have.includes(name)) {
    // pick first single edge present as fallback
    name = name[0];
  }
  const t = await T(`stone_to_water_${name}`);
  return t ?? T('stone');
}

const world = {
  getTile: async () => null, // replaced below (sync interface needed)
};

// Preload every tile needed, then provide a sync world
const grid = [];
for (let y = 0; y < H; y++) {
  const row = [];
  for (let x = 0; x < W; x++) {
    row.push(at(x, y) === 'S' ? await stoneTileFor(x, y) : await tileFor(x, y));
  }
  grid.push(row);
}

const playerSpriteDirs = fs.readdirSync(path.join(REPO, 'sprites'))
  .filter(d => fs.existsSync(path.join(REPO, 'sprites', d, 'frame_down_0_256.png')));
const npcDirs = fs.readdirSync(path.join(REPO, 'npcs'))
  .filter(d => fs.existsSync(path.join(REPO, 'npcs', d, 'frame_down_0_256.png'))).slice(0, 2);
const playerSprite = await loadSprite(path.join(REPO, 'sprites', playerSpriteDirs[0]));
const npcSprites = [];
for (const d of npcDirs) npcSprites.push(await loadSprite(path.join(REPO, 'npcs', d)));

const players = [{ userId: 'p', username: 'wanderer', x: 9, y: 4, direction: 'down', animationFrame: 0, isMoving: false }];
const npcs = npcSprites.map((s, i) => ({
  npcId: `n${i}`, name: ['korov', 'ezera'][i] ?? `n${i}`,
  x: [3, 16][i] ?? 5, y: [3, 9][i] ?? 9,
  direction: ['down', 'left'][i] ?? 'down', animationFrame: 0,
}));

// ---- buildings (2x2 sliced tiles from tools/gen-buildings.mjs) -------------
const BUILDINGS_DIR = path.join(REPO, 'tools/render-sim/buildings-canal');
// anchor (top-left tile) placements on plaza rows
const buildingPlacements = [
  { id: 'shop_awning', x: 2, y: 3 },
  { id: 'house_tall', x: 13, y: 8 },
];
const buildingTiles = new Map(); // "x,y" -> tile
for (const bp of buildingPlacements) {
  const dir = path.join(BUILDINGS_DIR, bp.id);
  if (!fs.existsSync(dir)) continue;
  for (let ty = 0; ty < 2; ty++) for (let tx = 0; tx < 2; tx++) {
    const base = path.join(dir, `tile_${tx}_${ty}_256.png`);
    if (!fs.existsSync(base)) continue;
    const pixels = await pngToPixelGrid(base);
    const resolutions = {};
    for (const res of RESOLUTIONS) {
      const f = path.join(dir, `tile_${tx}_${ty}_${res}.png`);
      resolutions[String(res)] = fs.existsSync(f) ? await pngToPixelGrid(f) : downscale(pixels, res);
    }
    buildingTiles.set(`${bp.x + tx},${bp.y + ty - 1}`, { id: `${bp.id}:${tx},${ty}`, pixels, walkable: false, resolutions });
  }
}
console.log(`building tiles staged: ${buildingTiles.size}`);

const syncWorld = {
  getTile: (x, y) => grid[((y % H) + H) % H]?.[((x % W) + W) % W] ?? null,
  getBuildingTileAt: (x, y, _dir) => buildingTiles.get(`${x},${y}`) ?? null,
  getPlayers: () => players,
  getNPCs: () => npcs,
  getLocalPlayerId: () => 'p',
  getPlayerSprite: () => playerSprite,
  getNPCSprite: (id) => npcSprites[parseInt(id.slice(1), 10)] ?? null,
};

// ---- render ---------------------------------------------------------------
const CELL_W = 10, CELL_H = 20;
function rasterize(cells, mode) {
  const rows = cells.length, cols = Math.max(...cells.map(r => r.length));
  const Wp = cols * CELL_W, Hp = rows * CELL_H;
  const img = Buffer.alloc(Wp * Hp * 3);
  const DEF = { r: 20, g: 20, b: 25 };
  const fillRect = (x0, y0, w, h, c) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) {
      const i = (y * Wp + x) * 3; img[i] = c.r; img[i + 1] = c.g; img[i + 2] = c.b;
    }
  };
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const cell = cells[cy]?.[cx];
    const px = cx * CELL_W, py = cy * CELL_H;
    if (!cell) { fillRect(px, py, CELL_W, CELL_H, DEF); continue; }
    const fg = cell.fgColor ?? DEF, bg = cell.bgColor ?? DEF;
    if (mode === 'halfblock') {
      fillRect(px, py, CELL_W, CELL_H / 2, fg);
      fillRect(px, py + CELL_H / 2, CELL_W, CELL_H / 2, bg);
    } else if (mode === 'braille') {
      fillRect(px, py, CELL_W, CELL_H, bg);
      const code = cell.char.charCodeAt(0) - 0x2800;
      const DOTBITS = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];
      for (let dr = 0; dr < 4; dr++) for (let dc = 0; dc < 2; dc++) {
        if (code & DOTBITS[dr][dc]) {
          fillRect(px + dc * (CELL_W / 2) + 1, py + dr * (CELL_H / 4) + 1, CELL_W / 2 - 1, CELL_H / 4 - 1, fg);
        }
      }
    } else {
      // octant: SOLID 2x4 sub-cells. Reconstruct pattern from octant char via reverse lookup.
      fillRect(px, py, CELL_W, CELL_H, bg);
      const pat = OCT_LOOKUP.get(cell.char.codePointAt(0)) ?? 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
        if (pat & (1 << (r*2+c))) fillRect(px + c*(CELL_W/2), py + r*(CELL_H/4), CELL_W/2, CELL_H/4, fg);
      }
    }
  }
  return { img, Wp, Hp };
}

async function shootCells(mode, tileRenderSize, quantBits, label) {
  const COLS = 160, ROWS = 44;
  const pxW = mode === 'braille' ? COLS * 2 : COLS;
  const pxH = mode === 'braille' ? ROWS * 4 : ROWS * 2;
  const vr = new ViewportRenderer({
    widthTiles: Math.floor(pxW / tileRenderSize), heightTiles: Math.floor(pxH / tileRenderSize),
    pixelWidth: pxW, pixelHeight: pxH, tileRenderSize,
  });
  vr.setCamera(9, 4);
  let { buffer } = vr.renderToBuffer(syncWorld, 0);
  if (quantBits > 0) buffer = quantizeGridDithered(buffer, quantBits);
  const cells = mode === 'braille' ? renderBrailleGridCells(buffer)
    : mode === 'octant' ? renderOctantGridCells(buffer)
    : renderHalfBlockGridCells(buffer);
  const { img, Wp, Hp } = rasterize(cells, mode);
  const file = path.join(OUT, `showcase_${label}.png`);
  await sharp(img, { raw: { width: Wp, height: Hp, channels: 3 } }).png().toFile(file);
  console.log(`wrote ${file}`);
}

// fullres: composite at native tile resolution (what kitty-graphics mode shows)
async function shootFullres() {
  const TS = 128; // 128px per tile — plenty for the comparison
  const Wp = W * TS, Hp = H * TS;
  const img = Buffer.alloc(Wp * Hp * 3);
  const put = (x, y, c) => { const i = (y * Wp + x) * 3; img[i] = c.r; img[i + 1] = c.g; img[i + 2] = c.b; };
  for (let ty = 0; ty < H; ty++) for (let tx = 0; tx < W; tx++) {
    const t = grid[ty][tx];
    const px = t?.resolutions?.[String(TS)] ?? null;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      put(tx * TS + x, ty * TS + y, px?.[y]?.[x] ?? { r: 20, g: 20, b: 25 });
    }
  }
  // composite entities at fullres
  const drawSprite = (sprite, tx, ty) => {
    const f = sprite?.resolutions?.[String(TS)]?.down?.[0];
    if (!f) return;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const p = f[y]?.[x];
      if (p) put(tx * TS + x, ty * TS + y, p);
    }
  };
  // buildings first (under entities)
  for (const [key, bt] of buildingTiles) {
    const [bx, by] = key.split(',').map(Number);
    const px = bt.resolutions?.[String(TS)];
    if (!px || bx < 0 || by < 0 || bx >= W || by >= H) continue;
    for (let y = 0; y < TS; y++) for (let x = 0; x < TS; x++) {
      const p = px[y]?.[x];
      if (p) put(bx * TS + x, by * TS + y, p);
    }
  }
  drawSprite(playerSprite, 9, 4);
  npcs.forEach((n, i) => drawSprite(npcSprites[i], n.x, n.y));
  const file = path.join(OUT, 'showcase_fullres_kitty-mode-preview.png');
  await sharp(img, { raw: { width: Wp, height: Hp, channels: 3 } }).png().toFile(file);
  console.log(`wrote ${file}`);
}

await shootFullres();
await shootCells('halfblock', 51, 4, 'halfblock_z51');
await shootCells('halfblock', 88, 4, 'halfblock_z88');
await shootCells('braille', 102, 4, 'braille_z102');
await shootCells('octant', 51, 4, 'octant_z51');
await shootCells('octant', 88, 4, 'octant_z88');
await shootCells('octant', 102, 4, 'octant_z102');
console.log('done');
