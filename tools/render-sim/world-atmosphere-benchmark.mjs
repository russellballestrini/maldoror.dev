/** Bounded 160x46 atmosphere-pass benchmark over the real viewport renderer. */
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ViewportRenderer } from '../../packages/render/dist/pixel/viewport-renderer.js';

const OUTPUT = process.env.MALDOROR_LIVING_WORLD_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/living-world-research/deterministic-life-v1';
const FRAMES = 240;
const pixels = Array.from({ length: 4 }, (_, y) => (
  Array.from({ length: 4 }, (_, x) => ({
    r: 92 + x * 18,
    g: 74 + y * 15,
    b: 68 + (x + y) * 9,
  }))
));
const tile = { id: 'benchmark-material', name: 'benchmark material', walkable: true, pixels };

function world(life, lights = []) {
  return {
    getTile: () => tile,
    getPlayers: () => [],
    getPlayerSprite: () => null,
    getLocalPlayerId: () => 'benchmark',
    ...(life ? { getWorldLifeState: () => life } : {}),
    getLightSourcesInBounds: () => lights,
  };
}

function life(weather) {
  return {
    worldId: 'primary',
    worldSeed: '8801799478018485',
    worldMinute: 780,
    weather,
    weatherIntensity: 0.86,
    weatherUntilWorldMinute: 900,
    season: 'summer',
    rngState: 1234567,
    surfaceWetness: weather === 'storm' ? 0.88 : 0.12,
    waterTurbulence: weather === 'storm' ? 0.82 : 0.08,
    vegetationVitality: 0.72,
    decayPressure: 0.1,
  };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

function scenario(label, source) {
  const renderer = new ViewportRenderer({
    widthTiles: 40,
    heightTiles: 12,
    pixelWidth: 160,
    pixelHeight: 46,
    tileRenderSize: 4,
    dataResolution: 4,
  });
  renderer.setCamera(0, 0);
  return { label, source, renderer, timings: [] };
}

function summarize({ label, timings }) {
  return {
    label,
    frames: FRAMES,
    p50Ms: Number(percentile(timings, 0.5).toFixed(3)),
    p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
    p99Ms: Number(percentile(timings, 0.99).toFixed(3)),
    maxMs: Number(Math.max(...timings).toFixed(3)),
  };
}

const scenarios = [
  scenario('no-atmosphere', world(null)),
  scenario('clear-day-night-grade', world(life('clear'))),
  scenario('storm-grade-and-streaks', world(life('storm'))),
  scenario('wet-night-with-36-lights', world({
    ...life('clear'),
    worldMinute: 0,
    surfaceWetness: 0.9,
    season: 'autumn',
    decayPressure: 0.8,
  }, Array.from({ length: 36 }, (_, index) => ({
    id: `benchmark-light-${index}`,
    x: (index % 9) * 5 - 20,
    y: Math.floor(index / 9) * 5 - 8,
    radius: 5.5,
    intensity: 0.9,
    color: { r: 255, g: 177, b: 88 },
  })))),
];
for (let frame = 0; frame < 30; frame++) {
  for (const current of scenarios) current.renderer.renderToBuffer(current.source, frame);
}
// Rotate order every frame so warmup, GC, and scheduler noise are not assigned
// systematically to one weather state.
for (let frame = 0; frame < FRAMES; frame++) {
  for (let offset = 0; offset < scenarios.length; offset++) {
    const current = scenarios[(frame + offset) % scenarios.length];
    const started = performance.now();
    current.renderer.renderToBuffer(current.source, frame);
    current.timings.push(performance.now() - started);
  }
}
const [baseline, clear, storm, wetNightLights] = scenarios.map(summarize);
const report = {
  viewportPixels: { width: 160, height: 46 },
  baseline,
  clear,
  storm,
  wetNightLights,
  p95OverheadMs: {
    clear: Number((clear.p95Ms - baseline.p95Ms).toFixed(3)),
    storm: Number((storm.p95Ms - baseline.p95Ms).toFixed(3)),
    wetNightLights: Number((wetNightLights.p95Ms - baseline.p95Ms).toFixed(3)),
  },
};
fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(
  `${OUTPUT}/atmosphere-performance.json`,
  `${JSON.stringify(report, null, 2)}\n`,
);
console.log(JSON.stringify(report, null, 2));
