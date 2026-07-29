const ESC = '\x1b';
const DEFAULT_COLOR = (20 << 16) | (20 << 8) | 25;
const INDEX_COLOR_BASE = 1 << 24;
const SPACE = 0x20;
const FULL_BLOCK = 0x2588;

interface EmulatorCell {
  codepoint: number;
  foreground: number;
  background: number;
}

const cell = (
  codepoint = SPACE,
  foreground = DEFAULT_COLOR,
  background = DEFAULT_COLOR,
): EmulatorCell => ({ codepoint, foreground, background });

/**
 * Small deterministic emulator for the ANSI subset emitted by TerminalCodec.
 * It is deliberately independent of the encoder so byte-different candidates
 * can be judged by their resulting terminal pixels instead of by string
 * identity. Unsupported control sequences fail closed in tests.
 */
export class TerminalEmulator {
  private readonly cells: EmulatorCell[][];
  private cursorX = 0;
  private cursorY = 0;
  private savedX = 0;
  private savedY = 0;
  private top = 0;
  private bottom: number;
  private left = 0;
  private right: number;
  private foreground = DEFAULT_COLOR;
  private background = DEFAULT_COLOR;
  private lastCodepoint = SPACE;

  constructor(
    private readonly columns: number,
    private readonly rows: number,
  ) {
    this.bottom = rows - 1;
    this.right = columns - 1;
    this.cells = Array.from(
      { length: rows },
      () => Array.from({ length: columns }, () => cell()),
    );
  }

  apply(input: string): void {
    for (let offset = 0; offset < input.length;) {
      const codepoint = input.codePointAt(offset)!;
      if (codepoint !== ESC.codePointAt(0)) {
        this.put(codepoint);
        offset += codepoint > 0xffff ? 2 : 1;
        continue;
      }

      const marker = input[offset + 1];
      if (marker === '7') {
        this.savedX = this.cursorX;
        this.savedY = this.cursorY;
        offset += 2;
        continue;
      }
      if (marker === '8') {
        this.cursorX = this.savedX;
        this.cursorY = this.savedY;
        offset += 2;
        continue;
      }
      if (marker === ']') {
        offset = this.skipOsc(input, offset + 2);
        continue;
      }
      if (marker !== '[') {
        throw new Error(`Unsupported escape marker ${JSON.stringify(marker)}`);
      }

      let end = offset + 2;
      while (end < input.length) {
        const value = input.charCodeAt(end);
        if (value >= 0x40 && value <= 0x7e) break;
        end++;
      }
      if (end >= input.length) throw new Error('Unterminated CSI sequence');
      const raw = input.slice(offset + 2, end);
      this.csi(raw, input[end]!);
      offset = end + 1;
    }
  }

  /** Canonical visible-cell state. Solid cells compare by their painted color,
   * so a full block and a background-painted space are correctly equivalent. */
  visibleSnapshot(): string[][] {
    return this.cells.map((row) => row.map((value) => {
      if (value.codepoint === SPACE) return `solid:${value.background}`;
      if (value.codepoint === FULL_BLOCK) return `solid:${value.foreground}`;
      if (value.foreground === value.background) return `solid:${value.foreground}`;
      return `glyph:${value.codepoint}:${value.foreground}:${value.background}`;
    }));
  }

  private csi(raw: string, final: string): void {
    if (raw.startsWith('?') && (final === 'h' || final === 'l')) return;
    const params = raw === ''
      ? []
      : raw.split(';').map((value) => value === '' ? 0 : Number.parseInt(value, 10));
    if (params.some((value) => !Number.isFinite(value))) {
      throw new Error(`Invalid CSI parameters ${JSON.stringify(raw)}`);
    }

    switch (final) {
      case 'H':
      case 'f':
        this.cursorY = this.clamp((params[0] || 1) - 1, 0, this.rows - 1);
        this.cursorX = this.clamp((params[1] || 1) - 1, 0, this.columns - 1);
        return;
      case 'r':
        this.top = this.clamp((params[0] || 1) - 1, 0, this.rows - 1);
        this.bottom = this.clamp((params[1] || this.rows) - 1, this.top, this.rows - 1);
        return;
      case 's':
        this.left = this.clamp((params[0] || 1) - 1, 0, this.columns - 1);
        this.right = this.clamp((params[1] || this.columns) - 1, this.left, this.columns - 1);
        return;
      case 'm':
        this.sgr(params.length === 0 ? [0] : params);
        return;
      case 'P':
        this.deleteCharacters(params[0] || 1);
        return;
      case '@':
        this.insertCharacters(params[0] || 1);
        return;
      case 'S':
        this.scroll(params[0] || 1);
        return;
      case 'T':
        this.scroll(-(params[0] || 1));
        return;
      case 'b':
        for (let count = params[0] || 1; count > 0; count--) this.put(this.lastCodepoint);
        return;
      default:
        throw new Error(`Unsupported CSI final ${JSON.stringify(final)}`);
    }
  }

