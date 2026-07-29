import { bgCodePacked, sgrCode, sgrCodePacked } from './ansi-cache.js';
import {
  cellsEqual,
  type CellGrid,
  type PackedCellGrid,
  type TerminalCell,
} from './pixel-renderer.js';
import { OCTANT_CHARS } from './octant-chars.js';

const ESC = '\x1b';
const SAVE_CURSOR = `${ESC}7`;
const RESTORE_CURSOR = `${ESC}8`;

const DEFAULT_COLOR = { r: 20, g: 20, b: 25 } as const;
const DEFAULT_COLOR_PACKED = (20 << 16) | (20 << 8) | 25;
const SPACE_CODEPOINT = 0x20;
const FULL_BLOCK_CODEPOINT = 0x2588;
const SINGLE_COLUMN_OCTANT_CODEPOINTS = new Set(
  OCTANT_CHARS.map((char) => char.codePointAt(0) ?? SPACE_CODEPOINT),
);

export interface TerminalCodecCamera {
  /** Camera centre in the renderer's world-pixel coordinate system. */
  x: number;
  y: number;
  /** Number of renderer pixels represented by one logical CellGrid cell. */
  cellPixelWidth: number;
  cellPixelHeight: number;
  /** Width occupied by one CellGrid cell in terminal columns. */
  terminalCellWidth?: number;
  /** Motion compensation is only valid for an unrotated camera. */
  rotation?: 0 | 90 | 180 | 270;
}

export interface TerminalCodecMetrics {
  bytes: number;
  changedCells: number;
  totalCells: number;
  scrollColumns: number;
  scrollRows: number;
  keyframe: boolean;
}

export interface TerminalCodecFrame {
  output: string;
  metrics: TerminalCodecMetrics;
}

export interface TerminalCodecConfig {
  headerRows: number;
  terminalCols: number;
  terminalRows: number;
  /** Avoid using a scroll vector so large that a direct redraw is cheaper. */
  maxScrollFraction?: number;
}

/**
 * Motion-compensated ANSI encoder for a retained terminal framebuffer.
 *
 * The target CellGrid is still composed by the renderer. The codec first
 * translates its retained terminal_view with terminal-native scroll/insert/
 * delete operations, mirrors that translation in memory, then emits only the
 * residual changed runs (exposed edges, actors, effects). This makes camera
 * motion a copy plus repairs instead of a repaint.
 */
export class TerminalCodec {
  private config: TerminalCodecConfig;
  private terminalView: CellGrid = [];
  private packedTerminalView: PackedCellGrid | null = null;
  private viewKind: 'object' | 'packed' | null = null;
  private previousCamera: TerminalCodecCamera | null = null;
  private forceKeyframe = true;

  constructor(config: TerminalCodecConfig) {
    this.config = { ...config, maxScrollFraction: config.maxScrollFraction ?? 0.6 };
  }

  resize(terminalCols: number, terminalRows: number): void {
    if (terminalCols === this.config.terminalCols && terminalRows === this.config.terminalRows) return;
    this.config.terminalCols = terminalCols;
    this.config.terminalRows = terminalRows;
    this.reset();
  }

  reset(): void {
    this.terminalView = [];
    this.packedTerminalView = null;
    this.viewKind = null;
    this.previousCamera = null;
    this.forceKeyframe = true;
  }

  /** Force the next packet to be an independently decodable I-frame. */
  requestKeyframe(): void {
    this.forceKeyframe = true;
  }

