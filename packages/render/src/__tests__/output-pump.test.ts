import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { OutputPump } from '../transport/output-pump.js';

class ControlledStream extends EventEmitter {
  readonly writes: string[] = [];
  acceptWrites = true;

  write(chunk: string): boolean {
    this.writes.push(chunk);
    return this.acceptWrites;
  }
}

describe('OutputPump', () => {
  it('does not write more packets until drain after backpressure', () => {
    const stream = new ControlledStream();
    stream.acceptWrites = false;
    const pump = new OutputPump(stream as unknown as NodeJS.WritableStream);

    pump.enqueue('frame-1');
    pump.enqueue('frame-2');
    pump.writeImmediate('keyframe');

    expect(stream.writes).toEqual(['frame-1']);
    expect(pump.getBacklogBytes()).toBe(Buffer.byteLength('frame-2keyframe'));

    stream.acceptWrites = true;
    stream.emit('drain');

    expect(stream.writes).toEqual(['frame-1', 'frame-2', 'keyframe']);
    expect(pump.getBacklogBytes()).toBe(0);
    expect(pump.getDrainCount()).toBe(1);
  });

  it('accounts for a directly written critical response as one packet', () => {
    const stream = new ControlledStream();
    const pump = new OutputPump(stream as unknown as NodeJS.WritableStream);

    expect(pump.writeImmediate('input-ack')).toBe(true);
    expect(stream.writes).toEqual(['input-ack']);
    expect(pump.getTotalFramesWritten()).toBe(1);
  });
});
