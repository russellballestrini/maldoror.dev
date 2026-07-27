/**
 * Bounded production-shape benchmark for sparse persistent-time overlays.
 *
 * Both lanes use the same authored runtime pack, baked origin viewports,
 * 160x46 pixel geometry, atmosphere, and twenty colocated player sprites.
 * The control deliberately hides the sparse range API so the renderer falls
 * back to one dynamic-overlay lookup for every visible world tile.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Duplex } from 'node:stream';
import { PixelGameRenderer } from '../../packages/render/dist/pixel/pixel-game-renderer.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { createPlaceholderSprite } from '../../packages/world/dist/index.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import {
  readRegionalRuntimePrewarmBundle,
} from '../../apps/ssh-world/dist/game/regional-runtime-prewarm.js';

class Sink extends Duplex {
  _read() {}
  _write(_chunk, _encoding, callback) { callback(); }
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const RESOLUTION = 12;
const FRAMES = Number.parseInt(process.env.MALDOROR_BENCHMARK_FRAMES ?? '400', 10);
const WORLD_MINUTE = Number.parseInt(process.env.MALDOROR_WORLD_MINUTE ?? '480', 10);
const WEATHER = process.env.MALDOROR_WEATHER ?? 'clear';
const WEATHER_INTENSITY = Number.parseFloat(process.env.MALDOROR_WEATHER_INTENSITY ?? '0.1');
const SHARED_SESSIONS = Number.parseInt(process.env.MALDOROR_SHARED_SESSIONS ?? '0', 10);
const SHARED_FRAMES = Number.parseInt(process.env.MALDOROR_SHARED_FRAMES ?? '100', 10);
const assets = defaultRegionalWorldAssetPaths(ROOT);
const kit = await loadRegionalWorldKit({ worldSeed: WORLD_SEED, assets });
const prewarm = await readRegionalRuntimePrewarmBundle(assets.runtimePrewarm);
const viewports = prewarm.bundle.viewports.filter((viewport) => (
  viewport.worldSeed === String(WORLD_SEED) && viewport.resolution === RESOLUTION
));
if (viewports.length === 0) throw new Error('No matching baked 12px origin viewports');

const control = makeLane(false);
const sparse = makeLane(true);
for (let frame = 0; frame < 30; frame++) {
  runFrame(control, frame);
  runFrame(sparse, frame);
}

const samples = { control: [], sparse: [] };
let controlFrame;
let sparseFrame;
for (let frame = 0; frame < FRAMES; frame++) {
  const order = frame % 2 === 0
    ? [[control, samples.control], [sparse, samples.sparse]]
    : [[sparse, samples.sparse], [control, samples.control]];
  for (const [lane, laneSamples] of order) {
    const startedAt = performance.now();
    const rendered = runFrame(lane, frame + 30);
    laneSamples.push(performance.now() - startedAt);
    if (lane === control) controlFrame = rendered;
    else sparseFrame = rendered;
  }
}

const sparseEntries = sparse.world.getDynamicOverlayTilesInBounds(-16, -10, 16, 10) ?? [];
const gameControl = makeGameLane(false);
const gameSparse = makeGameLane(true);
for (let frame = 0; frame < 30; frame++) {
  runGameFrame(gameControl, frame);
  runGameFrame(gameSparse, frame);
}
const gameSamples = { control: [], sparse: [] };
for (let frame = 0; frame < FRAMES; frame++) {
  const order = frame % 2 === 0
    ? [[gameControl, gameSamples.control], [gameSparse, gameSamples.sparse]]
    : [[gameSparse, gameSamples.sparse], [gameControl, gameSamples.control]];
  for (const [lane, laneSamples] of order) {
    const startedAt = performance.now();
    runGameFrame(lane, frame + 30);
    laneSamples.push(performance.now() - startedAt);
  }
}
const sharedSessionBatch = SHARED_SESSIONS > 0
  ? runSharedSessionBenchmark(SHARED_SESSIONS, SHARED_FRAMES)
  : undefined;
const report = {
  generatedAt: new Date().toISOString(),
  framesPerLane: FRAMES,
  geometry: { cols: 160, rows: 46, pixels: [320, 176], resolution: RESOLUTION },
  environment: {
    worldMinute: WORLD_MINUTE,
    weather: WEATHER,
    weatherIntensity: WEATHER_INTENSITY,
  },
  colocatedPlayers: 20,
  bakedViewports: viewports.length,
  sparseOverlayTilesInRepresentativeBounds: sparseEntries.length,
  viewportComposition: comparison(samples),
  productionRenderToString: comparison(gameSamples),
  sharedSessionBatch,
  exactFinalPixelHash: hashGrid(controlFrame.buffer) === hashGrid(sparseFrame.buffer),
  finalPixelHash: hashGrid(sparseFrame.buffer),
};
console.log(JSON.stringify(report, null, 2));

control.world.destroy();
sparse.world.destroy();
gameControl.world.destroy();
gameSparse.world.destroy();
kit.clearSharedCaches();

function makeLane(useSparseRange) {
  const world = makeWorld(useSparseRange);
  const renderer = new ViewportRenderer({
    widthTiles: 28,
    heightTiles: 18,
    pixelWidth: 320,
    pixelHeight: 176,
    tileRenderSize: RESOLUTION,
  });
  renderer.setCamera(0, 0);
  return { world, renderer };
}

function makeGameLane(useSparseRange) {
  const world = makeWorld(useSparseRange);
  const renderer = new PixelGameRenderer({
    stream: new Sink(),
    cols: 160,
    rows: 46,
    username: 'benchmark',
    zoomLevel: 30,
    renderMode: 'octant',
    layout: { headerRows: 2, footerRows: 0, leftSidebarCols: 0, rightSidebarCols: 0 },
  });
  renderer.setCamera(0, 0);
  return { world, renderer };
}

function runSharedSessionBenchmark(sessionCount, frameCount) {
  const lanes = Array.from({ length: sessionCount }, () => makeGameLane(true));
  for (let frame = 0; frame < 30; frame++) {
    for (const lane of lanes) runGameFrame(lane, frame);
  }
  const leader = [];
  const followers = [];
  const batches = [];
  let exactFinalAnsiDelta = true;
  let finalHash;
  let uniqueFinalAnsiDeltas = 0;
  for (let frame = 0; frame < frameCount; frame++) {
    const batchStartedAt = performance.now();
    const hashes = [];
    for (let index = 0; index < lanes.length; index++) {
      const startedAt = performance.now();
      const output = runGameFrame(lanes[index], frame + 30);
      (index === 0 ? leader : followers).push(performance.now() - startedAt);
      hashes.push(crypto.createHash('sha256').update(output).digest('hex'));
    }
    batches.push((performance.now() - batchStartedAt) / lanes.length);
    finalHash = hashes[0];
    uniqueFinalAnsiDeltas = new Set(hashes).size;
    if (uniqueFinalAnsiDeltas !== 1) exactFinalAnsiDelta = false;
  }
  for (const lane of lanes) lane.world.destroy();
  return {
    sessions: sessionCount,
    frames: frameCount,
    leader: distribution(leader),
    followers: distribution(followers),
    batchPerSession: distribution(batches),
    // Independent encoders may emit different legal ANSI deltas for the same
    // terminal state; exhaustive-vs-shared pixel tests own visual equivalence.
    exactFinalAnsiDelta,
    uniqueFinalAnsiDeltas,
    finalOutputHash: finalHash,
  };
}

function makeWorld(useSparseRange) {
  const world = kit.createSessionWorld({ maxPreparedViewports: viewports.length + 1 });
  for (const viewport of viewports) world.importPreparedViewport(viewport);
  world.setLocalPlayerId('player-00');
  world.setWorldLifeState({
    worldId: 'sparse-overlay-benchmark',
    worldSeed: String(WORLD_SEED),
    worldMinute: WORLD_MINUTE,
    weather: WEATHER,
    weatherIntensity: WEATHER_INTENSITY,
    weatherUntilWorldMinute: WORLD_MINUTE + 120,
    season: 'spring',
    rngState: 1,
    surfaceWetness: 0.2,
    waterTurbulence: 0.1,
    vegetationVitality: 0.7,
    decayPressure: 0.1,
  }, 16);
  for (let index = 0; index < 20; index++) {
    const userId = `player-${String(index).padStart(2, '0')}`;
    world.updatePlayer(player(userId, (index % 5) - 2, Math.floor(index / 5) - 2));
    world.setPlayerSprite(userId, createPlaceholderSprite({
      r: 120 + index * 5,
      g: 70 + index * 3,
      b: 190 - index * 4,
    }));
  }
  if (!useSparseRange) {
    Object.defineProperty(world, 'getDynamicOverlayTilesInBounds', {
      configurable: true,
      value: undefined,
    });
  }
  return world;
}

function runFrame(lane, frame) {
  const x = frame % 2 === 0 ? -0.18 : 0.18;
  lane.world.updatePlayer(player('player-00', x, 0));
  return lane.renderer.renderToBuffer(lane.world, frame);
}

function runGameFrame(lane, frame) {
  const x = frame % 2 === 0 ? -0.18 : 0.18;
  lane.world.updatePlayer(player('player-00', x, 0));
  lane.renderer.setCamera(x, 0);
  lane.renderer.setAuthoritativePosition(0, 0);
  return lane.renderer.renderToString(lane.world);
}

function player(userId, x, y) {
  return {
    userId,
    username: userId,
    x,
    y,
    direction: x < 0 ? 'left' : 'right',
    animationFrame: 1,
    isMoving: true,
  };
}

function hashGrid(grid) {
  const hash = crypto.createHash('sha256');
  for (const row of grid) {
    const bytes = Buffer.allocUnsafe(row.length * 4);
    for (let x = 0; x < row.length; x++) {
      const pixel = row[x];
      bytes[x * 4] = pixel?.r ?? 0;
      bytes[x * 4 + 1] = pixel?.g ?? 0;
      bytes[x * 4 + 2] = pixel?.b ?? 0;
      bytes[x * 4 + 3] = pixel ? 255 : 0;
    }
    hash.update(bytes);
  }
  return hash.digest('hex');
}

function distribution(values) {
  return {
    p50: round(percentile(values, 0.5)),
    p95: round(percentile(values, 0.95)),
    p99: round(percentile(values, 0.99)),
    max: round(Math.max(...values)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}

function comparison(samples) {
  return {
    control: distribution(samples.control),
    sparse: distribution(samples.sparse),
    p95ChangePercent: round(
      (percentile(samples.sparse, 0.95) / percentile(samples.control, 0.95) - 1) * 100,
    ),
  };
}

function percentile(values, quantile) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * quantile))] ?? 0;
}

function round(value) {
  return Number(value.toFixed(3));
}
