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

const cell = (style = {}) => ({
  ch: ' ', fg: null, bg: null, fgIndex: null, bgIndex: null, ...style,
});
const cloneCell = (source) => ({ ...source, fg: source.fg && { ...source.fg }, bg: source.bg && { ...source.bg } });
const grid = Array.from({ length: ROWS }, () => Array.from({ length: COLS }, cell));
let cr = 0, cc = 0, fg = null, bg = null, fgIndex = null, bgIndex = null;
let scrollTop = 0, scrollBottom = ROWS - 1, scrollLeft = 0, scrollRight = COLS - 1;
let decslrm = false, savedCursor = null, lastPrinted = null;

const ansi16 = [
  [0, 0, 0], [205, 0, 0], [0, 205, 0], [205, 205, 0],
  [0, 0, 238], [205, 0, 205], [0, 205, 205], [229, 229, 229],
  [127, 127, 127], [255, 0, 0], [0, 255, 0], [255, 255, 0],
  [92, 92, 255], [255, 0, 255], [0, 255, 255], [255, 255, 255],
];
const defaultPalette = Array.from({ length: 256 }, (_, index) => {
  if (index < 16) { const [r, g, b] = ansi16[index]; return { r, g, b }; }
  if (index < 232) {
    const n = index - 16, levels = [0, 95, 135, 175, 215, 255];
    return { r: levels[Math.floor(n / 36)], g: levels[Math.floor(n / 6) % 6], b: levels[n % 6] };
  }
  const v = 8 + (index - 232) * 10;
  return { r: v, g: v, b: v };
});
const palette = defaultPalette.map((colour) => ({ ...colour }));

const currentBlank = () => cell({
  fg: fg && { ...fg }, bg: bg && { ...bg }, fgIndex, bgIndex,
});
const putCell = (value) => {
  const printed = {
    ch: value,
    fg: fg && { ...fg },
    bg: bg && { ...bg },
    fgIndex,
    bgIndex,
  };
  if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) grid[cr][cc] = printed;
  lastPrinted = cloneCell(printed);
  cc++;
};

function setSGR(params) {
  const t = params.length ? params.split(';').map(x => x === '' ? 0 : parseInt(x, 10)) : [0];
  for (let i = 0; i < t.length; i++) {
    if (t[i] === 0) { fg = null; bg = null; fgIndex = null; bgIndex = null; }
    else if (t[i] === 39) { fg = null; fgIndex = null; }
    else if (t[i] === 49) { bg = null; bgIndex = null; }
    else if (t[i] === 38 && t[i + 1] === 2) { fg = { r: t[i + 2], g: t[i + 3], b: t[i + 4] }; fgIndex = null; i += 4; }
    else if (t[i] === 48 && t[i + 1] === 2) { bg = { r: t[i + 2], g: t[i + 3], b: t[i + 4] }; bgIndex = null; i += 4; }
    else if (t[i] === 38 && t[i + 1] === 5) { fgIndex = t[i + 2]; fg = null; i += 2; }
    else if (t[i] === 48 && t[i + 1] === 5) { bgIndex = t[i + 2]; bg = null; i += 2; }
  }
}

function scrollVertical(direction, amount) {
  const n = Math.min(Math.max(1, amount), scrollBottom - scrollTop + 1);
  if (direction === 'up') {
    for (let y = scrollTop; y <= scrollBottom - n; y++) {
      for (let x = scrollLeft; x <= scrollRight; x++) grid[y][x] = cloneCell(grid[y + n][x]);
    }
    for (let y = scrollBottom - n + 1; y <= scrollBottom; y++) {
      for (let x = scrollLeft; x <= scrollRight; x++) grid[y][x] = currentBlank();
    }
  } else {
    for (let y = scrollBottom; y >= scrollTop + n; y--) {
      for (let x = scrollLeft; x <= scrollRight; x++) grid[y][x] = cloneCell(grid[y - n][x]);
    }
    for (let y = scrollTop; y < scrollTop + n; y++) {
      for (let x = scrollLeft; x <= scrollRight; x++) grid[y][x] = currentBlank();
    }
  }
}

function shiftRow(direction, amount) {
  if (cr < 0 || cr >= ROWS || cc > scrollRight) return;
  const n = Math.min(Math.max(1, amount), scrollRight - cc + 1);
  if (direction === 'left') {
    for (let x = cc; x <= scrollRight - n; x++) grid[cr][x] = cloneCell(grid[cr][x + n]);
    for (let x = scrollRight - n + 1; x <= scrollRight; x++) grid[cr][x] = currentBlank();
  } else {
    for (let x = scrollRight; x >= cc + n; x--) grid[cr][x] = cloneCell(grid[cr][x - n]);
    for (let x = cc; x < cc + n; x++) grid[cr][x] = currentBlank();
  }
}

