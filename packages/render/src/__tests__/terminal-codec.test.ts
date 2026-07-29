import { describe, expect, it } from 'vitest';
import { TerminalCodec } from '../pixel/terminal-codec.js';
import { TerminalEmulator } from './terminal-emulator.js';
import {
  createPackedCellGrid,
  packedRgb,
  type CellGrid,
  type PackedCellGrid,
  type TerminalCell,
} from '../pixel/pixel-renderer.js';

const color = { r: 32, g: 96, b: 128 };
const cell = (char: string): TerminalCell => ({ char, fgColor: color, bgColor: color });
const grid = (...rows: string[]): CellGrid => rows.map((row) => [...row].map(cell));
const coloredGrid = (
  rows: string[],
  colors: Array<Array<{ r: number; g: number; b: number }>>,
): CellGrid => rows.map((row, y) => [...row].map((char, x) => ({
  char,
  fgColor: colors[y]![x]!,
  bgColor: colors[y]![x]!,
})));
const packed = (source: CellGrid): PackedCellGrid => {
  const target = createPackedCellGrid(source[0]?.length ?? 0, source.length);
  target.foregroundIndex.fill(-1);
  target.backgroundIndex.fill(-1);
  for (let y = 0; y < source.length; y++) {
    for (let x = 0; x < (source[y]?.length ?? 0); x++) {
      const value = source[y]![x]!;
      const offset = y * target.width + x;
      target.codepoints[offset] = value.char.codePointAt(0) ?? 0x20;
      target.foreground[offset] = packedRgb(value.fgColor ?? color);
      target.background[offset] = packedRgb(value.bgColor ?? color);
    }
  }
  return target;
};
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

  it('keeps packed keyframes and motion patches byte-identical to object grids', () => {
    const objectCodec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    const packedCodec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    const first = grid('abcd', 'efgh', 'ijkl');
    const second = grid('bcdx', 'fghy', 'jklz');

    expect(packedCodec.encodePacked(packed(first), camera(0, 0)))
      .toEqual(objectCodec.encode(first, camera(0, 0)));
    expect(packedCodec.encodePacked(packed(second), camera(2, 0)))
      .toEqual(objectCodec.encode(second, camera(2, 0)));
  });

  it('canonicalizes flat OCTANT blocks without changing terminal pixels', () => {
    const objectCodec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    const packedCodec = new TerminalCodec({ headerRows: 2, terminalCols: 4, terminalRows: 5 });
    const objectTerminal = new TerminalEmulator(4, 5);
    const packedTerminal = new TerminalEmulator(4, 5);
    const first = coloredGrid(
      ['████', '████', '████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({
        r: 30 + x * 20,
        g: 50 + y * 30,
        b: 90 + x * 10,
      }))),
    );
    const second = coloredGrid(
      ['████', '████', '████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({
        r: 35 + x * 20,
        g: 55 + y * 30,
        b: 95 + x * 10,
      }))),
    );

    const objectKeyframe = objectCodec.encode(first, camera(0, 0));
    const packedKeyframe = packedCodec.encodePacked(packed(first), camera(0, 0));
    expect(packedKeyframe.output).not.toEqual(objectKeyframe.output);
    expect(packedKeyframe.output).not.toContain('█');
    objectTerminal.apply(objectKeyframe.output);
    packedTerminal.apply(packedKeyframe.output);
    expect(packedTerminal.visibleSnapshot()).toEqual(objectTerminal.visibleSnapshot());

    const objectPatch = objectCodec.encode(second, camera(0, 0));
    const packedPatch = packedCodec.encodePacked(packed(second), camera(0, 0));
    objectTerminal.apply(objectPatch.output);
    packedTerminal.apply(packedPatch.output);
    expect(packedTerminal.visibleSnapshot()).toEqual(objectTerminal.visibleSnapshot());
    expect(packedPatch.metrics.bytes).toBeLessThan(objectPatch.metrics.bytes);

    const shifted = coloredGrid(
      ['████', '████', '████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 4 }, (_, x) => ({
        r: 35 + ((x + 1) % 4) * 20,
        g: 55 + y * 30,
        b: 95 + ((x + 1) % 4) * 10,
      }))),
    );
    const objectMotion = objectCodec.encode(shifted, camera(2, 0));
    const packedMotion = packedCodec.encodePacked(packed(shifted), camera(2, 0));
    objectTerminal.apply(objectMotion.output);
    packedTerminal.apply(packedMotion.output);
    expect(packedTerminal.visibleSnapshot()).toEqual(objectTerminal.visibleSnapshot());

    const relativeObjectCodec = new TerminalCodec({ headerRows: 2, terminalCols: 6, terminalRows: 5 });
    const relativePackedCodec = new TerminalCodec({ headerRows: 2, terminalCols: 6, terminalRows: 5 });
    const relativeObjectTerminal = new TerminalEmulator(6, 5);
    const relativePackedTerminal = new TerminalEmulator(6, 5);
    const relativeFirst = coloredGrid(
      ['██████', '██████', '██████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({
        r: 35 + x * 15,
        g: 55 + y * 30,
        b: 95 + x * 8,
      }))),
    );
    const relativeSecond = coloredGrid(
      ['██████', '██████', '██████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({
        r: 35 + x * 15 + (y === 1 && (x === 0 || x === 5) ? 7 : 0),
        g: 55 + y * 30,
        b: 95 + x * 8,
      }))),
    );
    relativeObjectTerminal.apply(relativeObjectCodec.encode(relativeFirst, camera(0, 0)).output);
    relativePackedTerminal.apply(relativePackedCodec.encodePacked(packed(relativeFirst), camera(0, 0)).output);
    const objectDisjoint = relativeObjectCodec.encode(relativeSecond, camera(0, 0));
    const packedDisjoint = relativePackedCodec.encodePacked(packed(relativeSecond), camera(0, 0));
    expect(packedDisjoint.output).toContain('\x1b[4C');
    relativeObjectTerminal.apply(objectDisjoint.output);
    relativePackedTerminal.apply(packedDisjoint.output);
    expect(relativePackedTerminal.visibleSnapshot()).toEqual(relativeObjectTerminal.visibleSnapshot());

    const wideCodec = new TerminalCodec({ headerRows: 2, terminalCols: 6, terminalRows: 5 });
    wideCodec.encodePacked(packed(relativeFirst), camera(0, 0));
    const wideOverlay = coloredGrid(
      ['██████', '界█████', '██████'],
      Array.from({ length: 3 }, (_, y) => Array.from({ length: 6 }, (_, x) => ({
        r: 35 + x * 15 + (y === 1 && x === 5 ? 7 : 0),
        g: 55 + y * 30,
        b: 95 + x * 8,
      }))),
    );
    const widePatch = wideCodec.encodePacked(packed(wideOverlay), camera(0, 0));
    expect(widePatch.output).not.toContain('\x1b[4C');
    expect(widePatch.output.match(/\x1b\[[0-9;]*H/g)).toHaveLength(2);
  });
});
