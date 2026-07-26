/**
 * Regional traversal latency lab.
 *
 * Separates synchronous world preparation from viewport rendering. A primed
 * frame is only evidence that the cache-import seam works; its preparation
 * time remains explicit and must move off the input/render thread before live
 * integration.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalRouteContactKit,
  loadRegionalRouteMaterialKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';
import {
  REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import {
  BiomeWorldField,
  RegionalMaterialCompositor,
  RegionalRouteField,
  RegionalWorldTileProvider,
} from '../../packages/world/dist/index.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { RegionalPrewarmService } from '../../apps/ssh-world/dist/game/regional-prewarm-service.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_REGIONAL_TRAVERSAL_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-5-motion-transport/regional-traversal-v1';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const WIDTH = 320;
const HEIGHT = 176;
const DISPLAY_TILE_SIZE = 16;
const ASSET_PATHS = {
  biomeMaterials: path.join(ROOT, 'assets/biomes/manifest.json'),
  routeMaterials: path.join(ROOT, 'assets/routes/manifest.json'),
  landmarks: path.join(ROOT, 'assets/biomes/landmarks-manifest.json'),
  ambient: path.join(ROOT, 'assets/biomes/ambient-manifest.json'),
  routeContacts: path.join(ROOT, 'assets/biomes/route-contacts-manifest.json'),
  parcelComponents: path.join(ROOT, 'assets/biomes/parcel-components-manifest.json'),
  environmentContacts: path.join(ROOT, 'assets/biomes/environment-contacts-manifest.json'),
};
const FRAME_COUNT = Number(process.env.MALDOROR_TRAVERSAL_FRAMES ?? 32);
if (!Number.isInteger(FRAME_COUNT) || FRAME_COUNT < 8 || FRAME_COUNT > 160) {
  throw new Error(`MALDOROR_TRAVERSAL_FRAMES must be an integer in 8..160; got ${FRAME_COUNT}`);
}

fs.mkdirSync(OUTPUT, { recursive: true });
const [
  biomeKit,
  routeKit,
  landmarkKit,
  ambientKit,
  routeContactKit,
  parcelKit,
  environmentKit,
] = await Promise.all([
  loadRegionalBiomeMaterialKit(ASSET_PATHS.biomeMaterials),
  loadRegionalRouteMaterialKit(ASSET_PATHS.routeMaterials),
  loadRegionalLandmarkKit(ASSET_PATHS.landmarks),
  loadRegionalAmbientKit(ASSET_PATHS.ambient),
  loadRegionalRouteContactKit(ASSET_PATHS.routeContacts),
  loadRegionalParcelComponentKit(ASSET_PATHS.parcelComponents),
  loadRegionalEnvironmentContactKit(ASSET_PATHS.environmentContacts),
]);

const pathCoordinates = Array.from({ length: FRAME_COUNT }, (_, index) => ({
  index,
  x: -160 + index * 10,
  y: Math.round(-96 + Math.sin(index / 4.5) * 72 + index * 2.5),
}));

function createWorld() {
  const field = new BiomeWorldField(WORLD_SEED, { blockSize: 16, maxCachedBlocks: 48 });
  const routes = new RegionalRouteField(WORLD_SEED, field, {
    blockSize: 32,
    maxCachedBlocks: 128,
    maxCachedPaths: 512,
    maxCachedSites: 4096,
    pathStep: 4,
  });
  const compositor = new RegionalMaterialCompositor({
    worldSeed: WORLD_SEED,
    field,
    materials: biomeKit.materials,
    overviewMaterials: biomeKit.overviewMaterials,
    landmarkFabricMaterials: biomeKit.landmarkFabricMaterials,
    routes,
    routeMaterials: routeKit.routeMaterials,
    crossingMaterials: routeKit.crossingMaterials,
    routeSurfaceStyles: routeKit.routeSurfaceStyles,
    crossingSurfaceStyles: routeKit.crossingSurfaceStyles,
    maxCachedTiles: 4096,
    variantPeriodTiles: 5,
    textureScaleTiles: 7,
    maxOutputResolution: Math.min(biomeKit.sourceTileSize, routeKit.sourceTileSize),
  });
  const world = new RegionalWorldTileProvider({
    worldSeed: WORLD_SEED,
    field,
    routes,
    compositor,
    landmarks: landmarkKit.assets,
    ambient: ambientKit.assets,
    routeContacts: routeContactKit.assets,
    parcelComponents: parcelKit.assets,
    environmentContacts: environmentKit.assets,
    blockSize: landmarkKit.blockSize,
    maxCachedBlocks: 64,
    ambientCellSize: ambientKit.cellSize,
    ambientDensity: ambientKit.density,
    ambientDistributionProfile: REGIONAL_AMBIENT_DISTRIBUTION_PROFILE,
    ambientLandmarkClearance: ambientKit.landmarkClearance,
    routeContactCellSize: routeContactKit.cellSize,
    routeContactDensity: routeContactKit.density,
    routeContactLandmarkClearance: routeContactKit.landmarkClearance,
    maxCachedRouteContactCells: 4096,
    parcelMinimumLayers: parcelKit.minimumLayers,
    parcelMaximumLayers: parcelKit.maximumLayers,
    parcelLayerSpacing: parcelKit.layerSpacing,
    environmentContactCellSize: environmentKit.cellSize,
    environmentContactDensity: environmentKit.density,
    environmentContactLandmarkClearance: environmentKit.landmarkClearance,
  });
  return { field, routes, compositor, world };
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

function viewportBounds(position, predictionMargin = 2) {
  const radiusX = Math.ceil(WIDTH / DISPLAY_TILE_SIZE / 2) + predictionMargin;
  const radiusY = Math.ceil(HEIGHT / DISPLAY_TILE_SIZE / 2) + predictionMargin;
  return {
    minX: position.x - radiusX,
    minY: position.y - radiusY,
    maxX: position.x + radiusX,
    maxY: position.y + radiusY,
  };
}

async function measureBlocking(operation) {
  const startedAt = performance.now();
  const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - startedAt), 0));
  const value = operation();
  const elapsedMs = performance.now() - startedAt;
  const timerLagMs = await timer;
  return { value, elapsedMs, timerLagMs };
}

async function measureAsyncResponsiveness(operation) {
  const delay = monitorEventLoopDelay({ resolution: 1 });
  delay.enable();
  const startedAt = performance.now();
  const value = await operation();
  const elapsedMs = performance.now() - startedAt;
  await new Promise((resolve) => setImmediate(resolve));
  delay.disable();
  return {
    value,
    elapsedMs,
    eventLoopDelayMaxMs: delay.max / 1e6,
    eventLoopDelayP99Ms: delay.percentile(99) / 1e6,
  };
}

function hashGrid(grid) {
  const hash = crypto.createHash('sha256');
  const rowBuffer = Buffer.alloc(WIDTH * 3);
  for (const row of grid) {
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

async function runMode(name, primeBeforeRender) {
  const { field, routes, compositor, world } = createWorld();
  const renderer = createRenderer();
  const frames = [];
  for (const position of pathCoordinates) {
    const bounds = viewportBounds(position);
    let preparation = null;
    if (primeBeforeRender) {
      const measured = await measureBlocking(() => world.prewarm(
        bounds.minX,
        bounds.minY,
        bounds.maxX,
        bounds.maxY,
        DISPLAY_TILE_SIZE,
      ));
      preparation = {
        elapsedMs: measured.elapsedMs,
        timerLagMs: measured.timerLagMs,
        ...measured.value,
      };
    }
    renderer.setCamera(position.x, position.y);
    const render = await measureBlocking(() => renderer.renderToBuffer(world, position.index).buffer);
    frames.push({
      ...position,
      preparation,
      renderMs: render.elapsedMs,
      renderTimerLagMs: render.timerLagMs,
      hash: hashGrid(render.value),
      rssMiB: Number((process.memoryUsage.rss() / 1024 / 1024).toFixed(2)),
      fieldStats: field.getStats(),
      routeStats: routes.getStats(),
      compositorStats: compositor.getStats(),
      providerStats: world.getRegionalStats(),
    });
  }
  world.destroy();
  return {
    name,
    frames,
    render: distribution(frames.map((frame) => frame.renderMs)),
    renderTimerLag: distribution(frames.map((frame) => frame.renderTimerLagMs)),
    preparation: primeBeforeRender
      ? distribution(frames.map((frame) => frame.preparation.elapsedMs))
      : null,
    preparationTimerLag: primeBeforeRender
      ? distribution(frames.map((frame) => frame.preparation.timerLagMs))
      : null,
    peakRssMiB: Math.max(...frames.map((frame) => frame.rssMiB)),
  };
}

async function runWorkerMode() {
  const { field, routes, compositor, world } = createWorld();
  const renderer = createRenderer();
  const { service, startup } = await RegionalPrewarmService.start({
    worldSeed: String(WORLD_SEED),
    assets: ASSET_PATHS,
  });
  const frames = [];
  try {
    for (const position of pathCoordinates) {
      const bounds = viewportBounds(position);
      const prepared = await measureAsyncResponsiveness(() => service.prepare(
        bounds,
        DISPLAY_TILE_SIZE,
      ));
      const imported = await measureBlocking(() => world.importPreparedViewport(
        prepared.value.viewport,
      ));
      renderer.setCamera(position.x, position.y);
      const render = await measureBlocking(() => renderer.renderToBuffer(world, position.index).buffer);
      frames.push({
        ...position,
        workerGenerationMs: prepared.value.generationMs,
        workerRoundTripMs: prepared.value.roundTripMs,
        observedRoundTripMs: prepared.elapsedMs,
        transferOverheadMs: Math.max(0, prepared.value.roundTripMs - prepared.value.generationMs),
        prepareEventLoopDelayMaxMs: prepared.eventLoopDelayMaxMs,
        prepareEventLoopDelayP99Ms: prepared.eventLoopDelayP99Ms,
        importMs: imported.elapsedMs,
        importTimerLagMs: imported.timerLagMs,
        renderMs: render.elapsedMs,
        renderTimerLagMs: render.timerLagMs,
        hash: hashGrid(render.value),
        rssMiB: Number((process.memoryUsage.rss() / 1024 / 1024).toFixed(2)),
        workerReportedRssMiB: prepared.value.rssMiB,
        fieldStats: field.getStats(),
        routeStats: routes.getStats(),
        compositorStats: compositor.getStats(),
        providerStats: world.getRegionalStats(),
      });
    }
  } finally {
    await service.stop();
    world.destroy();
  }
  return {
    name: 'worker-primed',
    startup,
    frames,
    workerGeneration: distribution(frames.map((frame) => frame.workerGenerationMs)),
    workerRoundTrip: distribution(frames.map((frame) => frame.workerRoundTripMs)),
    transferOverhead: distribution(frames.map((frame) => frame.transferOverheadMs)),
    prepareEventLoopDelayMax: distribution(frames.map((frame) => frame.prepareEventLoopDelayMaxMs)),
    prepareEventLoopDelayP99: distribution(frames.map((frame) => frame.prepareEventLoopDelayP99Ms)),
    import: distribution(frames.map((frame) => frame.importMs)),
    importTimerLag: distribution(frames.map((frame) => frame.importTimerLagMs)),
    render: distribution(frames.map((frame) => frame.renderMs)),
    renderTimerLag: distribution(frames.map((frame) => frame.renderTimerLagMs)),
    peakRssMiB: Math.max(...frames.map((frame) => frame.rssMiB)),
  };
}

function distribution(values) {
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

const demand = await runMode('demand-generated', false);
const primed = await runMode('synchronously-primed', true);
const workerPrimed = await runWorkerMode();
const mismatches = demand.frames.filter((frame, index) => frame.hash !== primed.frames[index]?.hash)
  .map((frame) => frame.index);
const workerMismatches = demand.frames
  .filter((frame, index) => frame.hash !== workerPrimed.frames[index]?.hash)
  .map((frame) => frame.index);
const report = {
  generatedAt: new Date().toISOString(),
  worldSeed: String(WORLD_SEED),
  sourceDimensions: [WIDTH, HEIGHT],
  terminalDimensions: [WIDTH / 2, HEIGHT / 4],
  displayTileSize: DISPLAY_TILE_SIZE,
  path: pathCoordinates,
  modes: { demand, primed, workerPrimed },
  exactFrameHashMismatches: mismatches,
  workerExactFrameHashMismatches: workerMismatches,
  interpretation: {
    primedRenderExcludesPreparation: true,
    synchronousPreparationIsNotProductionReady: true,
    workerPreparationIsOffInputThread: true,
    workerRoundTripIsLeadTimeNotInputLatency: true,
    requiredNextStep: 'pipeline velocity-aware lookahead while the current imported viewport remains interactive',
  },
};
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({
  output: OUTPUT,
  demandRender: demand.render,
  primedRender: primed.render,
  primedPreparation: primed.preparation,
  workerGeneration: workerPrimed.workerGeneration,
  workerRoundTrip: workerPrimed.workerRoundTrip,
  workerTransferOverhead: workerPrimed.transferOverhead,
  workerPrepareEventLoopDelayMax: workerPrimed.prepareEventLoopDelayMax,
  workerImport: workerPrimed.import,
  workerRender: workerPrimed.render,
  demandPeakRssMiB: demand.peakRssMiB,
  primedPeakRssMiB: primed.peakRssMiB,
  workerPeakRssMiB: workerPrimed.peakRssMiB,
  exactFrameHashMismatches: mismatches,
  workerExactFrameHashMismatches: workerMismatches,
}, null, 2));
