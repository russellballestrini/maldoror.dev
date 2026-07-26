import type { RegionalPreparedViewportPayload } from '@maldoror/world';
import { describe, expect, it } from 'vitest';
import {
  RegionalPredictivePrewarmer,
  type RegionalPrewarmBounds,
  type RegionalPrewarmGenerator,
  type RegionalPrewarmServiceResult,
  type RegionalPrewarmTarget,
} from '../game/regional-prewarm-service.js';

class ImmediateGenerator implements RegionalPrewarmGenerator {
  readonly requests: RegionalPrewarmBounds[] = [];

  async prepare(bounds: RegionalPrewarmBounds, resolution: number): Promise<RegionalPrewarmServiceResult> {
    this.requests.push(bounds);
    return {
      viewport: viewport(bounds, resolution),
      generationMs: 12,
      roundTripMs: 14,
      rssMiB: 100,
      source: 'generator',
    };
  }
}

class DeferredGenerator implements RegionalPrewarmGenerator {
  readonly requests: RegionalPrewarmBounds[] = [];
  private readonly completions: Array<() => void> = [];

  prepare(bounds: RegionalPrewarmBounds, resolution: number): Promise<RegionalPrewarmServiceResult> {
    this.requests.push(bounds);
    return new Promise((resolve) => this.completions.push(() => resolve({
      viewport: viewport(bounds, resolution),
      generationMs: 20,
      roundTripMs: 23,
      rssMiB: 100,
      source: 'generator',
    })));
  }

  completeNext(): void {
    this.completions.shift()?.();
  }
}

class Target implements RegionalPrewarmTarget {
  readonly imported: RegionalPreparedViewportPayload[] = [];

  importPreparedViewport(value: RegionalPreparedViewportPayload): void {
    this.imported.push(value);
  }

  hasPreparedViewportCoverage(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    resolution: number,
  ): boolean {
    return this.imported.some((entry) => entry.resolution === resolution &&
      entry.bounds.minX <= minX && entry.bounds.minY <= minY &&
      entry.bounds.maxX >= maxX && entry.bounds.maxY >= maxY);
  }
}

describe('RegionalPredictivePrewarmer', () => {
  it('amortizes one directional corridor across ordinary movement observations', async () => {
    const generator = new ImmediateGenerator();
    const target = new Target();
    const scheduler = createScheduler(generator, target);
    scheduler.observe(0, 0, 1, 0);
    await scheduler.whenIdle();
    for (let x = 1; x <= 12; x++) scheduler.observe(x, 0, 1, 0);
    await scheduler.whenIdle();

    expect(generator.requests).toHaveLength(1);
    expect(target.imported).toHaveLength(1);
    expect(scheduler.getStats()).toMatchObject({
      observations: 13,
      coverageHits: 12,
      requestsStarted: 1,
      packagesImported: 1,
      failures: 0,
    });
  });

  it('allows one in-flight request and replaces pending work with the newest prediction', async () => {
    const generator = new DeferredGenerator();
    const target = new Target();
    const scheduler = createScheduler(generator, target);
    scheduler.observe(0, 0, 1, 0);
    scheduler.observe(80, 0, 1, 0);
    scheduler.observe(160, 0, 1, 0);
    expect(generator.requests).toHaveLength(1);

    generator.completeNext();
    await new Promise((resolve) => setImmediate(resolve));
    expect(generator.requests).toHaveLength(2);
    expect(generator.requests[1]?.minX).toBeGreaterThan(100);
    generator.completeNext();
    await scheduler.whenIdle();

    expect(target.imported).toHaveLength(2);
    expect(scheduler.getStats()).toMatchObject({
      observations: 3,
      requestsStarted: 2,
      requestsCoalesced: 2,
      packagesImported: 2,
      failures: 0,
    });
  });

  it('fits low-zoom predictive reach inside the provider payload-area limit', async () => {
    const generator = new ImmediateGenerator();
    const target = new Target();
    const errors: Error[] = [];
    const scheduler = new RegionalPredictivePrewarmer({
      generator,
      target,
      resolution: 4,
      viewportRadiusX: 42,
      viewportRadiusY: 24,
      lookaheadTiles: 32,
      fringeTiles: 4,
      maxRequestArea: 8192,
      onError: (error) => errors.push(error),
    });

    scheduler.observe(0, 0, 1, 1);
    await scheduler.whenIdle();

    const bounds = generator.requests[0]!;
    const area = (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
    expect(area).toBeLessThanOrEqual(8192);
    expect(area).toBeGreaterThan((42 * 2 + 1) * (24 * 2 + 1));
    expect(errors).toEqual([]);
    expect(target.imported).toHaveLength(1);
  });
});

function createScheduler(
  generator: RegionalPrewarmGenerator,
  target: RegionalPrewarmTarget,
): RegionalPredictivePrewarmer {
  return new RegionalPredictivePrewarmer({
    generator,
    target,
    resolution: 16,
    viewportRadiusX: 12,
    viewportRadiusY: 8,
    lookaheadTiles: 32,
    fringeTiles: 4,
  });
}

function viewport(bounds: RegionalPrewarmBounds, resolution: number): RegionalPreparedViewportPayload {
  return {
    version: 1,
    worldSeed: '42',
    bounds,
    resolution,
    terrain: [],
    overlays: [],
    solid: [],
    dynamicPlacements: [],
  };
}
