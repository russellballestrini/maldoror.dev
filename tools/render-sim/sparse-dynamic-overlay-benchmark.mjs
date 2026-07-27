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
const report = {
  generatedAt: new Date().toISOString(),
  framesPerLane: FRAMES,
  geometry: { cols: 160, rows: 46, pixels: [320, 176], resolution: RESOLUTION },
  colocatedPlayers: 20,
  bakedViewports: viewports.length,
  sparseOverlayTilesInRepresentativeBounds: sparseEntries.length,
  viewportComposition: comparison(samples),
  productionRenderToString: comparison(gameSamples),
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

function makeWorld(useSparseRange) {
  const world = kit.createSessionWorld({ maxPreparedViewports: viewports.length + 1 });
  for (const viewport of viewports) world.importPreparedViewport(viewport);
  world.setLocalPlayerId('player-00');
  world.setWorldLifeState({
    worldId: 'sparse-overlay-benchmark',
    worldSeed: String(WORLD_SEED),
    worldMinute: 480,
    weather: 'clear',
    weatherIntensity: 0.1,
    weatherUntilWorldMinute: 600,
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
