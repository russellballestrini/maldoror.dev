import { Worker } from 'node:worker_threads';
import type { RegionalPreparedViewportPayload } from '@maldoror/world';
import type {
  RegionalPrewarmBounds,
  RegionalPrewarmPreparedResponse,
  RegionalPrewarmWorkerOptions,
  RegionalPrewarmWorkerResponse,
} from './regional-prewarm-protocol.js';
export type { RegionalPrewarmBounds } from './regional-prewarm-protocol.js';

export interface RegionalPrewarmServiceStartup {
  startupMs: number;
  rssMiB: number;
}

export interface RegionalPrewarmServiceResult {
  viewport: RegionalPreparedViewportPayload;
  generationMs: number;
  roundTripMs: number;
  rssMiB: number;
}

export interface RegionalPrewarmGenerator {
  prepare(bounds: RegionalPrewarmBounds, resolution: number): Promise<RegionalPrewarmServiceResult>;
}

export interface RegionalPrewarmTarget {
  importPreparedViewport(viewport: RegionalPreparedViewportPayload): void;
  hasPreparedViewportCoverage(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    resolution: number,
  ): boolean;
}

export interface RegionalPredictivePrewarmerOptions {
  generator: RegionalPrewarmGenerator;
  target: RegionalPrewarmTarget;
  resolution: number;
  viewportRadiusX: number;
  viewportRadiusY: number;
  /** Distance of the directionally projected centre, in world tiles. */
  lookaheadTiles?: number;
  /** Extra material retained behind and beside the moving viewport. */
  fringeTiles?: number;
  onError?: (error: Error) => void;
}

export interface RegionalPredictivePrewarmerStats {
  observations: number;
  coverageHits: number;
  requestsStarted: number;
  requestsCoalesced: number;
  packagesImported: number;
  failures: number;
  lastGenerationMs: number | null;
  lastRoundTripMs: number | null;
  lastImportMs: number | null;
}

interface PendingRequest {
  startedAt: number;
  resolve: (result: RegionalPrewarmServiceResult) => void;
  reject: (error: Error) => void;
}

/** Persistent worker-thread generator. Expensive biome, route, parcel, and
 * material caches never run on the input/render event loop; only a bounded,
 * validated viewport package crosses back to the provider. */
export class RegionalPrewarmService {
  private readonly worker: Worker;
  private readonly pending = new Map<number, PendingRequest>();
  private nextRequestId = 1;
  private stopped = false;

  private constructor(worker: Worker) {
    this.worker = worker;
    worker.on('message', (message: RegionalPrewarmWorkerResponse) => this.handleMessage(message));
    worker.on('error', (error) => this.failAll(error));
    worker.on('exit', (code) => {
      if (!this.stopped && code !== 0) this.failAll(new Error(`Regional prewarm worker exited with code ${code}`));
    });
  }

  static async start(
    options: RegionalPrewarmWorkerOptions,
    timeoutMs = 30_000,
  ): Promise<{ service: RegionalPrewarmService; startup: RegionalPrewarmServiceStartup }> {
    const worker = new Worker(new URL('./regional-prewarm-worker.js', import.meta.url), {
      workerData: options,
    });
    const service = new RegionalPrewarmService(worker);
    const startup = await new Promise<RegionalPrewarmServiceStartup>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Regional prewarm worker startup timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const onMessage = (message: RegionalPrewarmWorkerResponse) => {
        if (message.type === 'ready') {
          clearTimeout(timeout);
          worker.off('message', onMessage);
          resolve({ startupMs: message.startupMs, rssMiB: message.rssMiB });
        } else if (message.type === 'error' && message.requestId === undefined) {
          clearTimeout(timeout);
          worker.off('message', onMessage);
          reject(new Error(message.message));
        }
      };
      worker.on('message', onMessage);
      worker.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    }).catch(async (error: unknown) => {
      await service.stop();
      throw error;
    });
    return { service, startup };
  }

  prepare(bounds: RegionalPrewarmBounds, resolution: number): Promise<RegionalPrewarmServiceResult> {
    if (this.stopped) return Promise.reject(new Error('Regional prewarm service is stopped'));
    const requestId = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { startedAt: performance.now(), resolve, reject });
      this.worker.postMessage({ type: 'prepare', requestId, bounds, resolution });
    });
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.worker.postMessage({ type: 'shutdown' });
    const exited = new Promise<void>((resolve) => this.worker.once('exit', () => resolve()));
    const forced = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
    await Promise.race([exited, forced]);
    if (this.worker.threadId !== -1) await this.worker.terminate();
    this.failAll(new Error('Regional prewarm service stopped'));
  }

  private handleMessage(message: RegionalPrewarmWorkerResponse): void {
    if (message.type === 'prepared') {
      this.resolvePrepared(message);
      return;
    }
    if (message.type !== 'error' || message.requestId === undefined) return;
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.reject(new Error(message.message));
  }

  private resolvePrepared(message: RegionalPrewarmPreparedResponse): void {
    const pending = this.pending.get(message.requestId);
    if (!pending) return;
    this.pending.delete(message.requestId);
    pending.resolve({
      viewport: message.viewport,
      generationMs: message.generationMs,
      roundTripMs: performance.now() - pending.startedAt,
      rssMiB: message.rssMiB,
    });
  }

  private failAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

interface PredictedRequest {
  bounds: RegionalPrewarmBounds;
  requiredBounds: RegionalPrewarmBounds;
  resolution: number;
}

/**
 * Coverage-aware predictive scheduler for the live movement path.
 *
 * It uses the continuous velocity vector rather than enumerated direction
 * cases, permits exactly one expensive worker request at a time, and retains
 * only the newest uncovered prediction while that request runs. Completed
 * packages remain useful behind the player and are bounded by the provider's
 * package LRU.
 */
