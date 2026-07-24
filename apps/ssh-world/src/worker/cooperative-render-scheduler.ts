/**
 * Render at most one session per event-loop turn. Independent session timers
 * can all expire in the same timers phase; running every synchronous viewport
 * reconstruction there delays already-buffered SSH input until the full burst
 * completes. Re-arming through setImmediate after each frame gives the poll
 * phase a chance to dispatch IPC input between sessions while coalescing a
 * session that falls more than one frame behind.
 */
export class CooperativeRenderScheduler {
  private readonly pending = new Map<string, () => void>();
  private drainHandle: NodeJS.Immediate | null = null;

  schedule(sessionId: string, render: () => void): void {
    this.pending.set(sessionId, render);
    if (!this.drainHandle) this.drainHandle = setImmediate(() => this.drainOne());
  }

  cancel(sessionId: string): void {
    this.pending.delete(sessionId);
    if (this.pending.size === 0 && this.drainHandle) {
      clearImmediate(this.drainHandle);
      this.drainHandle = null;
    }
  }

  dispose(): void {
    this.pending.clear();
    if (this.drainHandle) clearImmediate(this.drainHandle);
    this.drainHandle = null;
  }

  private drainOne(): void {
    this.drainHandle = null;
    const next = this.pending.entries().next().value as [string, () => void] | undefined;
    if (!next) return;
    this.pending.delete(next[0]);
    try {
      next[1]();
    } finally {
      if (this.pending.size > 0 && !this.drainHandle) {
        this.drainHandle = setImmediate(() => this.drainOne());
      }
    }
  }
}