  encode(target: CellGrid, camera: TerminalCodecCamera): TerminalCodecFrame {
    const height = target.length;
    const width = target[0]?.length ?? 0;
    const totalCells = height * width;
    const terminalCellWidth = Math.max(1, camera.terminalCellWidth ?? 1);
    const normalizedCamera = { ...camera, terminalCellWidth };

    const dimensionsChanged =
      this.terminalView.length !== height ||
      (this.terminalView[0]?.length ?? 0) !== width;

    let output = '';
    let scrollColumns = 0;
    let scrollRows = 0;
    let keyframe = this.forceKeyframe || dimensionsChanged || this.viewKind !== 'object';

    if (!keyframe && this.previousCamera && camera.rotation === 0 && this.previousCamera.rotation === 0) {
      const vector = this.cameraVector(normalizedCamera, width, height);
      if (vector) {
        scrollColumns = vector.x;
        scrollRows = vector.y;
        if (scrollColumns !== 0 || scrollRows !== 0) {
          output += this.emitScroll(scrollColumns, scrollRows, width, height, terminalCellWidth);
          this.shiftTerminalView(scrollColumns, scrollRows, width, height);
        }
      }
    }

    let changedCells: number;
    if (keyframe) {
      const full = this.emitKeyframe(target, terminalCellWidth);
      output += full.output;
      changedCells = totalCells;
      this.forceKeyframe = false;
    } else {
      const patch = this.emitChangedRuns(target, terminalCellWidth);
      output += patch.output;
      changedCells = patch.changedCells;
    }

    // Target rows are freshly produced for every render; retaining their
    // references is safe and avoids a deep framebuffer copy.
    this.terminalView = target;
    this.packedTerminalView = null;
    this.viewKind = 'object';
    this.previousCamera = normalizedCamera;

    return {
      output,
      metrics: {
        bytes: Buffer.byteLength(output, 'utf8'),
        changedCells,
        totalCells,
        scrollColumns,
        scrollRows,
        keyframe,
      },
    };
  }

  /** Encode the production OCTANT struct-of-arrays frame without materializing
   * a TerminalCell/RGB object graph. Output and motion compensation mirror
   * `encode`, including independently decodable keyframes. */
  encodePacked(target: PackedCellGrid, camera: TerminalCodecCamera): TerminalCodecFrame {
    const height = target.height;
    const width = target.width;
    const totalCells = height * width;
    const terminalCellWidth = Math.max(1, camera.terminalCellWidth ?? 1);
    const normalizedCamera = { ...camera, terminalCellWidth };
    const previous = this.packedTerminalView;
    const dimensionsChanged = !previous || previous.height !== height || previous.width !== width;

    let output = '';
    let scrollColumns = 0;
    let scrollRows = 0;
    let keyframe = this.forceKeyframe || dimensionsChanged || this.viewKind !== 'packed';

    if (!keyframe && this.previousCamera && camera.rotation === 0 && this.previousCamera.rotation === 0) {
      const vector = this.cameraVector(normalizedCamera, width, height);
      if (vector) {
        scrollColumns = vector.x;
        scrollRows = vector.y;
        if (scrollColumns !== 0 || scrollRows !== 0) {
          output += this.emitScroll(scrollColumns, scrollRows, width, height, terminalCellWidth);
          this.shiftPackedTerminalView(scrollColumns, scrollRows);
        }
      }
    }

    let changedCells: number;
    if (keyframe) {
      output += this.emitPackedKeyframe(target, terminalCellWidth);
      changedCells = totalCells;
      this.forceKeyframe = false;
    } else {
      const patch = this.emitPackedChangedRuns(target, terminalCellWidth);
      output += patch.output;
      changedCells = patch.changedCells;
    }

    this.packedTerminalView = target;
    this.terminalView = [];
    this.viewKind = 'packed';
    this.previousCamera = normalizedCamera;

    return {
      output,
      metrics: {
        bytes: Buffer.byteLength(output, 'utf8'),
        changedCells,
        totalCells,
        scrollColumns,
        scrollRows,
        keyframe,
      },
    };
  }