export class RegionalPredictivePrewarmer {
  private readonly generator: RegionalPrewarmGenerator;
  private readonly target: RegionalPrewarmTarget;
  private readonly resolution: number;
  private readonly viewportRadiusX: number;
  private readonly viewportRadiusY: number;
  private readonly lookaheadTiles: number;
  private readonly fringeTiles: number;
  private readonly onError?: (error: Error) => void;
  private inFlight: PredictedRequest | null = null;
  private pending: PredictedRequest | null = null;
  private idleWaiters: Array<() => void> = [];
  private stopped = false;
  private readonly stats: RegionalPredictivePrewarmerStats = {
    observations: 0,
    coverageHits: 0,
    requestsStarted: 0,
    requestsCoalesced: 0,
    packagesImported: 0,
    failures: 0,
    lastGenerationMs: null,
    lastRoundTripMs: null,
    lastImportMs: null,
  };

  constructor(options: RegionalPredictivePrewarmerOptions) {
    this.generator = options.generator;
    this.target = options.target;
    this.resolution = positiveInteger(options.resolution, 'resolution');
    this.viewportRadiusX = positiveInteger(options.viewportRadiusX, 'viewportRadiusX');
    this.viewportRadiusY = positiveInteger(options.viewportRadiusY, 'viewportRadiusY');
    this.lookaheadTiles = positiveInteger(options.lookaheadTiles ?? 32, 'lookaheadTiles');
    this.fringeTiles = nonNegativeInteger(options.fringeTiles ?? 4, 'fringeTiles');
    this.onError = options.onError;
  }

  observe(x: number, y: number, velocityX: number, velocityY: number): void {
    if (this.stopped) return;
    this.stats.observations++;
    const magnitude = Math.hypot(velocityX, velocityY);
    const directionX = magnitude > 1e-9 ? velocityX / magnitude : 0;
    const directionY = magnitude > 1e-9 ? velocityY / magnitude : 0;
    const futureX = x + directionX * this.lookaheadTiles;
    const futureY = y + directionY * this.lookaheadTiles;
    const requiredFutureX = x + directionX * this.lookaheadTiles * 0.55;
    const requiredFutureY = y + directionY * this.lookaheadTiles * 0.55;
    const request: PredictedRequest = {
      resolution: this.resolution,
      requiredBounds: {
        minX: Math.floor(Math.min(x, requiredFutureX) - this.viewportRadiusX),
        minY: Math.floor(Math.min(y, requiredFutureY) - this.viewportRadiusY),
        maxX: Math.ceil(Math.max(x, requiredFutureX) + this.viewportRadiusX),
        maxY: Math.ceil(Math.max(y, requiredFutureY) + this.viewportRadiusY),
      },
      bounds: {
        minX: Math.floor(Math.min(x, futureX) - this.viewportRadiusX - this.fringeTiles),
        minY: Math.floor(Math.min(y, futureY) - this.viewportRadiusY - this.fringeTiles),
        maxX: Math.ceil(Math.max(x, futureX) + this.viewportRadiusX + this.fringeTiles),
        maxY: Math.ceil(Math.max(y, futureY) + this.viewportRadiusY + this.fringeTiles),
      },
    };
    if (this.isCovered(request)) {
      this.stats.coverageHits++;
      return;
    }
    if (this.inFlight && containsRequest(this.inFlight, request)) {
      this.stats.requestsCoalesced++;
      return;
    }
    if (this.pending && containsRequest(this.pending, request)) {
      this.stats.requestsCoalesced++;
      return;
    }
    if (this.inFlight) {
      this.pending = request;
      this.stats.requestsCoalesced++;
      return;
    }
    this.start(request);
  }

  getStats(): RegionalPredictivePrewarmerStats {
    return { ...this.stats };
  }

  whenIdle(): Promise<void> {
    if (!this.inFlight && !this.pending) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  stop(): void {
    this.stopped = true;
    this.pending = null;
    this.resolveIdleIfNeeded();
  }

  private start(request: PredictedRequest): void {
    this.inFlight = request;
    this.stats.requestsStarted++;
    void this.generator.prepare(request.bounds, request.resolution)
      .then((result) => {
        if (this.stopped) return;
        const importStartedAt = performance.now();
        this.target.importPreparedViewport(result.viewport);
        this.stats.lastImportMs = performance.now() - importStartedAt;
        this.stats.lastGenerationMs = result.generationMs;
        this.stats.lastRoundTripMs = result.roundTripMs;
        this.stats.packagesImported++;
      })
      .catch((error: unknown) => {
        this.stats.failures++;
        this.onError?.(error instanceof Error ? error : new Error(String(error)));
      })
      .finally(() => {
        this.inFlight = null;
        const next = this.pending;
        this.pending = null;
        if (!this.stopped && next && !this.isCovered(next)) this.start(next);
        else this.resolveIdleIfNeeded();
      });
  }

  private isCovered(request: PredictedRequest): boolean {
    return this.target.hasPreparedViewportCoverage(
      request.requiredBounds.minX,
      request.requiredBounds.minY,
      request.requiredBounds.maxX,
      request.requiredBounds.maxY,
      request.resolution,
    );
  }

  private resolveIdleIfNeeded(): void {
    if (this.inFlight || this.pending) return;
    for (const resolve of this.idleWaiters.splice(0)) resolve();
  }
}

function containsRequest(container: PredictedRequest, candidate: PredictedRequest): boolean {
  return container.resolution === candidate.resolution &&
    container.bounds.minX <= candidate.requiredBounds.minX &&
    container.bounds.minY <= candidate.requiredBounds.minY &&
    container.bounds.maxX >= candidate.requiredBounds.maxX &&
    container.bounds.maxY >= candidate.requiredBounds.maxY;
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}