function applyOsc(payload) {
  const fields = payload.split(';');
  if (fields[0] !== '4') return;
  for (let p = 1; p + 1 < fields.length; p += 2) {
    const index = Number.parseInt(fields[p], 10), value = fields[p + 1];
    if (!Number.isInteger(index) || index < 0 || index > 255 || !value?.startsWith('rgb:')) continue;
    const components = value.slice(4).split('/');
    if (components.length !== 3) continue;
    const rgb = components.map((component) => {
      const parsed = Number.parseInt(component, 16);
      return component.length > 2 ? Math.round(parsed * 255 / (16 ** component.length - 1)) : parsed;
    });
    if (rgb.every(Number.isFinite)) palette[index] = { r: rgb[0], g: rgb[1], b: rgb[2] };
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
      const plainParams = params.replace(/^\?/, '');
      const amount = parseInt(plainParams || '1', 10) || 1;
      if (fin === 'H' || fin === 'f') { const p = plainParams.split(';'); cr = (parseInt(p[0] || '1', 10) || 1) - 1; cc = (parseInt(p[1] || '1', 10) || 1) - 1; }
      else if (fin === 'A') cr -= amount;
      else if (fin === 'B') cr += amount;
      else if (fin === 'C') cc += amount;
      else if (fin === 'D') cc -= amount;
      else if (fin === 'G') cc = amount - 1;
      else if (fin === 'm') setSGR(params);
      else if (fin === 'h' && params === '?69') decslrm = true;
      else if (fin === 'l' && params === '?69') { decslrm = false; scrollLeft = 0; scrollRight = COLS - 1; }
      else if (fin === 'r') {
        if (!plainParams) { scrollTop = 0; scrollBottom = ROWS - 1; }
        else { const p = plainParams.split(';'); scrollTop = Math.max(0, (parseInt(p[0] || '1', 10) || 1) - 1); scrollBottom = Math.min(ROWS - 1, (parseInt(p[1] || String(ROWS), 10) || ROWS) - 1); }
      }
      else if (fin === 's' && decslrm && plainParams.includes(';')) { const p = plainParams.split(';'); scrollLeft = Math.max(0, (parseInt(p[0] || '1', 10) || 1) - 1); scrollRight = Math.min(COLS - 1, (parseInt(p[1] || String(COLS), 10) || COLS) - 1); }
      else if (fin === 'S') scrollVertical('up', amount);
      else if (fin === 'T') scrollVertical('down', amount);
      else if (fin === 'P') shiftRow('left', amount);
      else if (fin === '@') shiftRow('right', amount);
      else if (fin === 'X') { for (let x = cc; x < Math.min(COLS, cc + amount); x++) if (grid[cr]) grid[cr][x] = currentBlank(); }
      else if (fin === 'b' && lastPrinted) { for (let count = 0; count < amount; count++) { if (cr >= 0 && cr < ROWS && cc >= 0 && cc < COLS) grid[cr][cc] = cloneCell(lastPrinted); cc++; } }
      else if (fin === 'J') { const p = parseInt(params || '0', 10) || 0;
        if (p >= 2) { for (const row of grid) for (const cel of row) { cel.ch = ' '; cel.fg = null; cel.bg = null; } }
        else { for (let x = cc; x < COLS; x++) grid[cr] && (grid[cr][x] = cell());
               for (let y = cr + 1; y < ROWS; y++) for (let x = 0; x < COLS; x++) grid[y][x] = cell(); } }
      else if (fin === 'K') { const p = parseInt(params || '0', 10) || 0;
        if (grid[cr]) { const a = p === 1 ? 0 : cc, b = p === 0 ? COLS : (p === 1 ? cc + 1 : COLS);
          for (let x = (p === 2 ? 0 : a); x < (p === 2 ? COLS : b); x++) grid[cr][x] = cell(); } }
      cr = Math.max(0, Math.min(ROWS - 1, cr)); cc = Math.max(0, Math.min(COLS, cc));
      i = j + 1; continue;
    } else if (n === ']') { let j = i + 2; while (j < s.length && s[j] !== '\x07' && !(s[j] === '\x1b' && s[j + 1] === '\\')) j++; applyOsc(s.slice(i + 2, j)); i = s[j] === '\x07' ? j + 1 : j + 2; continue; }
    else if (n === '7') { savedCursor = { cr, cc }; i += 2; continue; }
    else if (n === '8') { if (savedCursor) ({ cr, cc } = savedCursor); i += 2; continue; }
    else { i += 2; continue; }
  } else if (c === '\r') { cc = 0; i++; }
  else if (c === '\n') { cr++; i++; }
  else { const code = s.codePointAt(i); const chStr = String.fromCodePoint(code);
    putCell(chStr); i += chStr.length; }
}
const CW = 9, CH = 18, W = COLS * CW, H = ROWS * CH;
const img = Buffer.alloc(W * H * 3);
const DEF = { r: 15, g: 15, b: 20 };
const fill = (x0, y0, w, h, c) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const k = (y * W + x) * 3; img[k] = c.r; img[k + 1] = c.g; img[k + 2] = c.b; } };
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
  const cel = grid[y][x], px = x * CW, py = y * CH;
  const cbg = cel.bgIndex != null ? palette[cel.bgIndex] : (cel.bg ?? DEF);
  const cfg = cel.fgIndex != null ? palette[cel.fgIndex] : (cel.fg ?? cbg);
  fill(px, py, CW, CH, cbg);
  const code = cel.ch.codePointAt(0);
  if (cel.ch === '▀') fill(px, py, CW, CH / 2, cel.fg ?? DEF);
  else if (OCTMAP.has(code)) { const pat = OCTMAP.get(code);
    for (let r = 0; r < 4; r++) for (let c2 = 0; c2 < 2; c2++) if (pat & (1 << (r * 2 + c2))) {
      // Ghostty cells are commonly odd-sized in device pixels. Integer cell
      // partitions must cover each pixel exactly once; writing a Node Buffer
      // at fractional indices silently drops half of every octant column.
      const x0 = Math.round(c2 * CW / 2), x1 = Math.round((c2 + 1) * CW / 2);
      const y0 = Math.round(r * CH / 4), y1 = Math.round((r + 1) * CH / 4);
      fill(px + x0, py + y0, x1 - x0, y1 - y0, cfg);
    } }
  else if (code >= 0x2580 && code <= 0x259F) fill(px, py, CW, CH, cfg);
}
await sharp(img, { raw: { width: W, height: H, channels: 3 } }).png().toFile(out);
console.log(`wrote ${out} (${W}x${H}, ${COLS}x${ROWS} cells @ ${CW}x${CH}px) — this is the HONEST look`);
