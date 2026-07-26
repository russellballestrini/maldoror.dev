/** Attribute cold and warm regional frame time between renderer work and the
 * provider's public calls without changing either production implementation. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';
import { RegionalPrewarmService } from '../../apps/ssh-world/dist/game/regional-prewarm-service.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_FIRST_FRAME_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/' +
  'track-5-motion-transport/regional-first-frame-v1';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const RESOLUTION = 12;
const ORIGIN_BOUNDS = { minX: -20, minY: -20, maxX: 20, maxY: 20 };

fs.mkdirSync(OUTPUT, { recursive: true });
const assets = defaultRegionalWorldAssetPaths(ROOT);
const [kit, started] = await Promise.all([
  loadRegionalWorldKit({ worldSeed: WORLD_SEED, assets }),
  RegionalPrewarmService.start({ worldSeed: String(WORLD_SEED), assets }, 120_000),
]);
const service = started.service;
const origin = await service.prepare(ORIGIN_BOUNDS, RESOLUTION);
const initialViewports = service.getBakedViewports(RESOLUTION);
const world = kit.createSessionWorld({ maxPreparedViewports: initialViewports.length + 1 });
for (const viewport of initialViewports.length > 0 ? initialViewports : [origin.viewport]) {
  world.importPreparedViewport(viewport);
}
const instrumented = instrumentProvider(world);
const renderer = createRenderer();
const checkpoints = [];

try {
  checkpoints.push(renderCheckpoint('origin-cold', renderer, instrumented, 0, 0, 0));
  checkpoints.push(renderCheckpoint('origin-warm', renderer, instrumented, 0, 0, 1));
  checkpoints.push(renderCheckpoint('east-cold', renderer, instrumented, 64, 0, 2));
  checkpoints.push(renderCheckpoint('east-warm', renderer, instrumented, 64, 0, 3));
  checkpoints.push(renderCheckpoint('west-cold', renderer, instrumented, -64, 0, 4));
  checkpoints.push(renderCheckpoint('west-warm', renderer, instrumented, -64, 0, 5));
  checkpoints.push(renderCheckpoint('north-cold', renderer, instrumented, 0, -64, 6));
  checkpoints.push(renderCheckpoint('north-warm', renderer, instrumented, 0, -64, 7));
  checkpoints.push(renderCheckpoint('south-cold', renderer, instrumented, 0, 64, 8));
  checkpoints.push(renderCheckpoint('south-warm', renderer, instrumented, 0, 64, 9));

  const report = {
    generatedAt: new Date().toISOString(),
    worldSeed: String(WORLD_SEED),
    runtimeDigest: started.startup.assetRuntimeDigest,
    runtimePrewarmSource: started.startup.runtimePrewarmSource,
    bakedVisualViewports: initialViewports.length,
    checkpoints,
    provider: world.getRegionalStats(),
    peakRssMiB: round(process.resourceUsage().maxRSS / 1024),
  };
  fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));
} finally {
  world.destroy();
  await service.stop();
  kit.clearSharedCaches();
}

function createRenderer() {
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

function instrumentProvider(target) {
  let current = null;
  const wrappers = new Map();
  const proxy = new Proxy(target, {
    get(value, property) {
      const original = Reflect.get(value, property, value);
      if (typeof original !== 'function') return original;
      let wrapper = wrappers.get(property);
      if (!wrapper) {
        wrapper = (...args) => {
          const startedAt = performance.now();
          try {
            return Reflect.apply(original, value, args);
          } finally {
            if (current) {
              const key = String(property);
              const entry = current.calls[key] ?? { count: 0, milliseconds: 0 };
              entry.count++;
              entry.milliseconds += performance.now() - startedAt;
              current.calls[key] = entry;
            }
          }
        };
        wrappers.set(property, wrapper);
      }
      return wrapper;
    },
  });
  return {
    proxy,
    begin: () => { current = { calls: {} }; },
    finish: () => {
      const result = current;
      current = null;
      return Object.fromEntries(Object.entries(result?.calls ?? {})
        .sort((left, right) => right[1].milliseconds - left[1].milliseconds)
        .map(([key, value]) => [key, {
          count: value.count,
          milliseconds: round(value.milliseconds),
        }]));
    },
  };
}

function renderCheckpoint(id, renderer, instrumented, x, y, tick) {
  renderer.setCamera(x, y);
  instrumented.begin();
  const startedAt = performance.now();
  const frame = renderer.renderToBuffer(instrumented.proxy, tick).buffer;
  const totalMs = performance.now() - startedAt;
  const providerCalls = instrumented.finish();
  const providerMs = Object.values(providerCalls)
    .reduce((total, entry) => total + entry.milliseconds, 0);
  return {
    id,
    x,
    y,
    totalMs: round(totalMs),
    providerMs: round(providerMs),
    rendererAndProxyOverheadMs: round(totalMs - providerMs),
    hash: hashGrid(frame),
    providerCalls,
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

function round(value) {
  return Number(value.toFixed(3));
}
