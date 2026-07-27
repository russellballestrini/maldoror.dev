export interface RollingLatencySnapshot {
  samples: number;
  total: number;
  min_ms: number | null;
  p50_ms: number | null;
  p95_ms: number | null;
  p99_ms: number | null;
  max_ms: number | null;
  mean_ms: number | null;
}

/** A bounded, allocation-stable latency window for runtime diagnosis. The
 * cumulative count remains exact while percentiles intentionally describe the
 * most recent samples, which is the useful interval during a load rung. */
export class RollingLatencyWindow {
  private readonly values: Float64Array;
  private length = 0;
  private cursor = 0;
  private total = 0;

  constructor(capacity = 4096) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error('Rolling latency capacity must be a positive integer');
    }
    this.values = new Float64Array(capacity);
  }

  record(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.values[this.cursor] = milliseconds;
    this.cursor = (this.cursor + 1) % this.values.length;
    this.length = Math.min(this.length + 1, this.values.length);
    this.total++;
  }

  snapshot(): RollingLatencySnapshot {
    if (this.length === 0) {
      return {
        samples: 0,
        total: this.total,
        min_ms: null,
        p50_ms: null,
        p95_ms: null,
        p99_ms: null,
        max_ms: null,
        mean_ms: null,
      };
    }

    const sorted = Array.from(this.values.subarray(0, this.length)).sort((a, b) => a - b);
    const sum = sorted.reduce((total, value) => total + value, 0);
    return {
      samples: this.length,
      total: this.total,
      min_ms: metric(sorted[0]!),
      p50_ms: metric(percentile(sorted, 50)),
      p95_ms: metric(percentile(sorted, 95)),
      p99_ms: metric(percentile(sorted, 99)),
      max_ms: metric(sorted[sorted.length - 1]!),
      mean_ms: metric(sum / sorted.length),
    };
  }
}

export interface IpcSendSnapshot {
  attempts: number;
  immediate_attempts: number;
  returned_false: number;
  immediate_returned_false: number;
  callback_errors: number;
  callbacks_pending: number;
  callbacks_peak: number;
  callback_ms: RollingLatencySnapshot;
  immediate_callback_ms: RollingLatencySnapshot;
}

export interface IpcSendToken {
  immediate: boolean;
  startedAt: number;
}

/** Records the flow-control signals Node exposes for child-process IPC. A
 * false send return is not packet loss: it means the unsent backlog crossed
 * Node's flow-control threshold; the callback separately exposes completion
 * or a delivery error without imposing serialization policy. */
export class IpcSendTelemetry {
  private attempts = 0;
  private immediateAttempts = 0;
  private returnedFalse = 0;
  private immediateReturnedFalse = 0;
  private callbackErrors = 0;
  private callbacksPending = 0;
  private callbacksPeak = 0;
  private readonly callbackLatency = new RollingLatencyWindow();
  private readonly immediateCallbackLatency = new RollingLatencyWindow();

  begin(immediate: boolean, startedAt: number): IpcSendToken {
    this.attempts++;
    if (immediate) this.immediateAttempts++;
    this.callbacksPending++;
    this.callbacksPeak = Math.max(this.callbacksPeak, this.callbacksPending);
    return { immediate, startedAt };
  }

  recordReturn(token: IpcSendToken, acceptedWithoutPressure: boolean): void {
    if (acceptedWithoutPressure) return;
    this.returnedFalse++;
    if (token.immediate) this.immediateReturnedFalse++;
  }

  finish(token: IpcSendToken, finishedAt: number, error?: Error | null): void {
    this.callbacksPending = Math.max(0, this.callbacksPending - 1);
    if (error) this.callbackErrors++;
    const elapsed = Math.max(0, finishedAt - token.startedAt);
    this.callbackLatency.record(elapsed);
    if (token.immediate) this.immediateCallbackLatency.record(elapsed);
  }

  snapshot(): IpcSendSnapshot {
    return {
      attempts: this.attempts,
      immediate_attempts: this.immediateAttempts,
      returned_false: this.returnedFalse,
      immediate_returned_false: this.immediateReturnedFalse,
      callback_errors: this.callbackErrors,
      callbacks_pending: this.callbacksPending,
      callbacks_peak: this.callbacksPeak,
      callback_ms: this.callbackLatency.snapshot(),
      immediate_callback_ms: this.immediateCallbackLatency.snapshot(),
    };
  }
}

function percentile(sorted: number[], rank: number): number {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank / 100) - 1));
  return sorted[index]!;
}

function metric(value: number): number {
  return Number(value.toFixed(3));
}
