import fs from 'node:fs';

export interface WorkerKernelRuntimeSnapshot {
  pid: number;
  state: string | null;
  rss_mib: number;
  rss_anon_mib: number;
  rss_file_mib: number;
  rss_shmem_mib: number;
  swap_mib: number;
  virtual_mib: number;
  threads: number;
  voluntary_context_switches: number;
  involuntary_context_switches: number;
}

/** Read process counters from procfs so an overloaded worker does not need to
 * service the diagnostic request that is trying to explain its overload. */
export async function sampleWorkerKernelRuntime(
  pid: number,
): Promise<WorkerKernelRuntimeSnapshot | null> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const status = await fs.promises.readFile(`/proc/${pid}/status`, 'utf8');
    return parseWorkerProcStatus(pid, status);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ESRCH' || code === 'EACCES') return null;
    throw error;
  }
}

export function parseWorkerProcStatus(
  pid: number,
  status: string,
): WorkerKernelRuntimeSnapshot {
  const fields = new Map<string, string>();
  for (const line of status.split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    fields.set(line.slice(0, separator), line.slice(separator + 1).trim());
  }
  return {
    pid,
    state: fields.get('State') ?? null,
    rss_mib: kibibytesToMib(fields.get('VmRSS')),
    rss_anon_mib: kibibytesToMib(fields.get('RssAnon')),
    rss_file_mib: kibibytesToMib(fields.get('RssFile')),
    rss_shmem_mib: kibibytesToMib(fields.get('RssShmem')),
    swap_mib: kibibytesToMib(fields.get('VmSwap')),
    virtual_mib: kibibytesToMib(fields.get('VmSize')),
    threads: integerField(fields.get('Threads')),
    voluntary_context_switches: integerField(fields.get('voluntary_ctxt_switches')),
    involuntary_context_switches: integerField(fields.get('nonvoluntary_ctxt_switches')),
  };
}

function kibibytesToMib(value: string | undefined): number {
  if (!value) return 0;
  const match = /^(\d+)\s+kB$/.exec(value);
  return match ? fixed(Number(match[1]) / 1024) : 0;
}

function integerField(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) return 0;
  return Number(value);
}

function fixed(value: number): number {
  return Number(value.toFixed(3));
}