  private cameraVector(
    camera: TerminalCodecCamera,
    width: number,
    height: number
  ): { x: number; y: number } | null {
    const previous = this.previousCamera!;
    if (previous.cellPixelWidth !== camera.cellPixelWidth ||
        previous.cellPixelHeight !== camera.cellPixelHeight ||
        previous.terminalCellWidth !== camera.terminalCellWidth) {
      return null;
    }

    const rawX = (camera.x - previous.x) / camera.cellPixelWidth;
    const rawY = (camera.y - previous.y) / camera.cellPixelHeight;
    const x = Math.round(rawX);
    const y = Math.round(rawY);

    // A terminal scroll is exact only when the camera moved a whole cell.
    if (Math.abs(rawX - x) > 0.01 || Math.abs(rawY - y) > 0.01) return null;

    const maxFraction = this.config.maxScrollFraction ?? 0.6;
    if (Math.abs(x) > width * maxFraction || Math.abs(y) > height * maxFraction) return null;
    return { x, y };
  }

  private worldMargins(width: number, height: number, cellWidth: number): string {
    const top = this.config.headerRows + 1;
    const bottom = Math.min(this.config.terminalRows, top + height - 1);
    const right = Math.min(this.config.terminalCols, width * cellWidth);
    // DECSTBM + DECSLRM. Once left/right margin mode is enabled, CSI s means
    // margins, so cursor save/restore must use ESC 7 / ESC 8.
    return `${ESC}[?69h${ESC}[${top};${bottom}r${ESC}[1;${right}s`;
  }

  private emitScroll(dx: number, dy: number, width: number, height: number, cellWidth: number): string {
    const top = this.config.headerRows + 1;
    const chunks = [SAVE_CURSOR, this.worldMargins(width, height, cellWidth)];

    if (dy > 0) {
      // Camera down: retained world moves up.
      chunks.push(`${ESC}[${top};1H${ESC}[${dy}S`);
    } else if (dy < 0) {
      // Camera up: retained world moves down.
      chunks.push(`${ESC}[${top};1H${ESC}[${-dy}T`);
    }

    const terminalDx = Math.abs(dx) * cellWidth;
    if (terminalDx > 0) {
      for (let y = 0; y < height; y++) {
        chunks.push(`${ESC}[${top + y};1H`);
        // Camera right => delete at left (content shifts left). Camera left =>
        // insert at left (content shifts right).
        chunks.push(dx > 0 ? `${ESC}[${terminalDx}P` : `${ESC}[${terminalDx}@`);
      }
    }

    chunks.push(RESTORE_CURSOR);
    return chunks.join('');
  }

  private shiftTerminalView(dx: number, dy: number, width: number, height: number): void {
    let shifted = this.terminalView;
    if (dy > 0) {
      shifted = shifted.slice(dy);
      while (shifted.length < height) shifted.push(this.blankRow(width));
    } else if (dy < 0) {
      shifted = Array.from({ length: -dy }, () => this.blankRow(width))
        .concat(shifted.slice(0, height + dy));
    }

    if (dx !== 0) {
      shifted = shifted.map((row) => {
        if (dx > 0) return row.slice(dx).concat(this.blankRow(Math.min(dx, width)));
        const count = Math.min(-dx, width);
        return this.blankRow(count).concat(row.slice(0, width - count));
      });
    }
    this.terminalView = shifted;
  }

  private shiftPackedTerminalView(dx: number, dy: number): void {
    const view = this.packedTerminalView;
    if (!view) return;
    const { width, height } = view;
    const planes: Array<{ values: Uint32Array | Int16Array; blank: number }> = [
      { values: view.codepoints, blank: SPACE_CODEPOINT },
      { values: view.foreground, blank: DEFAULT_COLOR_PACKED },
      { values: view.background, blank: DEFAULT_COLOR_PACKED },
      { values: view.foregroundIndex, blank: -1 },
      { values: view.backgroundIndex, blank: -1 },
    ];

    if (dy !== 0) {
      const count = Math.min(Math.abs(dy), height);
      for (const { values, blank } of planes) {
        if (dy > 0) {
          values.copyWithin(0, count * width);
          values.fill(blank, (height - count) * width);
        } else {
          values.copyWithin(count * width, 0, (height - count) * width);
          values.fill(blank, 0, count * width);
        }
      }
    }

    if (dx !== 0) {
      const count = Math.min(Math.abs(dx), width);
      for (let y = 0; y < height; y++) {
        const rowStart = y * width;
        const rowEnd = rowStart + width;
        for (const { values, blank } of planes) {
          if (dx > 0) {
            values.copyWithin(rowStart, rowStart + count, rowEnd);
            values.fill(blank, rowEnd - count, rowEnd);
          } else {
            values.copyWithin(rowStart + count, rowStart, rowEnd - count);
            values.fill(blank, rowStart, rowStart + count);
          }
        }
      }
    }
  }

