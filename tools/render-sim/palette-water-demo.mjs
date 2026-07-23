/**
 * Prove the OSC-4 palette-cycled water technique visually: a canal scene where
 * water cells carry a spatial PHASE (never changes), and each animation frame
 * only rotates the 8 water-palette RGBs. Rasterize N frames -> the glint
 * travels across the water while zero cells change. Also emits the actual
 * OSC-4 byte packets and reports bytes/frame.
 *
 * node tools/render-sim/palette-water-demo.mjs
 */
import sharp from 'sharp';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const { materialPhase, glintPhase, waterPalette, osc4Packet, PALETTE, PHASES } =
  await import(`${REPO}/packages/render/dist/pixel/palette-cycle.js`);

const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// Scene: a plaza cross over water, in terminal CELLS (octant-ish resolution).
// We work at cell granularity here (each cell = one octant glyph area).
const COLS = 140, ROWS = 40;
const CELL_W = 10, CELL_H = 20;

// Layout: horizontal + vertical stone bands, water in the quadrants.
function isStone(cx, cy) {
  const vx = (cx > 62 && cx < 70) || (cx > 4 && cx < 10);
  const hy = (cy > 17 && cy < 23);
  return vx || hy;
}
const STONE = { r: 224, g: 196, b: 150 };
const STONE_DARK = { r: 205, g: 176, b: 132 };

// gentle noise field (0..2) — perturbs the diagonal wave bands slightly so
// they read organic, without drowning out the traveling motion.
function noise(cx, cy) {
  let h = (cx * 131 + cy * 977) | 0;
  h = (h ^ (h >> 7)) * 2654435761;
  return (h >>> 30); // 0..3 -> we'll scale down
}

function renderFrame(t) {
  const pal = waterPalette(t); // 8 RGBs for the water slots this tick
  const W = COLS * CELL_W, H = ROWS * CELL_H;
  const img = Buffer.alloc(W * H * 3);
  const put = (x, y, c) => { const i = (y * W + x) * 3; img[i] = c.r; img[i+1] = c.g; img[i+2] = c.b; };
  const fill = (x0, y0, w, h, c) => { for (let y=y0;y<y0+h;y++) for (let x=x0;x<x0+w;x++) put(x,y,c); };

  let waterCells = 0;
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) {
      const px = cx * CELL_W, py = cy * CELL_H;
      if (isStone(cx, cy)) {
        // stone flagstone: checker for grid feel
        fill(px, py, CELL_W, CELL_H, ((cx + cy) & 3) === 0 ? STONE_DARK : STONE);
      } else {
        // water cell: smooth diagonal wave bands (x + 2y) + gentle noise.
        // Phase never changes; only the palette RGB for this slot changes per t.
        const p = materialPhase(cx, cy, noise(cx, cy) >> 1);
        const c = pal[p];
        fill(px, py, CELL_W, CELL_H, c);
        waterCells++;
      }
    }
  }
  return { img, W, H, waterCells, pal };
}

const frames = 8;
let totalBytes = 0;
const frameImgs = [];
let FW = 0, FH = 0, waterCellsN = 0;
for (let t = 0; t < frames; t++) {
  const { img, W, H, waterCells, pal } = renderFrame(t);
  FW = W; FH = H; waterCellsN = waterCells;
  const packet = osc4Packet(PALETTE.WATER, pal);
  totalBytes += Buffer.byteLength(packet);
  await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png()
    .toFile(path.join(OUT, `water_frame_${t}.png`));
  frameImgs.push(img);
  console.log(`frame ${t}: ${waterCells} water cells, OSC-4 = ${Buffer.byteLength(packet)} bytes`);
}

// Vertical filmstrip montage (frames stacked) so the traveling glint is visible
// as a single gallery image.
const scale = 3; // downscale each frame for the strip
const sw = Math.round(FW / scale), sh = Math.round(FH / scale);
const gap = 6;
const stripH = frames * sh + (frames - 1) * gap;
const composites = [];
for (let t = 0; t < frames; t++) {
  const small = await sharp(frameImgs[t], { raw: { width: FW, height: FH, channels: 3 } })
    .resize(sw, sh).png().toBuffer();
  composites.push({ input: small, top: t * (sh + gap), left: 0 });
}
await sharp({ create: { width: sw, height: stripH, channels: 3, background: { r: 13, g: 13, b: 18 } } })
  .composite(composites).png().toFile(path.join(OUT, 'water_animation_strip.png'));

console.log(`\n${frames} palette ticks animate ALL ${waterCellsN} water cells on screen.`);
console.log(`Per-tick cost = ~${Math.round(totalBytes/frames)} bytes (one OSC-4 packet; ZERO cells rewritten).`);
console.log(`Truecolor repaint of the same water region ≈ ${((waterCellsN * 22))|0} bytes/frame -> ~${Math.round((waterCellsN*22)/(totalBytes/frames))}x more.`);
console.log(`wrote water_animation_strip.png (8-frame filmstrip)`);
