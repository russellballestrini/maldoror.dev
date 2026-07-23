/**
 * FAITHFUL terminal render of a captured ANSI stream — the HONEST way to see
 * what the game actually looks like in Ghostty. Do NOT trust the idealized
 * preview rasterizers (octant-image.mjs etc.); they flatter the output. This
 * replays the real bytes the game emits through a mini terminal emulator (a
 * persistent cell grid handling the subset of ANSI the game uses), then draws
 * each cell the way Ghostty geometrically fills it (2 colours/cell; octant =
 * crisp 2×4 sub-fills; ▀ = top half). Use a REALISTIC window size (e.g. 160×45),
 * not 300 cols.
 *
 * Capture first (python pty, MUST set TIOCSWINSZ + a ghostty TERM):
 *   ... capture the ssh stream to a .bin at COLSxROWS ...
 * Then:
 *   node tools/render-sim/faithful-render.mjs <capture.bin> <cols> <rows> [out.png]
 */
import fs from 'fs';
import sharp from 'sharp';
import path from 'path';
import { fileURLToPath } from 'url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OCT = (await import(`${REPO}/packages/render/dist/pixel/octant-chars.js`)).OCTANT_CHARS;
const OCTMAP = new Map(); OCT.forEach((ch, p) => { if (!OCTMAP.has(ch.codePointAt(0))) OCTMAP.set(ch.codePointAt(0), p); });

const binPath = process.argv[2];
const COLS = parseInt(process.argv[3] || '160', 10);
const ROWS = parseInt(process.argv[4] || '45', 10);
const out = process.argv[5] || binPath.replace(/\.bin$/, '') + '_faithful.png';
const s = fs.readFileSync(binPath).toString('utf8');

const cell = () => ({ ch: ' ', fg: null, bg: null });
const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, cell));
let cr = 0, cc = 0, fg = null, bg = null;
function setSGR(params) {
  const t = params.length ? params.split(';').map(x => x === '' ? 0 : parseInt(x, 10)) : [0];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 0) { fg = null; bg = null; }
    else if (t[i] === 38 && t[i + 1] === 2) { fg = { r: t[i + 2], g: t[i + 3], b: t[i + 4] }; i += 4; }
    else if (t[i] === 48 && t[i + 1] === 2) { bg = { r: t[i + 2], g: t[i + 3], b: t[i + 4] }; i += 4; }
    else if ((t[i] === 38 || t[i] === 48) && t[i + 1] === 5) { i += 2; }
  }
}
let i = 0;
while (i < s.length) {
  const c = s[i];
  if (c === '\x1b') {
    const n = s[i + 1];
    if (n === '[') {
      let j = i + 2; while (j < s.length && !(s[j] >= '@' && s[j] <= '~')) j++;
      const fin = s[j], params = s.slice(i + 2, j);
      if (fin === 'H' || fin === 'f') { const p = params.split(';'); cr = (parseInt(p[0] || '1', 10) || 1) - 1; cc = (parseInt(p[1] || '1', 10) || 1) - 1; }
      else if (fin === 'C') cc += parseInt(params || '1', 10) || 1;
      else if (fin === 'D') cc -= parseInt(params || '1', 10) || 1;
      else if (fin === 'm') setSGR(params);
      else if (fin === 'J') { const p = parseInt(params || '0', 10) || 0;
        if (p >= 2) { for (const row of grid) for (const cel of row) { cel.ch = ' '; cel.fg = null; cel.bg = null; } }
        else { for (let x = cc; x < COLS; x++) grid[cr] && (grid[cr][x] = cell());
               for (let y = cr + 1; y < ROWS; y++) for (let x = 0; x < COLS; x++) grid[y][x] = cell(); } }
      else if (fin === 'K') { const p = parseInt(params || '0', 10) || 0;
        if (grid[cr]) { const a = p === 1 ? 0 : cc, b = p === 0 ? COLS : (p === 1 ? cc + 1 : COLS);
          for (let x = (p === 2 ? 0 : a); x < (p === 2 ? COLS : b); x++) grid[cr][x] = cell(); } }
      i = j + 1; continue;
    } else if (n === ']') { let j = i + 2; while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++; i = s[j] === '\x07' ? j + 1 : j + 2; continue; }
    else { i += 2; continue; }
  } else if (c === '\r') { cc = 0; i++; }
  else if (c === '\n') { cr++; i++; }
  else { const code = s.codePointAt(i); const chStr = String.fromCodePoint(code);
    if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) grid[cr][cc] = { ch: chStr, fg, bg };
    cc++; i += chStr.length; }
}
const CW = 9, CH = 18, W = COLS * CW, H = ROWS * CH;
const img = Buffer.alloc(W * H * 3);
const DEF = { r: 15, g: 15, b: 20 };
const fill = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const k = (y * W + x) * 3; img[k] = c.r; img[k + 1] = c.g; img[k + 2] = c.b; } };
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const cel = grid[y][x], px = x * CW, py = y * CH, cbg = cel.bg ?? DEF, cfg = cel.fg ?? cbg;
  fill(px, py, CW, CH, cbg);
  const code = cel.ch.codePointAt(0);
  if (cel.ch === '▀') fill(px, py, CW, CH / 2, cel.fg ?? DEF);
  else if (OCTMAP.has(code)) { const pat = OCTMAP.get(code);
    for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 2; c2++) if (pat & (1 << (r * 2 + c2))) fill(px + c2 * (CW / 2), py + Math.round(r * CH / 4), Math.ceil(CW / 2), Math.ceil(CH / 4), cfg); }
  else if (code >= 0x2580 && code <= 0x259F) fill(px, py, CW, CH, cfg);
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(`wrote ${out} (${W}x${H}, ${COLS}x${ROWS} cells @ ${CW}x${CH}px) — this is the HONEST look`);
