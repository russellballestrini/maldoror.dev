export class SessionAdmissionCancelledError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session admission cancelled: ${sessionId}`);
    this.name = 'SessionAdmissionCancelledError';
  }
}

interface Admission<T> {
  id: string;
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export interface SessionAdmissionQueueStats {
  coldReady: boolean;
  active: number;
  pending: number;
  warmConcurrency: number;
}

/**
 * Protect the first process-local login from a thundering herd.
 *
 * Regional terrain, prepared-view conversion, sprite misses, and database
 * pools all have a cold process state. One successful leader establishes that
 * shared state; later admissions use bounded concurrency so a reconnect wave
 * cannot starve the worker event loop or exhaust database connection setup.
 */
export class SessionAdmissionQueue {
  private readonly pending: Admission<unknown>[] = [];
  private readonly admittedIds = new Set<string>();
  private coldReady = false;
  private active = 0;

  constructor(private readonly warmConcurrency = 4) {
    if (!Number.isInteger(warmConcurrency) || warmConcurrency < 1) {
      throw new Error('Session admission warm concurrency must be a positive integer');
    }
  }

  enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    if (this.admittedIds.has(id)) {
      return Promise.reject(new Error(`Session admission already exists: ${id}`));
    }
    this.admittedIds.add(id);
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        id,
        task,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  cancel(id: string): boolean {
    const index = this.pending.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    const [entry] = this.pending.splice(index, 1);
    this.admittedIds.delete(id);
    entry!.reject(new SessionAdmissionCancelledError(id));
    return true;
  }

  cancelAll(): number {
    const count = this.pending.length;
    for (const entry of this.pending.splice(0)) {
      this.admittedIds.delete(entry.id);
      entry.reject(new SessionAdmissionCancelledError(entry.id));
    }
    return count;
  }

  getStats(): SessionAdmissionQueueStats {
    return {
      coldReady: this.coldReady,
      active: this.active,
      pending: this.pending.length,
      warmConcurrency: this.warmConcurrency,
    };
  }

  private drain(): void {
    const limit = this.coldReady ? this.warmConcurrency : 1;
    while (this.active < limit && this.pending.length > 0) {
      const entry = this.pending.shift()!;
      this.active++;
      void entry.task().then(
        (value) => {
          // Only a completed session start proves that database, shared world,
          // prepared viewport, renderer, and first frame are genuinely warm.
          this.coldReady = true;
          entry.resolve(value);
        },
        (error) => entry.reject(error),
      ).finally(() => {
        this.active--;
        this.admittedIds.delete(entry.id);
        this.drain();
      });
      // Until the first success there can be exactly one leader. The resolved
      // leader's finally callback re-enters drain with the warm limit.
      if (!this.coldReady) break;
    }
  }
}
