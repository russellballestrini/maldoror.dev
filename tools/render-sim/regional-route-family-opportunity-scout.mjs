import fs from 'node:fs/promises';
import path from 'node:path';
import {
  BIOME_FAMILIES,
  BiomeWorldField,
  CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
  RegionalRouteField,
} from '../../packages/world/dist/index.js';

const outputPath = path.resolve(process.argv[2] ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/' +
  'track-4-world-composition/regional-route-family-opportunity-v193/scout.json');
const worldSeed = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const bounds = (process.env.MALDOROR_ROUTE_SCOUT_BOUNDS ?? '-1024,-1024,1024,1024')
  .split(',').map(Number);
const step = Number(process.env.MALDOROR_ROUTE_SCOUT_STEP ?? '4');
const maximumCandidates = Number(process.env.MALDOROR_ROUTE_SCOUT_CANDIDATES ?? '24');
if (bounds.length !== 4 || bounds.some((value) => !Number.isSafeInteger(value)) ||
    bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
  throw new Error('MALDOROR_ROUTE_SCOUT_BOUNDS must be integer minX,minY,maxX,maxY');
}
if (!Number.isSafeInteger(step) || step < 1 || step > 32 ||
    !Number.isSafeInteger(maximumCandidates) || maximumCandidates < 1 ||
    maximumCandidates > 256) {
  throw new Error('Invalid route scout step or candidate limit');
}

const field = new BiomeWorldField(worldSeed, {
  blockSize: 16,
  maxCachedBlocks: 64,
  arrivalCivicBranches: CANAL_TOWN_ARRIVAL_CIVIC_BRANCHES,
});
const routes = new RegionalRouteField(worldSeed, field, {
  blockSize: 32,
  maxCachedBlocks: 256,
  maxCachedPaths: 1024,
  pathStep: 4,
});
const vocabularies = new Map();
for (const family of BIOME_FAMILIES) {
  for (const axis of ['east-west', 'north-south']) {
    vocabularies.set(`${family}:${axis}`, {
      family,
      axis,
      sampleCount: 0,
      candidates: [],
      candidateByCell: new Map(),
    });
  }
}
let evaluatedSamples = 0;
let walkableRouteSamples = 0;
const startedAt = performance.now();
for (let y = bounds[1]; y <= bounds[3]; y += step) {
  for (let x = bounds[0]; x <= bounds[2]; x += step) {
    evaluatedSamples++;
    const route = routes.sample(x, y);
    if (!route.isWalkableRoute || !route.routeKind || !route.routeId) continue;
    const biome = field.sample(x, y);
    if (biome.isWater) continue;
    walkableRouteSamples++;
    const familyIndex = biome.weights.reduce((best, weight, index, weights) => (
      weight > weights[best] ? index : best
    ), 0);
    const family = BIOME_FAMILIES[familyIndex];
    const axis = Math.abs(route.directionX) > Math.abs(route.directionY)
      ? 'east-west'
      : 'north-south';
    const vocabulary = vocabularies.get(`${family}:${axis}`);
    vocabulary.sampleCount++;
    const candidate = {
      x,
      y,
      familyWeight: Number(biome.weights[familyIndex].toFixed(6)),
      runnerUpWeight: Number([...biome.weights].sort((a, b) => b - a)[1].toFixed(6)),
      waterDistance: Number(biome.waterDistance.toFixed(4)),
      routeDistance: Number(route.distance.toFixed(4)),
      routeKind: route.routeKind,
      routeId: route.routeId,
      direction: [
        Number(route.directionX.toFixed(6)),
        Number(route.directionY.toFixed(6)),
      ],
    };
    const cellKey = `${Math.floor(x / 96)},${Math.floor(y / 96)}`;
    const incumbent = vocabulary.candidateByCell.get(cellKey);
    if (!incumbent ||
        candidate.familyWeight > incumbent.familyWeight ||
        (candidate.familyWeight === incumbent.familyWeight &&
          candidate.routeDistance < incumbent.routeDistance)) {
      vocabulary.candidateByCell.set(cellKey, candidate);
    }
  }
  if ((y - bounds[1]) % (step * 64) === 0) {
    process.stderr.write(`${JSON.stringify({ y, evaluatedSamples, walkableRouteSamples })}\n`);
  }
}
for (const vocabulary of vocabularies.values()) {
  const ranked = [...vocabulary.candidateByCell.values()].sort((left, right) => (
    right.familyWeight - left.familyWeight || left.routeDistance - right.routeDistance ||
    left.y - right.y || left.x - right.x
  ));
  for (const candidate of ranked) {
    if (vocabulary.candidates.some((existing) => (
      Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < 96
    ))) continue;
    vocabulary.candidates.push(candidate);
    if (vocabulary.candidates.length >= maximumCandidates) break;
  }
  delete vocabulary.candidateByCell;
}
const output = {
  worldSeed: String(worldSeed),
  bounds,
  step,
  evaluatedSamples,
  walkableRouteSamples,
  elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  vocabularies: Object.fromEntries([...vocabularies.entries()].map(([key, value]) => [
    key,
    value,
  ])),
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  evaluatedSamples,
  walkableRouteSamples,
  elapsedMs: output.elapsedMs,
  counts: Object.fromEntries([...vocabularies.entries()].map(([key, value]) => (
    [key, value.sampleCount]
  ))),
}, null, 2)}\n`);