  private emitPackedKeyframe(target: PackedCellGrid, cellWidth: number): string {
    const chunks: string[] = [SAVE_CURSOR, this.worldMargins(target.width, target.height, cellWidth)];
    let lastFg: number | null = null;
    let lastBg: number | null = null;
    const top = this.config.headerRows + 1;
    for (let y = 0; y < target.height; y++) {
      chunks.push(`${ESC}[${top + y};1H`);
      const emitted = this.emitPackedCells(
        chunks,
        target,
        y * target.width,
        (y + 1) * target.width,
        cellWidth,
        lastFg,
        lastBg,
      );
      lastFg = emitted.lastFg;
      lastBg = emitted.lastBg;
    }
    chunks.push(RESTORE_CURSOR);
    return chunks.join('');
  }

  private emitPackedChangedRuns(
    target: PackedCellGrid,
    cellWidth: number,
  ): { output: string; changedCells: number } {
    const previous = this.packedTerminalView!;
    const chunks: string[] = [];
    const top = this.config.headerRows + 1;
    let changedCells = 0;
    let lastFg: number | null = null;
    let lastBg: number | null = null;
    let cursorRow = -1;
    let cursorColumn = -1;
    for (let y = 0; y < target.height; y++) {
      const rowStart = y * target.width;
      const rowEnd = rowStart + target.width;
      let offset = rowStart;
      while (offset < rowEnd) {
        while (offset < rowEnd && this.packedCellsEqual(target, previous, offset)) offset++;
        if (offset >= rowEnd) break;
        const start = offset;
        while (offset < rowEnd && !this.packedCellsEqual(target, previous, offset)) offset++;
        const end = offset;
        changedCells += end - start;
        const startColumn = (start - rowStart) * cellWidth + 1;
        // Runs are discovered left-to-right. Within one packed OCTANT row the
        // terminal cursor already sits immediately after the previous run, so
        // a relative CUF is both exact and materially shorter than repeating
        // the absolute row and column. Other rows retain the fail-safe CUP.
        if (cellWidth === 1 && cursorRow === y && startColumn > cursorColumn) {
          chunks.push(`${ESC}[${startColumn - cursorColumn}C`);
        } else {
          chunks.push(`${ESC}[${top + y};${startColumn}H`);
        }
        const emitted = this.emitPackedCells(
          chunks,
          target,
          start,
          end,
          cellWidth,
          lastFg,
          lastBg,
        );
        lastFg = emitted.lastFg;
        lastBg = emitted.lastBg;
        cursorRow = emitted.singleColumn ? y : -1;
        cursorColumn = emitted.singleColumn ? startColumn + (end - start) : -1;
        offset = end;
      }
    }
    return { output: chunks.join(''), changedCells };
  }

