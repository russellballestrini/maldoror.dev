import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { osc4EntriesPacket, parseOsc4ColorResponse } from '../pixel/palette-cycle.js';
import { PixelGameRenderer } from '../pixel/pixel-game-renderer.js';

describe('OSC-4 palette preservation', () => {
  it('parses 16-bit terminal palette replies into RGB8', () => {
    expect(parseOsc4ColorResponse('\x1b]4;192;rgb:ffff/8080/0000\x1b\\')).toEqual({
      index: 192,
      color: { r: 255, g: 128, b: 0 },
    });
  });

  it('emits an exact sparse restore packet', () => {
    expect(osc4EntriesPacket([[192, { r: 1, g: 2, b: 3 }], [199, { r: 250, g: 251, b: 252 }]]))
      .toBe('\x1b]4;192;rgb:01/02/03;199;rgb:fa/fb/fc\x1b\\');
  });

  it('removes query replies from user input and restores the captured value', () => {
    const stream = new PassThrough();
    let output = '';
    stream.on('data', (chunk) => { output += chunk.toString(); });
    const renderer = new PixelGameRenderer({
      stream,
      cols: 10,
      rows: 6,
      renderMode: 'octant',
      paletteAnimation: true,
    });
    renderer.initialize();
    const routed = renderer.consumeTerminalResponses(
      Buffer.from('\x1b]4;192;rgb:1111/2222/3333\x1b\\w'),
    );
    expect(routed.toString()).toBe('w');
    renderer.cleanup();
    expect(output).toContain('\x1b]4;192;rgb:11/22/33\x1b\\');
  });
});