  private sgr(params: number[]): void {
    for (let index = 0; index < params.length; index++) {
      const parameter = params[index]!;
      if (parameter === 0) {
        this.foreground = DEFAULT_COLOR;
        this.background = DEFAULT_COLOR;
        continue;
      }
      if (parameter !== 38 && parameter !== 48) {
        throw new Error(`Unsupported SGR parameter ${parameter}`);
      }
      const channel = parameter === 38 ? 'foreground' : 'background';
      const mode = params[++index];
      if (mode === 5) {
        this[channel] = INDEX_COLOR_BASE + (params[++index] ?? 0);
      } else if (mode === 2) {
        const red = params[++index] ?? 0;
        const green = params[++index] ?? 0;
        const blue = params[++index] ?? 0;
        this[channel] = (red << 16) | (green << 8) | blue;
      } else {
        throw new Error(`Unsupported SGR color mode ${String(mode)}`);
      }
    }
  }

  private put(codepoint: number): void {
    if (this.cursorY >= 0 && this.cursorY < this.rows &&
        this.cursorX >= 0 && this.cursorX < this.columns) {
      this.cells[this.cursorY]![this.cursorX] = cell(
        codepoint,
        this.foreground,
        this.background,
      );
    }
    this.lastCodepoint = codepoint;
    this.cursorX++;
  }

  private deleteCharacters(requested: number): void {
    const count = Math.min(requested, this.right - this.cursorX + 1);
    const row = this.cells[this.cursorY]!;
    for (let x = this.cursorX; x <= this.right - count; x++) row[x] = row[x + count]!;
    for (let x = this.right - count + 1; x <= this.right; x++) {
      row[x] = cell(SPACE, this.foreground, this.background);
    }
  }

  private insertCharacters(requested: number): void {
    const count = Math.min(requested, this.right - this.cursorX + 1);
    const row = this.cells[this.cursorY]!;
    for (let x = this.right; x >= this.cursorX + count; x--) row[x] = row[x - count]!;
    for (let x = this.cursorX; x < this.cursorX + count; x++) {
      row[x] = cell(SPACE, this.foreground, this.background);
    }
  }

  private scroll(amount: number): void {
    const count = Math.min(Math.abs(amount), this.bottom - this.top + 1);
    if (amount > 0) {
      for (let y = this.top; y <= this.bottom - count; y++) {
        this.copyMargin(this.cells[y + count]!, this.cells[y]!);
      }
      for (let y = this.bottom - count + 1; y <= this.bottom; y++) this.blankMargin(this.cells[y]!);
    } else {
      for (let y = this.bottom; y >= this.top + count; y--) {
        this.copyMargin(this.cells[y - count]!, this.cells[y]!);
      }
      for (let y = this.top; y < this.top + count; y++) this.blankMargin(this.cells[y]!);
    }
  }

  private copyMargin(source: EmulatorCell[], target: EmulatorCell[]): void {
    for (let x = this.left; x <= this.right; x++) target[x] = { ...source[x]! };
  }

  private blankMargin(row: EmulatorCell[]): void {
    for (let x = this.left; x <= this.right; x++) {
      row[x] = cell(SPACE, this.foreground, this.background);
    }
  }

  private skipOsc(input: string, start: number): number {
    for (let offset = start; offset < input.length; offset++) {
      if (input.charCodeAt(offset) === 7) return offset + 1;
      if (input[offset] === ESC && input[offset + 1] === '\\') return offset + 2;
    }
    throw new Error('Unterminated OSC sequence');
  }

  private clamp(value: number, minimum: number, maximum: number): number {
    return Math.max(minimum, Math.min(maximum, value));
  }
}