  private emitPackedCells(
    chunks: string[],
    frame: PackedCellGrid,
    start: number,
    end: number,
    cellWidth: number,
    initialFg: number | null,
    initialBg: number | null,
  ): {
    lastFg: number | null;
    lastBg: number | null;
    singleColumn: boolean;
  } {
    let lastFg = initialFg;
    let lastBg = initialBg;
    let singleColumn = true;
    let offset = start;
    while (offset < end) {
      const fg = frame.foreground[offset] ?? DEFAULT_COLOR_PACKED;
      const bg = frame.background[offset] ?? DEFAULT_COLOR_PACKED;
      const fgIndex = frame.foregroundIndex[offset] ?? -1;
      const bgIndex = frame.backgroundIndex[offset] ?? -1;
      // A truecolor full block whose two channels are identical paints exactly
      // the same terminal pixels as a space with that background. Canonicalize
      // that common OCTANT flat-cell case to avoid formatting an unused
      // foreground and emitting a three-byte glyph. Indexed cells stay on the
      // conservative path because their live OSC-4 values are terminal state.
      const backgroundOnly = frame.codepoints[offset] === FULL_BLOCK_CODEPOINT
        && fgIndex < 0
        && bgIndex < 0
        && fg === bg;
      if (backgroundOnly) {
        if (bg !== lastBg) {
          chunks.push(bgCodePacked(bg));
          lastBg = bg;
        }
      } else if (fgIndex >= 0 || bgIndex >= 0) {
        const parts: string[] = [];
        parts.push(fgIndex >= 0
          ? `38;5;${fgIndex}`
          : `38;2;${(fg >>> 16) & 0xff};${(fg >>> 8) & 0xff};${fg & 0xff}`);
        parts.push(bgIndex >= 0
          ? `48;5;${bgIndex}`
          : `48;2;${(bg >>> 16) & 0xff};${(bg >>> 8) & 0xff};${bg & 0xff}`);
        chunks.push(`${ESC}[${parts.join(';')}m`);
        lastFg = null;
        lastBg = null;
      } else {
        const fgChanged = fg !== lastFg;
        const bgChanged = bg !== lastBg;
        if (fgChanged || bgChanged) {
          chunks.push(sgrCodePacked(fgChanged ? fg : null, bgChanged ? bg : null));
          if (fgChanged) lastFg = fg;
          if (bgChanged) lastBg = bg;
        }
      }

      let count = 1;
      if (cellWidth === 1) {
        while (offset + count < end && this.packedCellsEqual(frame, frame, offset, offset + count)) count++;
      }
      const codepoint = backgroundOnly
        ? SPACE_CODEPOINT
        : (frame.codepoints[offset] || SPACE_CODEPOINT);
      if (!isKnownSingleColumnCodepoint(codepoint)) singleColumn = false;
      const char = String.fromCodePoint(codepoint);
      chunks.push(char);
      if (count >= 4) chunks.push(`${ESC}[${count - 1}b`);
      else for (let i = 1; i < count; i++) chunks.push(char);
      offset += count;
    }
    return { lastFg, lastBg, singleColumn };
  }

  private packedCellsEqual(
    left: PackedCellGrid,
    right: PackedCellGrid,
    leftOffset: number,
    rightOffset = leftOffset,
  ): boolean {
    return left.codepoints[leftOffset] === right.codepoints[rightOffset] &&
      left.foreground[leftOffset] === right.foreground[rightOffset] &&
      left.background[leftOffset] === right.background[rightOffset] &&
      left.foregroundIndex[leftOffset] === right.foregroundIndex[rightOffset] &&
      left.backgroundIndex[leftOffset] === right.backgroundIndex[rightOffset];
  }

  private emitKeyframe(target: CellGrid, cellWidth: number): { output: string } {
    const chunks: string[] = [SAVE_CURSOR, this.worldMargins(target[0]?.length ?? 0, target.length, cellWidth)];
    let lastFg: TerminalCell['fgColor'] = null;
    let lastBg: TerminalCell['bgColor'] = null;
    const top = this.config.headerRows + 1;

    for (let y = 0; y < target.length; y++) {
      const row = target[y] ?? [];
      chunks.push(`${ESC}[${top + y};1H`);
      const emitted = this.emitCells(row, 0, row.length, cellWidth, lastFg, lastBg);
      chunks.push(emitted.output);
      lastFg = emitted.lastFg;
      lastBg = emitted.lastBg;
    }
    chunks.push(RESTORE_CURSOR);
    return { output: chunks.join('') };
  }

