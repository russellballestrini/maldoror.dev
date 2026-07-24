import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootScreen } from '../server/boot-screen.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('BootScreen lifecycle', () => {
  it('cancels spinner writes when a starting session is destroyed', () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const write = vi.spyOn(stream, 'write');
    const screen = new BootScreen(stream, 80, 24);

    screen.show();
    screen.updateStep('Loading player state...');
    vi.advanceTimersByTime(160);
    expect(write).toHaveBeenCalled();

    screen.destroy();
    write.mockClear();
    vi.advanceTimersByTime(800);
    expect(write).not.toHaveBeenCalled();
  });
});
