import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { SessionProxy } from '../server/session-proxy.js';

describe('SessionProxy transport telemetry', () => {
  it('counts ordinary keyframes and dependency-recovery keyframes separately', () => {
    const stream = new EventEmitter() as Duplex;
    stream.write = vi.fn(() => false) as Duplex['write'];
    const requestSessionKeyframe = vi.fn();
    const proxy = new SessionProxy({
      stream,
      fingerprint: 'fixture-fingerprint',
      username: 'fixture-user',
      userId: '4cf94a8c-2cc0-48c0-b12b-5d11132edfc0',
      cols: 160,
      rows: 46,
      workerManager: { requestSessionKeyframe } as never,
    });

    proxy.handleOutput('initial-I-frame', true);
    proxy.handleOutput('dependent-delta-1');
    proxy.handleOutput('dependent-delta-2');
    proxy.handleOutput('ignored-while-recovering');
    proxy.handleOutput('recovery-I-frame', true);

    expect(requestSessionKeyframe).toHaveBeenCalledTimes(1);
    expect(proxy.getTransportMetrics()).toMatchObject({
      droppedFrames: 1,
      keyframesAccepted: 2,
      recoveryKeyframesAccepted: 1,
      recoveryRequests: 1,
    });
  });
});
