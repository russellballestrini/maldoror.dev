import { getHeapSpaceStatistics, getHeapStatistics } from 'node:v8';

export interface WorkerHeapSpaceSnapshot {
  name: string;
  size_mib: number;
  used_mib: number;
  available_mib: number;
  physical_mib: number;
}

export interface WorkerMemorySnapshot {
  rss_mib: number;
  heap_used_mib: number;
  heap_total_mib: number;
  heap_limit_mib: number;
  external_mib: number;
  array_buffers_mib: number;
  heap_spaces: WorkerHeapSpaceSnapshot[];
}

export interface WorkerResourceUsageSnapshot {
  max_rss_mib: number;
  minor_page_faults: number;
  major_page_faults: number;
  filesystem_reads: number;
  filesystem_writes: number;
  voluntary_context_switches: number;
  involuntary_context_switches: number;
}

export interface WorkerRuntimeResourceSnapshot {
  memory: WorkerMemorySnapshot;
  resources: WorkerResourceUsageSnapshot;
}

/** Sample only process-local counters already maintained by Node and V8. The
 * endpoint owns cadence; this helper starts no timer and retains no history. */
export function sampleWorkerRuntimeResources(): WorkerRuntimeResourceSnapshot {
  const memory = process.memoryUsage();
  const heap = getHeapStatistics();
  const resources = process.resourceUsage();
  const heapSpaces = getHeapSpaceStatistics()
    .map((space): WorkerHeapSpaceSnapshot => ({
      name: space.space_name,
      size_mib: bytesToMib(space.space_size),
      used_mib: bytesToMib(space.space_used_size),
      available_mib: bytesToMib(space.space_available_size),
      physical_mib: bytesToMib(space.physical_space_size),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return {
    memory: {
      rss_mib: bytesToMib(memory.rss),
      heap_used_mib: bytesToMib(memory.heapUsed),
      heap_total_mib: bytesToMib(memory.heapTotal),
      heap_limit_mib: bytesToMib(heap.heap_size_limit),
      external_mib: bytesToMib(memory.external),
      array_buffers_mib: bytesToMib(memory.arrayBuffers),
      heap_spaces: heapSpaces,
    },
    resources: {
      // Node reports maxRSS in KiB on Linux; every other field is a count.
      max_rss_mib: fixed(resources.maxRSS / 1024),
      minor_page_faults: resources.minorPageFault,
      major_page_faults: resources.majorPageFault,
      filesystem_reads: resources.fsRead,
      filesystem_writes: resources.fsWrite,
      voluntary_context_switches: resources.voluntaryContextSwitches,
      involuntary_context_switches: resources.involuntaryContextSwitches,
    },
  };
}

function bytesToMib(value: number): number {
  return fixed(value / 1024 / 1024);
}

function fixed(value: number): number {
  return Number(value.toFixed(3));
}
