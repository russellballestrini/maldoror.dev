/**
 * Production-topology readiness proof for the regional SSH runtime.
 *
 * Loads one worker-owned semantic kit, one persistent off-thread generator,
 * two isolated session providers, a shared origin package, and a predictive
 * movement corridor. It proves that rendered terrain consumes imported
 * packages instead of cold-generating on the main event loop.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import {
  RegionalPredictivePrewarmer,
  RegionalPrewarmService,
} from '../../apps/ssh-world/dist/game/regional-prewarm-service.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_REGIONAL_RUNTIME_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-motion-transport/regional-runtime-readiness-v1';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const RESOLUTION = 12;
const VIEW_RADIUS_X = 16;
const VIEW_RADIUS_Y = 10;
const ORIGIN_BOUNDS = { minX: -20, minY: -20, maxX: 20, maxY: 20 };
const assets = defaultRegionalWorldAssetPaths(ROOT);

fs.mkdirSync(OUTPUT, { recursive: true });
const startedAt = performance.now();
const kitStartedAt = performance.now();
const kit = await loadRegionalWorldKit({ worldSeed: WORLD_SEED, assets });
const kitStartupMs = performance.now() - kitStartedAt;
const started = await RegionalPrewarmService.start({
  worldSeed: String(WORLD_SEED),
  assets,
}, 120_000);
const service = started.service;
let firstWorld;
let secondWorld;
let scheduler;

try {
  const firstOriginStartedAt = performance.now();
  const origin = await service.prepare(ORIGIN_BOUNDS, RESOLUTION);
  const firstOriginRoundTripMs = performance.now() - firstOriginStartedAt;
  const totalToOriginReadyMs = performance.now() - startedAt;
  const cachedOriginStartedAt = performance.now();
  const cachedOrigin = await service.prepare(ORIGIN_BOUNDS, RESOLUTION);
  const cachedOriginRoundTripMs = performance.now() - cachedOriginStartedAt;

  firstWorld = kit.createSessionWorld();
  secondWorld = kit.createSessionWorld();
  firstWorld.importPreparedViewport(origin.viewport);
  secondWorld.importPreparedViewport(cachedOrigin.viewport);
  firstWorld.setLocalPlayerId('session-a');
  secondWorld.setLocalPlayerId('session-b');
  firstWorld.updatePlayer(player('session-a', 0, 0));
  secondWorld.updatePlayer(player('session-b', 0, 0));

  if (firstWorld.getPlayers().some((entry) => entry.userId === 'session-b') ||
      secondWorld.getPlayers().some((entry) => entry.userId === 'session-a')) {
    throw new Error('Session actor state leaked across regional providers');
  }

  firstWorld.removePlayer('session-a');
  secondWorld.removePlayer('session-b');
  const firstRenderer = renderer();
  const secondRenderer = renderer();
  const initialFrameStartedAt = performance.now();
  const firstFrame = firstRenderer.renderToBuffer(firstWorld, 0).buffer;
  const firstFrameMs = performance.now() - initialFrameStartedAt;
  const secondFrame = secondRenderer.renderToBuffer(secondWorld, 0).buffer;
  const initialHash = hashGrid(firstFrame);
  if (initialHash !== hashGrid(secondFrame)) {
    throw new Error('Two session providers diverged on the same imported origin package');
  }
  if (kit.compositor.getStats().cachedTiles !== 0) {
    throw new Error('Imported origin frame fell through to main-thread material generation');
  }

  // Destroying one session must release only its mutable/LRU state, never the
  // shared worker-owned semantic caches used by remaining sessions.
  kit.compositor.getTileAtResolution(500, 500, RESOLUTION);
  const sharedTilesBeforeDestroy = kit.compositor.getStats().cachedTiles;
  firstWorld.destroy();
  firstWorld = undefined;
  if (kit.compositor.getStats().cachedTiles !== sharedTilesBeforeDestroy) {
    throw new Error('Destroying one session cleared worker-owned shared material caches');
  }

  scheduler = new RegionalPredictivePrewarmer({
    generator: service,
    target: secondWorld,
    resolution: RESOLUTION,
    viewportRadiusX: VIEW_RADIUS_X,
    viewportRadiusY: VIEW_RADIUS_Y,
    lookaheadTiles: 32,
    fringeTiles: 4,
    onError: (error) => { throw error; },
  });
  scheduler.observe(0, 0, 1, 0);
  await scheduler.whenIdle();

  const traversal = [];
  for (let x = 0; x <= 12; x++) {
    scheduler.observe(x, 0, 1, 0);
    const covered = secondWorld.hasPreparedViewportCoverage(
      x - VIEW_RADIUS_X,
      -VIEW_RADIUS_Y,
      x + VIEW_RADIUS_X,
      VIEW_RADIUS_Y,
      RESOLUTION,
    );
    secondRenderer.setCamera(x, 0);
    const frameStartedAt = performance.now();
    const frame = secondRenderer.renderToBuffer(secondWorld, x + 1).buffer;
    traversal.push({
      x,
      covered,
      renderMs: performance.now() - frameStartedAt,
      hash: x === 12 ? hashGrid(frame) : undefined,
    });
  }
  await scheduler.whenIdle();
  if (traversal.some((entry) => !entry.covered)) {
    throw new Error('Predictive corridor had a visible coverage miss');
  }
  // The one explicit cache probe above is the only allowed main compositor
  // entry; prepared traversal must not increase it.
  if (kit.compositor.getStats().cachedTiles !== sharedTilesBeforeDestroy) {
    throw new Error('Prepared traversal fell through to main-thread material generation');
  }

  const report = {
    generatedAt: new Date().toISOString(),
    worldSeed: String(WORLD_SEED),
    topology: {
      workerOwnedSemanticKits: 1,
      persistentGeneratorThreads: 1,
      isolatedSessionProviders: 2,
      externalModelCalls: 0,
    },
    startup: {
      kitMs: round(kitStartupMs),
      mainAssetSource: kit.assetLoad.source,
      mainAssetLoadMs: round(kit.assetLoad.loadMs),
      generatorMs: round(started.startup.startupMs),
      generatorAssetSource: started.startup.assetSource,
      generatorAssetLoadMs: round(started.startup.assetLoadMs),
      totalToOriginReadyMs: round(totalToOriginReadyMs),
      firstOriginGenerationMs: round(origin.generationMs),
      firstOriginRoundTripMs: round(firstOriginRoundTripMs),
      cachedOriginRoundTripMs: round(cachedOriginRoundTripMs),
    },
    origin: {
      bounds: ORIGIN_BOUNDS,
      resolution: RESOLUTION,
      initialFrameMs: round(firstFrameMs),
      hash: initialHash,
      exactAcrossSessions: true,
    },
    sessionIsolation: {
      actorState: true,
      destroyPreservesSharedCaches: true,
    },
    traversal: {
      frames: traversal.length,
      coverageMisses: traversal.filter((entry) => !entry.covered).length,
      render: distribution(traversal.map((entry) => entry.renderMs)),
      finalHash: traversal.at(-1)?.hash,
      scheduler: scheduler.getStats(),
    },
    generator: service.getStats(),
    provider: secondWorld.getRegionalStats(),
    peakRssMiB: round(process.resourceUsage().maxRSS / 1024),
  };
  fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));
} finally {
  scheduler?.stop();
  firstWorld?.destroy();
  secondWorld?.destroy();
  await service.stop();
  kit.clearSharedCaches();
}

function renderer() {
  const value = new ViewportRenderer({
    widthTiles: 28,
    heightTiles: 18,
    pixelWidth: 320,
    pixelHeight: 176,
    tileRenderSize: RESOLUTION,
  });
  value.setCamera(0, 0);
  return value;
}

function player(userId, x, y) {
  return {
    userId,
    username: userId,
    x,
    y,
    direction: 'down',
    animationFrame: 0,
    isMoving: false,
  };
}

function hashGrid(grid) {
  const hash = crypto.createHash('sha256');
  for (const row of grid) {
    const bytes = Buffer.alloc(row.length * 3);
    for (let x = 0; x < row.length; x++) {
      const pixel = row[x] ?? { r: 0, g: 0, b: 0 };
      bytes[x * 3] = pixel.r;
      bytes[x * 3 + 1] = pixel.g;
      bytes[x * 3 + 2] = pixel.b;
    }
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function distribution(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
  return {
    p50Ms: round(percentile(0.5)),
    p95Ms: round(percentile(0.95)),
    p99Ms: round(percentile(0.99)),
    maxMs: round(Math.max(...values)),
  };
}

function round(value) {
  return Number(value.toFixed(3));
}
