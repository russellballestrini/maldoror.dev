/**
 * Reproducible retained-memory profile for the complete authored regional kit.
 *
 * Run after building ssh-world:
 *   node --expose-gc tools/render-sim/regional-asset-memory-lab.mjs
 *
 * Sequential loading makes each asset family's retained contribution visible.
 * Forced collection is deliberate: this lab measures the live kit, not sharp's
 * transient decode buffers or V8 garbage waiting for its next ordinary cycle.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  loadRegionalAmbientKit,
  loadRegionalBiomeMaterialKit,
  loadRegionalEnvironmentContactKit,
  loadRegionalLandmarkKit,
  loadRegionalParcelComponentKit,
  loadRegionalRouteContactKit,
  loadRegionalRouteMaterialKit,
} from '../../apps/ssh-world/dist/game/biome-assets.js';

if (typeof global.gc !== 'function') {
  throw new Error('regional-asset-memory-lab requires node --expose-gc');
}

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_ASSET_MEMORY_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/track-7-performance/regional-asset-memory-latest';
const definitions = [
  ['biome-materials', loadRegionalBiomeMaterialKit, 'assets/biomes/manifest.json'],
  ['route-materials', loadRegionalRouteMaterialKit, 'assets/routes/manifest.json'],
  ['landmarks', loadRegionalLandmarkKit, 'assets/biomes/landmarks-manifest.json'],
  ['ambient', loadRegionalAmbientKit, 'assets/biomes/ambient-manifest.json'],
  ['route-contacts', loadRegionalRouteContactKit, 'assets/biomes/route-contacts-manifest.json'],
  ['parcel-components', loadRegionalParcelComponentKit, 'assets/biomes/parcel-components-manifest.json'],
  ['environment-contacts', loadRegionalEnvironmentContactKit, 'assets/biomes/environment-contacts-manifest.json'],
];

const retained = [];
const stages = [snapshot('import')];
for (const [name, load, relativeManifest] of definitions) {
  const startedAt = performance.now();
  retained.push(await load(path.join(ROOT, relativeManifest)));
  const stage = snapshot(name);
  stage.loadMs = round(performance.now() - startedAt);
  stages.push(stage);
}

const first = stages[0];
const last = stages.at(-1);
const report = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  measurement: 'forced-GC retained kit by sequential family load',
  stages,
  retainedDelta: {
    heapUsedMiB: round(last.heapUsedMiB - first.heapUsedMiB),
    rssMiB: round(last.rssMiB - first.rssMiB),
    externalMiB: round(last.externalMiB - first.externalMiB),
    arrayBuffersMiB: round(last.arrayBuffersMiB - first.arrayBuffersMiB),
  },
};
fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(path.join(OUTPUT, 'metrics.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));

function snapshot(stage) {
  global.gc();
  const memory = process.memoryUsage();
  return {
    stage,
    heapUsedMiB: mib(memory.heapUsed),
    heapTotalMiB: mib(memory.heapTotal),
    rssMiB: mib(memory.rss),
    externalMiB: mib(memory.external),
    arrayBuffersMiB: mib(memory.arrayBuffers),
  };
}

function mib(bytes) {
  return round(bytes / 1024 / 1024);
}

function round(value) {
  return Number(value.toFixed(2));
}
