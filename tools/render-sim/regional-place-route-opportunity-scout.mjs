import fs from 'node:fs/promises';
import path from 'node:path';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldProvider,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import { BIOME_FAMILIES } from '../../packages/world/dist/index.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const outputPath = path.resolve(process.argv[2] ??
  '/mnt/donto-data/donto-resources/maldoror/rendering-research/' +
  'track-4-world-composition/regional-route-family-opportunity-v193/place-scout.json');
const worldSeed = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const bounds = (process.env.MALDOROR_PLACE_SCOUT_BOUNDS ?? '-1024,-1024,1024,1024')
  .split(',').map(Number);
const maximumCandidates = Number(process.env.MALDOROR_PLACE_SCOUT_CANDIDATES ?? '64');
const placeCellSize = 24;
if (bounds.length !== 4 || bounds.some((value) => !Number.isSafeInteger(value)) ||
    bounds[0] >= bounds[2] || bounds[1] >= bounds[3]) {
  throw new Error('MALDOROR_PLACE_SCOUT_BOUNDS must be integer minX,minY,maxX,maxY');
}
if (!Number.isSafeInteger(maximumCandidates) || maximumCandidates < 1 ||
    maximumCandidates > 512) {
  throw new Error('Invalid place scout candidate limit');
}

const { field, routes, world, assetLoad } = await loadRegionalWorldProvider({
  worldSeed,
  assets: defaultRegionalWorldAssetPaths(ROOT),
});
if (typeof world.getAmbientPlaceProgram !== 'function') {
  throw new Error('Regional provider no longer exposes the diagnostic place-program seam');
}

const firstCellX = Math.floor(bounds[0] / placeCellSize);
const lastCellX = Math.floor(bounds[2] / placeCellSize);
const firstCellY = Math.floor(bounds[1] / placeCellSize);
const lastCellY = Math.floor(bounds[3] / placeCellSize);
const vocabularies = new Map();
let evaluatedPlaceCells = 0;
let admittedProgramCount = 0;
const startedAt = performance.now();

function sideClearance(routeX, routeY, axis, side) {
  let clearance = 0;
  for (let distance = 2; distance <= 12; distance++) {
    const x = axis === 'east-west' ? routeX : routeX + side * distance;
    const y = axis === 'east-west' ? routeY + side * distance : routeY;
    if (field.sample(x, y).isWater || routes.sample(x, y).distance < 1.5) break;
    clearance = distance;
  }
  return clearance;
}

for (let cellY = firstCellY; cellY <= lastCellY; cellY++) {
  for (let cellX = firstCellX; cellX <= lastCellX; cellX++) {
    evaluatedPlaceCells++;
    const program = world.getAmbientPlaceProgram(cellX, cellY);
    const routeStart = program?.accessPath?.points[0];
    if (!program || !routeStart) continue;
    admittedProgramCount++;
    const routeX = Math.floor(routeStart.x);
    const routeY = Math.floor(routeStart.y);
    const route = routes.sample(routeX, routeY);
    if (!route.routeKind || field.sample(routeX, routeY).isWater) continue;
    const axis = Math.abs(route.directionX) > Math.abs(route.directionY)
      ? 'east-west'
      : 'north-south';
    const biome = field.sample(routeX, routeY);
    for (const family of program.root.asset.families) {
      const key = `${family}:${axis}`;
      const vocabulary = vocabularies.get(key) ?? {
        family,
        axis,
        programCount: 0,
        candidates: [],
      };
      vocabulary.programCount++;
      const familyIndex = BIOME_FAMILIES.indexOf(family);
      const negativeClearance = sideClearance(routeX, routeY, axis, -1);
      const positiveClearance = sideClearance(routeX, routeY, axis, 1);
      vocabulary.candidates.push({
        cell: [cellX, cellY],
        site: [program.root.siteX, program.root.siteY],
        routeStart: [routeStart.x, routeStart.y],
        routeCell: [routeX, routeY],
        routeKind: route.routeKind,
        routeId: route.routeId,
        direction: [
          Number(route.directionX.toFixed(6)),
          Number(route.directionY.toFixed(6)),
        ],
        routeDistance: Number(route.distance.toFixed(4)),
        waterDistance: Number(biome.waterDistance.toFixed(4)),
        familyWeight: familyIndex >= 0
          ? Number(biome.weights[familyIndex].toFixed(6))
          : null,
        sideClearance: [negativeClearance, positiveClearance],
        minimumSideClearance: Math.min(negativeClearance, positiveClearance),
      });
      vocabularies.set(key, vocabulary);
    }
  }
  if ((cellY - firstCellY) % 8 === 0) {
    process.stderr.write(`${JSON.stringify({
      cellY,
      evaluatedPlaceCells,
      admittedProgramCount,
    })}\n`);
  }
}

for (const vocabulary of vocabularies.values()) {
  vocabulary.candidates.sort((left, right) => (
    right.minimumSideClearance - left.minimumSideClearance ||
    right.waterDistance - left.waterDistance ||
    (right.familyWeight ?? -1) - (left.familyWeight ?? -1) ||
    left.site[1] - right.site[1] || left.site[0] - right.site[0]
  ));
  vocabulary.candidates.length = Math.min(
    vocabulary.candidates.length,
    maximumCandidates,
  );
}

const output = {
  worldSeed: String(worldSeed),
  bounds,
  placeCellSize,
  evaluatedPlaceCells,
  admittedProgramCount,
  elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  assetLoad,
  vocabularies: Object.fromEntries([...vocabularies.entries()].sort()),
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  evaluatedPlaceCells,
  admittedProgramCount,
  elapsedMs: output.elapsedMs,
  counts: Object.fromEntries([...vocabularies].map(([key, value]) => (
    [key, value.programCount]
  ))),
}, null, 2)}\n`);
