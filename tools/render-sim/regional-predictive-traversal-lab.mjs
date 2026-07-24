/**
 * Real-cadence predictive traversal proof at the Gate-D 160x46 geometry.
 *
 * One persistent worker prepares velocity-projected corridors while the main
 * thread continues rendering an already imported rectangle. Startup lead time,
 * worker generation/clone time, import time, frame time, coverage misses,
 * cadence drift, event-loop delay, RSS, and independent hash checkpoints are
 * retained separately.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import {
  RegionalPredictivePrewarmer,
  RegionalPrewarmService,
} from '../../apps/ssh-world/dist/game/regional-prewarm-service.js';
import { loadRegionalWorldProvider } from '../../apps/ssh-world/dist/game/regional-world-provider.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_PREDICTIVE_TRAVERSAL_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-motion-transport/regional-predictive-traversal-v1';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const FRAME_COUNT = Number(process.env.MALDOROR_PREDICTIVE_FRAMES ?? 180);
if (!Number.isInteger(FRAME_COUNT) || FRAME_COUNT < 60 || FRAME_COUNT > 900) {
  throw new Error(`MALDOROR_PREDICTIVE_FRAMES must be an integer in 60..900; got ${FRAME_COUNT}`);
}
const TERMINAL_COLUMNS = 160;
const TERMINAL_ROWS = 46;
const WIDTH = TERMINAL_COLUMNS * 2;
const HEIGHT = TERMINAL_ROWS * 4;
const DISPLAY_TILE_SIZE = 16;
const TICK_RATE = 15;
const TICK_MS = 1000 / TICK_RATE;
const VIEW_RADIUS_X = Math.ceil(WIDTH / DISPLAY_TILE_SIZE / 2) + 2;
const VIEW_RADIUS_Y = Math.ceil(HEIGHT / DISPLAY_TILE_SIZE / 2) + 2;
const ASSETS = {
  biomeMaterials: path.join(ROOT, 'assets/biomes/manifest.json'),
  routeMaterials: path.join(ROOT, 'assets/routes/manifest.json'),
  landmarks: path.join(ROOT, 'assets/biomes/landmarks-manifest.json'),
  ambient: path.join(ROOT, 'assets/biomes/ambient-manifest.json'),
  routeContacts: path.join(ROOT, 'assets/biomes/route-contacts-manifest.json'),
  parcelComponents: path.join(ROOT, 'assets/biomes/parcel-components-manifest.json'),
  environmentContacts: path.join(ROOT, 'assets/biomes/environment-contacts-manifest.json'),
};

fs.mkdirSync(OUTPUT, { recursive: true });
const pathCoordinates = Array.from({ length: FRAME_COUNT }, (_, index) => ({
  index,
  x: -160 + index * 0.25,
  y: -96 + Math.sin(index / 38) * 3.5 + index * 0.035,
}));
const loaded = await loadRegionalWorldProvider({ worldSeed: WORLD_SEED, assets: ASSETS });
const renderer = createRenderer();
const { service, startup } = await RegionalPrewarmService.start({
  worldSeed: String(WORLD_SEED),
  assets: ASSETS,
});
const generationEvents = [];
const importEvents = [];
const generator = {
  prepare: async (bounds, resolution) => {
    const result = await service.prepare(bounds, resolution);
    generationEvents.push({
      bounds,
      generationMs: result.generationMs,
      roundTripMs: result.roundTripMs,
      transferOverheadMs: Math.max(0, result.roundTripMs - result.generationMs),
      rssMiB: result.rssMiB,
    });
    return result;
  },
};
const target = {
  importPreparedViewport: (viewport) => {
    const startedAt = performance.now();
    loaded.world.importPreparedViewport(viewport);
    importEvents.push({
      bounds: viewport.bounds,
      resolution: viewport.resolution,
      elapsedMs: performance.now() - startedAt,
      at: new Date().toISOString(),
    });
  },
  hasPreparedViewportCoverage: (...args) => loaded.world.hasPreparedViewportCoverage(...args),
};
const errors = [];
const scheduler = new RegionalPredictivePrewarmer({
  generator,
  target,
  resolution: DISPLAY_TILE_SIZE,
  viewportRadiusX: VIEW_RADIUS_X,
  viewportRadiusY: VIEW_RADIUS_Y,
  lookaheadTiles: 32,
  fringeTiles: 4,
  onError: (error) => errors.push(error.message),
});

const first = pathCoordinates[0];
const second = pathCoordinates[1];
const initialLeadStartedAt = performance.now();
scheduler.observe(first.x, first.y, second.x - first.x, second.y - first.y);
await scheduler.whenIdle();
const initialLeadMs = performance.now() - initialLeadStartedAt;

const eventLoopDelay = monitorEventLoopDelay({ resolution: 1 });
eventLoopDelay.enable();
const frames = [];
const traversalStartedAt = performance.now();
for (let index = 0; index < pathCoordinates.length; index++) {
  const position = pathCoordinates[index];
  const next = pathCoordinates[Math.min(pathCoordinates.length - 1, index + 1)];
  const previous = pathCoordinates[Math.max(0, index - 1)];
  const velocityX = next.x - previous.x;
  const velocityY = next.y - previous.y;
  scheduler.observe(position.x, position.y, velocityX, velocityY);
  const visible = visibleBounds(position);
  const coveredBeforeRender = loaded.world.hasPreparedViewportCoverage(
    visible.minX,
    visible.minY,
    visible.maxX,
    visible.maxY,
    DISPLAY_TILE_SIZE,
  );
  renderer.setCamera(position.x, position.y);
  const rendered = await measureBlocking(() => renderer.renderToBuffer(loaded.world, index).buffer);
  frames.push({
    ...position,
    coveredBeforeRender,
    renderMs: rendered.elapsedMs,
    renderTimerLagMs: rendered.timerLagMs,
    hash: checkpointIndex(index) ? hashGrid(rendered.value) : null,
    rssMiB: Number((process.memoryUsage.rss() / 1024 / 1024).toFixed(2)),
    scheduler: scheduler.getStats(),
    provider: loaded.world.getRegionalStats(),
    field: loaded.field.getStats(),
    routes: loaded.routes.getStats(),
    compositor: loaded.compositor.getStats(),
  });
  const deadline = traversalStartedAt + (index + 1) * TICK_MS;
  const remaining = deadline - performance.now();
  if (remaining > 0) await delay(remaining);
}
const traversalElapsedMs = performance.now() - traversalStartedAt;
await scheduler.whenIdle();
eventLoopDelay.disable();
scheduler.stop();
await service.stop();

const checkpointIndices = frames.filter((frame) => frame.hash !== null).map((frame) => frame.index);
const reference = await verifyCheckpoints(checkpointIndices);
const checkpointMismatches = frames
  .filter((frame) => frame.hash !== null && frame.hash !== reference.get(frame.index))
  .map((frame) => frame.index);

const report = {
  generatedAt: new Date().toISOString(),
  worldSeed: String(WORLD_SEED),
  terminalDimensions: [TERMINAL_COLUMNS, TERMINAL_ROWS],
  sourceDimensions: [WIDTH, HEIGHT],
  displayTileSize: DISPLAY_TILE_SIZE,
  tickRate: TICK_RATE,
  frameCount: FRAME_COUNT,
  expectedTraversalMs: FRAME_COUNT * TICK_MS,
  traversalElapsedMs: round(traversalElapsedMs),
  startup,
  initialLeadMs: round(initialLeadMs),
  frames,
  generationEvents,
  importEvents,
  scheduler: scheduler.getStats(),
  coverageMissFrames: frames.filter((frame) => !frame.coveredBeforeRender).map((frame) => frame.index),
  render: distribution(frames.map((frame) => frame.renderMs)),
  renderTimerLag: distribution(frames.map((frame) => frame.renderTimerLagMs)),
  generation: distribution(generationEvents.map((entry) => entry.generationMs)),
  roundTrip: distribution(generationEvents.map((entry) => entry.roundTripMs)),
  transferOverhead: distribution(generationEvents.map((entry) => entry.transferOverheadMs)),
  import: distribution(importEvents.map((entry) => entry.elapsedMs)),
  eventLoopDelay: {
    minMs: round(eventLoopDelay.min / 1e6),
    p50Ms: round(eventLoopDelay.percentile(50) / 1e6),
    p95Ms: round(eventLoopDelay.percentile(95) / 1e6),
    p99Ms: round(eventLoopDelay.percentile(99) / 1e6),
    maxMs: round(eventLoopDelay.max / 1e6),
  },
  peakRssMiB: Math.max(...frames.map((frame) => frame.rssMiB)),
  checkpointIndices,
  checkpointMismatches,
  errors,
  interpretation: {
    startupLeadExcludedFromInputLatency: true,
    generationAndCloneRunOffInputThread: true,
    onlyPackageImportRunsSynchronouslyOnMainThread: true,
    completeGateDStillRequiresProductionSshLoadAndPhysicalGhostty: true,
  },
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  startup,
  initialLeadMs: report.initialLeadMs,
  traversalElapsedMs: report.traversalElapsedMs,
  render: report.render,
  eventLoopDelay: report.eventLoopDelay,
  generation: report.generation,
  roundTrip: report.roundTrip,
  import: report.import,
  scheduler: report.scheduler,
  coverageMissFrames: report.coverageMissFrames,
  peakRssMiB: report.peakRssMiB,
  checkpointMismatches,
  errors,
}, null, 2));
loaded.world.destroy();

async function verifyCheckpoints(indices) {
  const referenceWorld = await loadRegionalWorldProvider({ worldSeed: WORLD_SEED, assets: ASSETS });
  const referenceRenderer = createRenderer();
  const hashes = new Map();
  try {
    for (const index of indices) {
      const position = pathCoordinates[index];
      referenceRenderer.setCamera(position.x, position.y);
      hashes.set(index, hashGrid(referenceRenderer.renderToBuffer(referenceWorld.world, index).buffer));
    }
  } finally {
    referenceWorld.world.destroy();
  }
  return hashes;
}

function createRenderer() {
  return new ViewportRenderer({
    widthTiles: Math.ceil(WIDTH / DISPLAY_TILE_SIZE),
    heightTiles: Math.ceil(HEIGHT / DISPLAY_TILE_SIZE),
    pixelWidth: WIDTH,
    pixelHeight: HEIGHT,
    tileRenderSize: DISPLAY_TILE_SIZE,
  });
}

function visibleBounds(position) {
  return {
    minX: Math.floor(position.x - VIEW_RADIUS_X),
    minY: Math.floor(position.y - VIEW_RADIUS_Y),
    maxX: Math.ceil(position.x + VIEW_RADIUS_X),
    maxY: Math.ceil(position.y + VIEW_RADIUS_Y),
  };
}

function checkpointIndex(index) {
  return index === 0 || index === FRAME_COUNT - 1 || index % Math.max(1, Math.floor(FRAME_COUNT / 10)) === 0;
}

async function measureBlocking(operation) {
  const startedAt = performance.now();
  const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - startedAt), 0));
  const value = operation();
  const elapsedMs = performance.now() - startedAt;
  const timerLagMs = await timer;
  return { value, elapsedMs, timerLagMs };
}

function hashGrid(grid) {
  const hash = crypto.createHash('sha256');
  const rowBuffer = Buffer.alloc(WIDTH * 3);
  for (const row of grid) {
    rowBuffer.fill(0);
    for (let x = 0; x < WIDTH; x++) {
      const pixel = row[x] ?? { r: 0, g: 0, b: 0 };
      rowBuffer[x * 3] = pixel.r;
      rowBuffer[x * 3 + 1] = pixel.g;
      rowBuffer[x * 3 + 2] = pixel.b;
    }
    hash.update(rowBuffer);
  }
  return hash.digest('hex');
}

function distribution(values) {
  if (values.length === 0) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => ordered[Math.min(
    ordered.length - 1,
    Math.max(0, Math.ceil(ordered.length * fraction) - 1),
  )];
  return {
    count: ordered.length,
    min: round(ordered[0]),
    p50: round(percentile(0.5)),
    p95: round(percentile(0.95)),
    p99: round(percentile(0.99)),
    max: round(ordered.at(-1)),
    mean: round(ordered.reduce((total, value) => total + value, 0) / ordered.length),
  };
}

function round(value) {
  return Number(value.toFixed(2));
}
