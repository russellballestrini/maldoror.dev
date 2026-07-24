import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BIOME_FAMILIES, BiomeWorldField } from '../../packages/world/dist/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifestPath = process.argv[2] ?? path.join(REPO, 'tools/render-sim/acceptance-atlas-v1.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const errors = [];

if (manifest.schemaVersion !== 1) errors.push('schemaVersion must be 1');
if (!/^[0-9]+$/.test(manifest.worldSeed ?? '')) errors.push('worldSeed must be an unsigned integer string');
if (!Array.isArray(manifest.sites) || manifest.sites.length < 24) errors.push('at least 24 sites are required');
if (!Array.isArray(manifest.zooms) || manifest.zooms.length !== 3) errors.push('exactly three semantic zoom fixtures are required');
if (!Array.isArray(manifest.viewports) || manifest.viewports.length < 2) errors.push('at least two viewport fixtures are required');

const field = new BiomeWorldField(BigInt(manifest.worldSeed), { blockSize: 32, maxCachedBlocks: 32 });
const siteIds = new Set();
const coordinates = new Set();
const familyCounts = Object.fromEntries(BIOME_FAMILIES.map((family) => [family, 0]));
const transitionPairs = new Set();
const auditedSites = [];
for (const site of manifest.sites ?? []) {
  if (siteIds.has(site.id)) errors.push(`duplicate site id ${site.id}`);
  siteIds.add(site.id);
  const coordinate = `${site.x},${site.y}`;
  if (coordinates.has(coordinate)) errors.push(`duplicate coordinate ${coordinate}`);
  coordinates.add(coordinate);
  if (!Number.isSafeInteger(site.x) || !Number.isSafeInteger(site.y)) {
    errors.push(`${site.id} coordinates must be safe integers`);
    continue;
  }
  const sample = field.sample(site.x, site.y);
  if (sample.isWater) errors.push(`${site.id} is not a walkable land fixture`);
  const ranked = BIOME_FAMILIES
    .map((family, index) => ({ family, weight: sample.weights[index] }))
    .sort((a, b) => b.weight - a.weight);
  if (site.kind === 'family') {
    if (!BIOME_FAMILIES.includes(site.expectedPrimary)) errors.push(`${site.id} has an unknown family`);
    else familyCounts[site.expectedPrimary]++;
    if (sample.primary !== site.expectedPrimary) {
      errors.push(`${site.id} expected ${site.expectedPrimary}, got ${sample.primary}`);
    }
    if (ranked[0].weight < 0.52) errors.push(`${site.id} family weight is too weak (${ranked[0].weight})`);
  } else if (site.kind === 'transition') {
    const actualPair = ranked.slice(0, 2).map(({ family }) => family).sort();
    const expectedPair = [...(site.expectedPair ?? [])].sort();
    if (actualPair.join('+') !== expectedPair.join('+')) {
      errors.push(`${site.id} expected ${expectedPair.join('+')}, got ${actualPair.join('+')}`);
    }
    if (ranked[1].weight < 0.25) errors.push(`${site.id} secondary weight is too weak (${ranked[1].weight})`);
    transitionPairs.add(expectedPair.join('+'));
  } else {
    errors.push(`${site.id} has unknown kind ${site.kind}`);
  }
  auditedSites.push({
    id: site.id,
    x: site.x,
    y: site.y,
    primary: sample.primary,
    topWeights: ranked.slice(0, 3).map(({ family, weight }) => ({ family, weight: Number(weight.toFixed(6)) })),
    isWater: sample.isWater,
  });
}

for (const family of BIOME_FAMILIES) {
  if (familyCounts[family] < 3) errors.push(`${family} needs at least three strong fixtures`);
}
if (transitionPairs.size < 4) errors.push('at least four distinct transition pairs are required');

const environmentIds = new Set((manifest.environments ?? []).map((environment) => environment.id));
const usedEnvironmentIds = new Set((manifest.sites ?? []).map((site) => site.environment));
for (const environmentId of usedEnvironmentIds) {
  if (!environmentIds.has(environmentId)) errors.push(`unknown environment ${environmentId}`);
}
const usedEnvironments = (manifest.environments ?? []).filter((environment) => usedEnvironmentIds.has(environment.id));
const hasDay = usedEnvironments.some((environment) => environment.worldMinute >= 360 && environment.worldMinute < 1080);
const hasNight = usedEnvironments.some((environment) => environment.worldMinute < 360 || environment.worldMinute >= 1080);
const weatherKinds = new Set(usedEnvironments.map((environment) => environment.weather));
if (!hasDay || !hasNight) errors.push('both day and night environments must be assigned');
if (weatherKinds.size < 2) errors.push('at least two weather kinds must be assigned');

const report = {
  manifest: path.relative(REPO, manifestPath),
  atlasVersion: manifest.atlasVersion,
  worldSeed: manifest.worldSeed,
  siteCount: manifest.sites?.length ?? 0,
  familyCounts,
  transitionPairs: [...transitionPairs].sort(),
  zooms: manifest.zooms,
  viewports: manifest.viewports,
  environments: usedEnvironments,
  auditedSites,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) process.exitCode = 1;
