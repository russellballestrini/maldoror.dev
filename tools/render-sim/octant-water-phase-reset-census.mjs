/**
 * Geometry census and exact-output oracle for octant water-phase counting.
 *
 * This deliberately records no timings: it renders one production-shaped
 * origin frame, counts deterministic counter-reset operations, and hashes all
 * terminal planes so an implementation change can prove semantic identity.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import { renderOctantPackedGridCells } from '../../packages/render/dist/pixel/pixel-renderer.js';
import { PHASES } from '../../packages/render/dist/pixel/palette-cycle.js';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { createPlaceholderSprite } from '../../packages/world/dist/index.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import {
  readRegionalRuntimePrewarmBundle,
} from '../../apps/ssh-world/dist/game/regional-runtime-prewarm.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const RESOLUTION = 12;
const WORLD_MINUTE = 480;
const FRAME = 31;
const assets = defaultRegionalWorldAssetPaths(ROOT);
const kit = await loadRegionalWorldKit({ worldSeed: WORLD_SEED, assets });
const prewarm = await readRegionalRuntimePrewarmBundle(assets.runtimePrewarm);
const viewports = prewarm.bundle.viewports.filter((viewport) => (
  viewport.worldSeed === String(WORLD_SEED) && viewport.resolution === RESOLUTION
));
if (viewports.length === 0) throw new Error('No matching baked 12px origin viewports');

const world = kit.createSessionWorld({ maxPreparedViewports: viewports.length + 1 });
try {
  for (const viewport of viewports) world.importPreparedViewport(viewport);
  world.setLocalPlayerId('player-00');
  world.setWorldLifeState({
    worldId: 'octant-water-phase-reset-census',
    worldSeed: String(WORLD_SEED),
    worldMinute: WORLD_MINUTE,
    weather: 'clear',
    weatherIntensity: 0.1,
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
  world.updatePlayer(player('player-00', 0.18, 0));

  const renderer = new ViewportRenderer({
    widthTiles: 28,
    heightTiles: 18,
    pixelWidth: 320,
    pixelHeight: 176,
    tileRenderSize: RESOLUTION,
  });
  renderer.setCamera(0, 0);
  const frame = renderer.renderToBuffer(world, FRAME);
  if (!frame.materialGrid) throw new Error('Representative frame has no material grid');
  const packed = renderOctantPackedGridCells(
    frame.buffer,
    frame.brightnessGrid,
    frame.materialGrid,
  );
  const census = countWaterPhaseCells(frame.materialGrid, frame.buffer.length,
    frame.buffer[0]?.length ?? 0);

  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    measurementKind: 'deterministic geometry census; no wall-clock timing',
    scenario: {
      worldSeed: String(WORLD_SEED),
      resolution: RESOLUTION,
      frame: FRAME,
      geometry: {
        cols: 160,
        rows: 46,
        pixels: [frame.buffer[0]?.length ?? 0, frame.buffer.length],
        terminalCells: packed.codepoints.length,
      },
      worldMinute: WORLD_MINUTE,
      weather: 'clear',
      colocatedPlayers: 20,
      bakedViewports: viewports.length,
    },
    waterPhaseCounterResets: census,
    packedIndexPlaneInitialization: {
      indexPlanes: 2,
      terminalCells: packed.codepoints.length,
      eagerWholePlaneWrites: packed.codepoints.length * 2,
      requiredPerCellResetWrites: packed.codepoints.length * 2,
      selectedAvoidedWrites: packed.codepoints.length * 2,
    },
    exactOracle: {
      pixelGridSha256: hashPixelGrid(frame.buffer),
      materialGridSha256: hashRows(frame.materialGrid),
      terminalPlanesSha256: hashTerminalPlanes(packed),
      terminalPlaneSha256: {
        codepoints: hashView(packed.codepoints),
        foreground: hashView(packed.foreground),
        background: hashView(packed.background),
        foregroundIndex: hashView(packed.foregroundIndex),
        backgroundIndex: hashView(packed.backgroundIndex),
      },
    },
  }, null, 2));
} finally {
  world.destroy();
  kit.clearSharedCaches();
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

function countWaterPhaseCells(materialGrid, pixelHeight, pixelWidth) {
  const sampleHistogram = Array.from({ length: 9 }, () => 0);
  let waterPhaseCells = 0;
  let indexedWaterCells = 0;
  let terminalCells = 0;
  for (let y = 0; y < pixelHeight; y += 4) {
    for (let x = 0; x < pixelWidth; x += 2) {
      terminalCells++;
      let waterSamples = 0;
      for (let dy = 0; dy < 4; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const encodedPhase = materialGrid[y + dy]?.[x + dx] ?? 0;
          if (encodedPhase >= 1 && encodedPhase <= PHASES) waterSamples++;
        }
      }
      sampleHistogram[waterSamples]++;
      if (waterSamples > 0) waterPhaseCells++;
      if (waterSamples >= 6) indexedWaterCells++;
    }
  }
  const eagerCounterResetWrites = terminalCells * PHASES;
  const lazyCounterResetWrites = waterPhaseCells * PHASES;
  return {
    phases: PHASES,
    terminalCells,
    waterPhaseCells,
    indexedWaterCells,
    dryCells: terminalCells - waterPhaseCells,
    waterSampleHistogram: sampleHistogram,
    eagerCounterResetWrites,
    lazyCounterResetWrites,
    avoidedCounterResetWrites: eagerCounterResetWrites - lazyCounterResetWrites,
    avoidedCounterResetPercent: round(
      (1 - lazyCounterResetWrites / eagerCounterResetWrites) * 100,
    ),
  };
}

function hashPixelGrid(grid) {
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

function hashRows(rows) {
  const hash = crypto.createHash('sha256');
  for (const row of rows) hash.update(row);
  return hash.digest('hex');
}

function hashTerminalPlanes(frame) {
  const hash = crypto.createHash('sha256');
  hash.update(bytesOf(frame.codepoints));
  hash.update(bytesOf(frame.foreground));
  hash.update(bytesOf(frame.background));
  hash.update(bytesOf(frame.foregroundIndex));
  hash.update(bytesOf(frame.backgroundIndex));
  return hash.digest('hex');
}

function hashView(view) {
  return crypto.createHash('sha256').update(bytesOf(view)).digest('hex');
}

function bytesOf(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function round(value) {
  return Number(value.toFixed(3));
}
