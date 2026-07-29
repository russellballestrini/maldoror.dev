import { describe, expect, it } from 'vitest';
import { sampleWorkerRuntimeResources } from '../worker/worker-runtime-metrics.js';

describe('worker runtime resource metrics', () => {
  it('reports finite, internally consistent heap-space and process counters', () => {
    const snapshot = sampleWorkerRuntimeResources();
    const memoryValues = [
      snapshot.memory.rss_mib,
      snapshot.memory.heap_used_mib,
      snapshot.memory.heap_total_mib,
      snapshot.memory.heap_limit_mib,
      snapshot.memory.external_mib,
      snapshot.memory.array_buffers_mib,
    ];
    expect(memoryValues.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(snapshot.memory.rss_mib).toBeGreaterThan(0);
    expect(snapshot.memory.heap_total_mib).toBeGreaterThanOrEqual(
      snapshot.memory.heap_used_mib,
    );

    const spaces = snapshot.memory.heap_spaces;
    expect(spaces.length).toBeGreaterThan(0);
    expect(new Set(spaces.map((space) => space.name)).size).toBe(spaces.length);
    expect(spaces.map((space) => space.name)).toEqual(
      [...spaces.map((space) => space.name)].sort((left, right) => left.localeCompare(right)),
    );
    for (const space of spaces) {
      expect(space.name.length).toBeGreaterThan(0);
      expect(space.size_mib).toBeGreaterThanOrEqual(0);
      expect(space.used_mib).toBeGreaterThanOrEqual(0);
      expect(space.available_mib).toBeGreaterThanOrEqual(0);
      expect(space.physical_mib).toBeGreaterThanOrEqual(0);
      expect(space.used_mib).toBeLessThanOrEqual(space.size_mib + 0.001);
    }

    const resourceValues = Object.values(snapshot.resources);
    expect(resourceValues.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    expect(snapshot.resources.max_rss_mib).toBeGreaterThan(0);
  });
});