  private emitChangedRuns(target: CellGrid, cellWidth: number): { output: string; changedCells: number } {
    const chunks: string[] = [];
    const top = this.config.headerRows + 1;
    let changedCells = 0;
    let lastFg: TerminalCell['fgColor'] = null;
    let lastBg: TerminalCell['bgColor'] = null;

    for (let y = 0; y < target.length; y++) {
      const row = target[y] ?? [];
      const previous = this.terminalView[y] ?? [];
      let x = 0;
      while (x < row.length) {
        while (x < row.length && cellsEqual(row[x]!, previous[x])) x++;
        if (x >= row.length) break;
        const start = x;
        x++;
        let lastChanged = x;
        while (x < row.length) {
          if (!cellsEqual(row[x]!, previous[x])) {
            lastChanged = x + 1;
          } else if (x - lastChanged >= 2) {
            break;
          }
          x++;
        }
        const end = lastChanged;
        changedCells += end - start;
        chunks.push(`${ESC}[${top + y};${start * cellWidth + 1}H`);
        const emitted = this.emitCells(row, start, end, cellWidth, lastFg, lastBg);
        chunks.push(emitted.output);
        lastFg = emitted.lastFg;
        lastBg = emitted.lastBg;
        x = end;
      }
    }
    return { output: chunks.join(''), changedCells };
  }

  private emitCells(
    row: TerminalCell[],
    start: number,
    end: number,
    cellWidth: number,
    initialFg: TerminalCell['fgColor'],
    initialBg: TerminalCell['bgColor']
  ): { output: string; lastFg: TerminalCell['fgColor']; lastBg: TerminalCell['bgColor'] } {
    const chunks: string[] = [];
    let lastFg = initialFg;
    let lastBg = initialBg;
    let x = start;
    while (x < end) {
      const cell = row[x] ?? this.blankCell();
      const fg = cell.fgColor ?? DEFAULT_COLOR;
      const bg = cell.bgColor ?? DEFAULT_COLOR;
      if (cell.fgIndex != null || cell.bgIndex != null) {
        const parts: string[] = [];
        if (cell.fgIndex != null) parts.push(`38;5;${cell.fgIndex}`);
        else parts.push(`38;2;${fg.r};${fg.g};${fg.b}`);
        if (cell.bgIndex != null) parts.push(`48;5;${cell.bgIndex}`);
        else parts.push(`48;2;${bg.r};${bg.g};${bg.b}`);
        chunks.push(`${ESC}[${parts.join(';')}m`);
        // A following truecolor cell must explicitly restore both channels.
        lastFg = null;
        lastBg = null;
      } else {
        const fgChanged = !sameColor(fg, lastFg);
        const bgChanged = !sameColor(bg, lastBg);
        if (fgChanged || bgChanged) {
          chunks.push(sgrCode(fgChanged ? fg : null, bgChanged ? bg : null));
          if (fgChanged) lastFg = fg;
          if (bgChanged) lastBg = bg;
        }
      }

      let count = 1;
      if (cellWidth === 1) {
        while (x + count < end && cellsEqual(cell, row[x + count])) count++;
      }
      chunks.push(cell.char || ' ');
      // REP's argument is the number of additional repetitions.
      if (count >= 4) chunks.push(`${ESC}[${count - 1}b`);
      else for (let i = 1; i < count; i++) chunks.push(cell.char || ' ');
      x += count;
    }
    return { output: chunks.join(''), lastFg, lastBg };
  }

  private blankRow(width: number): TerminalCell[] {
    return Array.from({ length: width }, () => this.blankCell());
  }

  private blankCell(): TerminalCell {
    return { char: ' ', fgColor: DEFAULT_COLOR, bgColor: DEFAULT_COLOR };
  }
}

function sameColor(a: TerminalCell['fgColor'], b: TerminalCell['fgColor']): boolean {
  if (a === null || b === null) return a === b;
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

function isKnownSingleColumnCodepoint(codepoint: number): boolean {
  return (codepoint >= 0x20 && codepoint <= 0x7e)
    || SINGLE_COLUMN_OCTANT_CODEPOINTS.has(codepoint);
}
