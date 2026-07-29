import { describe, expect, it } from 'vitest';
import { parseWorkerProcStatus } from '../server/worker-kernel-metrics.js';

describe('worker kernel runtime metrics', () => {
  it('parses Linux proc status memory and scheduling counters exactly', () => {
    const snapshot = parseWorkerProcStatus(4242, [
      'Name:\tnode',
      'State:\tS (sleeping)',
      'VmSize:\t 2097152 kB',
      'VmRSS:\t 1268832 kB',
      'RssAnon:\t 1249524 kB',
      'RssFile:\t 19308 kB',
      'RssShmem:\t 0 kB',
      'VmSwap:\t 237784 kB',
      'Threads:\t12',
      'voluntary_ctxt_switches:\t1552',
      'nonvoluntary_ctxt_switches:\t88',
    ].join('\n'));

    expect(snapshot).toEqual({
      pid: 4242,
      state: 'S (sleeping)',
      rss_mib: 1239.094,
      rss_anon_mib: 1220.238,
      rss_file_mib: 18.855,
      rss_shmem_mib: 0,
      swap_mib: 232.211,
      virtual_mib: 2048,
      threads: 12,
      voluntary_context_switches: 1552,
      involuntary_context_switches: 88,
    });
  });

  it('fails closed to zero for missing or malformed optional counters', () => {
    expect(parseWorkerProcStatus(7, 'Name:\tnode\nState:\tR (running)\nVmRSS:\tn/a'))
      .toEqual({
        pid: 7,
        state: 'R (running)',
        rss_mib: 0,
        rss_anon_mib: 0,
        rss_file_mib: 0,
        rss_shmem_mib: 0,
        swap_mib: 0,
        virtual_mib: 0,
        threads: 0,
        voluntary_context_switches: 0,
        involuntary_context_switches: 0,
      });
  });
});
