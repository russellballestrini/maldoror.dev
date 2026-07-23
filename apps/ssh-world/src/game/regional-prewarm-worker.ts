import { parentPort, workerData } from 'node:worker_threads';
import type {
  RegionalPrewarmWorkerOptions,
  RegionalPrewarmWorkerRequest,
  RegionalPrewarmWorkerResponse,
} from './regional-prewarm-protocol.js';
import { loadRegionalWorldProvider } from './regional-world-provider.js';
import {
  packRegionalPreparedViewport,
  regionalPackedViewportTransferList,
} from './regional-prewarm-packer.js';

if (!parentPort) throw new Error('Regional prewarm worker requires a parent port');
const port = parentPort;
const options = workerData as RegionalPrewarmWorkerOptions;
const startupStartedAt = performance.now();
const loaded = await loadRegionalWorldProvider({
  worldSeed: BigInt(options.worldSeed),
  assets: options.assets,
});

send({
  type: 'ready',
  startupMs: performance.now() - startupStartedAt,
  rssMiB: currentRssMiB(),
});

port.on('message', (request: RegionalPrewarmWorkerRequest) => {
  try {
    if (request.type === 'shutdown') {
      loaded.world.destroy();
      port.close();
      return;
    }
    const startedAt = performance.now();
    const prepared = loaded.world.prepareViewport(
      request.bounds.minX,
      request.bounds.minY,
      request.bounds.maxX,
      request.bounds.maxY,
      request.resolution,
    );
    const viewport = packRegionalPreparedViewport(prepared);
    send({
      type: 'prepared',
      requestId: request.requestId,
      viewport,
      generationMs: performance.now() - startedAt,
      rssMiB: currentRssMiB(),
    }, regionalPackedViewportTransferList(viewport));
  } catch (error) {
    send({
      type: 'error',
      requestId: request.type === 'prepare' ? request.requestId : undefined,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
  }
});

function send(response: RegionalPrewarmWorkerResponse, transferList?: ArrayBuffer[]): void {
  port.postMessage(response, transferList ?? []);
}

function currentRssMiB(): number {
  return Number((process.memoryUsage().rss / 1024 / 1024).toFixed(2));
}
