/**
 * Loopback-only real-SSH acceptance server.
 *
 * This is a separate executable from production index.ts. It accepts only
 * fingerprints listed in a generated scratch manifest and restores their
 * fixed coordinate/zoom fixtures through the same ssh2 -> SessionProxy ->
 * WorkerManager -> WorkerSession path used by production. Production has no
 * environment switch that enables this lane.
 */
import 'dotenv/config';
import { SSHServer } from './server/ssh-server.js';
import { StatsServer } from './server/stats-server.js';
import { WorkerManager } from './server/worker-manager.js';
import { db } from '@maldoror/db';
import type { ProviderConfig } from '@maldoror/ai';
import { resourceMonitor } from './utils/resource-monitor.js';
import { getVersion } from './version.js';
import { setBuildVersion } from '@maldoror/render';
import { loadAcceptanceRuntimeManifest } from './acceptance/manifest.js';

async function main(): Promise<void> {
  const manifestPath = requiredEnvironment('MALDOROR_ACCEPTANCE_MANIFEST');
  const manifest = loadAcceptanceRuntimeManifest(manifestPath);
  const host = '127.0.0.1';
  const sshPort = integerEnvironment('SSH_PORT', 3222);
  const statsPort = integerEnvironment('STATS_PORT', 3300);
  const hostKeyPath = requiredEnvironment('SSH_HOST_KEY_PATH');
  const version = getVersion();
  setBuildVersion(version.version);

  const worldRecord = await db.query.world.findFirst();
  if (!worldRecord) throw new Error('Acceptance database has no world row');
  if (worldRecord.seed !== manifest.worldSeed) {
    throw new Error(
      `Acceptance world seed mismatch: database=${worldRecord.seed} manifest=${manifest.worldSeed}`,
    );
  }

  const fixtures = new Map(
    manifest.sessions.map((session) => [session.fingerprintSha256, session] as const),
  );
  const providerConfig: ProviderConfig = {
    provider: 'openai',
    model: 'disabled-in-acceptance',
  };
  const workerManager = new WorkerManager({
    worldSeed: manifest.worldSeed,
    tickRate: 15,
    chunkCacheSize: 256,
    providerConfig,
  });
  resourceMonitor.start(30_000);
  await workerManager.start();

  const sshServer = new SSHServer({
    host,
    port: sshPort,
    hostKeyPath,
    banner: `Maldoror acceptance atlas ${manifest.atlasVersion}\n`,
    workerManager,
    acceptance: {
      resolveSession: (fingerprint) => fixtures.get(fingerprint) ?? null,
    },
  });
  await sshServer.start();

  const startedAt = new Date();
  const statsServer = new StatsServer({
    host,
    port: statsPort,
    getSessionCount: () => sshServer.getSessionCount(),
    getTransportMetrics: () => sshServer.getTransportMetrics(),
    workerManager,
    worldSeed: manifest.worldSeed,
    startTime: startedAt,
  });
  await statsServer.start();

  console.log(JSON.stringify({
    event: 'acceptance_ready',
    atlasVersion: manifest.atlasVersion,
    build: version.version,
    fixtures: fixtures.size,
    ssh: `${host}:${sshPort}`,
    stats: `${host}:${statsPort}`,
  }));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    sshServer.stop();
    statsServer.stop();
    await workerManager.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by the acceptance server`);
  return value;
}

function integerEnvironment(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_535) {
    throw new Error(`${name} must be an unprivileged TCP port`);
  }
  return value;
}

main().catch((error) => {
  console.error('Acceptance server failed:', error);
  process.exit(1);
});
