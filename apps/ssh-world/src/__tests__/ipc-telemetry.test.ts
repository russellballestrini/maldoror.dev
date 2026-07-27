import { describe, expect, it } from 'vitest';
import { IpcSendTelemetry, RollingLatencyWindow } from '../worker/ipc-telemetry.js';

describe('worker IPC telemetry', () => {
  it('retains bounded recent percentiles and an exact cumulative count', () => {
    const window = new RollingLatencyWindow(4);
    for (const value of [1, 2, 3, 4, 100]) window.record(value);
    window.record(Number.NaN);
    window.record(-1);

    expect(window.snapshot()).toEqual({
      samples: 4,
      total: 5,
      min_ms: 2,
      p50_ms: 3,
      p95_ms: 100,
      p99_ms: 100,
      max_ms: 100,
      mean_ms: 27.25,
    });
  });

  it('separates immediate pressure and callback delay from ordinary output', () => {
    const telemetry = new IpcSendTelemetry();
    const ordinary = telemetry.begin(false, 10);
    telemetry.recordReturn(ordinary, true);
    telemetry.finish(ordinary, 12);
    const immediate = telemetry.begin(true, 20);
    telemetry.recordReturn(immediate, false);

    expect(telemetry.snapshot()).toMatchObject({
      attempts: 2,
      immediate_attempts: 1,
      returned_false: 1,
      immediate_returned_false: 1,
      callbacks_pending: 1,
      callbacks_peak: 1,
      callback_ms: { total: 1, p50_ms: 2 },
      immediate_callback_ms: { total: 0, p50_ms: null },
    });

    telemetry.finish(immediate, 27, new Error('closed'));
    expect(telemetry.snapshot()).toMatchObject({
      callback_errors: 1,
      callbacks_pending: 0,
      callback_ms: { total: 2, p99_ms: 7 },
      immediate_callback_ms: { total: 1, p50_ms: 7 },
    });
  });
});
