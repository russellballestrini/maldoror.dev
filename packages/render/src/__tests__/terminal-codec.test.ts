import { describe, expect, it } from 'vitest';
import { TerminalCodec } from '../pixel/terminal-codec.js';
import type { CellGrid, TerminalCell } from '../pixel/pixel-renderer.js';

const color = { r: 32, g: 96, b: 128 };
const cell = (char: string): TerminalCell => ({ char, fgColor: color, bgColor: color });
const grid = (...rows: string[]): CellGrid => rows.map((row) => [...row].map(cell));
const camera = (x: number, y: number) => ({
  x,
  y,
  cellPixelWidth: 2,
  cellPixelHeight: 4,
  terminalCellWidth: 1,
  rotation: 0 as const,
});

describe('TerminalCodec', () => {
  it('emits an independently decodable keyframe first', () => {
    const codec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    const frame = codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));

    expect(frame.metrics.keyframe).toBe(true);
    expect(frame.metrics.changedCells).toBe(12);
    expect(frame.output).toContain('\x1b[?69h');
    expect(frame.output).toContain('\x1b[3;5r');
    expect(frame.output).toContain('abcd');
  });

  it('encodes an exact horizontal camera cell as DCH plus the exposed edge', () => {
    const codec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));
    const frame = codec.encode(grid('bcdx', 'fghy', 'jklz'), camera(2, 0));

    expect(frame.metrics.keyframe).toBe(false);
    expect(frame.metrics.scrollColumns).toBe(1);
    expect(frame.metrics.changedCells).toBe(3);
    expect(frame.output).toContain('\x1b[1P');
    expect(frame.output).not.toContain('abcd');
  });

  it('encodes an exact vertical camera cell as SU plus the exposed row', () => {
    const codec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));
    const frame = codec.encode(grid('efgh', 'ijkl', 'mnop'), camera(0, 4));

    expect(frame.metrics.scrollRows).toBe(1);
    expect(frame.metrics.changedCells).toBe(4);
    expect(frame.output).toContain('\x1b[1S');
  });

  it('falls back to residual patches for fractional camera motion', () => {
    const codec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));
    const frame = codec.encode(grid('bcde', 'fghi', 'jklm'), camera(1, 0));

    expect(frame.metrics.scrollColumns).toBe(0);
    expect(frame.output).not.toContain('\x1b[1P');
    expect(frame.metrics.changedCells).toBeGreaterThan(3);
  });

  it('can force an I-frame after transport loss', () => {
    const codec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));
    codec.requestKeyframe();
    const frame = codec.encode(grid('abcd', 'efgh', 'ijkl'), camera(0, 0));
    expect(frame.metrics.keyframe).toBe(true);
    expect(frame.metrics.changedCells).toBe(12);
  });
});
