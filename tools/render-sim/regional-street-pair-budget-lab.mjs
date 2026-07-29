import fs from 'node:fs/promises';
import path from 'node:path';

const inputPath = process.argv[2];
const outputPath = process.argv[3];
if (!inputPath) {
  throw new Error('Usage: node regional-street-pair-budget-lab.mjs <metrics.json> [output.json]');
}

const metrics = JSON.parse(await fs.readFile(path.resolve(inputPath), 'utf8'));
const audit = metrics.focalEligibilityAudit;
if (!audit?.attempts || !metrics.worldSeed) {
  throw new Error(`Missing focal eligibility audit or world seed: ${inputPath}`);
}

const WORLD_SEED = String(metrics.worldSeed);
const SEED_32 = Number(BigInt.asUintN(32, BigInt(WORLD_SEED)));
const DISTRICT_RADIUS = 96;
const PLACE_CELL_SIZE = 24;
const PLACE_SOURCE_REACH = 64;
const CELL_SIZES = [96, 128, 160, 192, 256, 320, 384, 512];
const PHASE_FRACTIONS = [0, 0.25, 0.5, 0.75];
const SITE_PRIORITY_SALT = 0x4d6f;
const OPTION_PRIORITY_SALT = 0x71b3;

const pairKey = (pair) => [...pair.visualGroups].sort().join('|');
const stringHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
const spatialHash2DUnit = (x, y, salt) => {
  let value = (SEED_32 ^ salt ^ Math.imul(Math.trunc(x), 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value ^= Math.imul(Math.trunc(y), 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 13), 0x27d4eb2d);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
};
const sitePriority = (site) => spatialHash2DUnit(site[0], site[1], SITE_PRIORITY_SALT);
const optionPriority = (site, pairId) => spatialHash2DUnit(
  site[0],
  site[1],
  stringHash(pairId) ^ OPTION_PRIORITY_SALT,
);
const distance = (left, right) => Math.hypot(
  left.routeStart[0] - right.routeStart[0],
  left.routeStart[1] - right.routeStart[1],
);
const cellCoordinate = (coordinate, size, phase) => Math.floor((coordinate - phase) / size);
const cellKey = (site, size, phaseX, phaseY) => `${cellCoordinate(
  site.routeStart[0], size, phaseX,
)},${cellCoordinate(site.routeStart[1], size, phaseY)}`;
const countValues = (values) => Object.fromEntries([...values.reduce((counts, value) => {
  counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}, new Map()).entries()].sort(([left], [right]) => left.localeCompare(right)));

const sites = audit.attempts.filter((attempt) => (
  attempt.withAlternatives?.candidateOptions?.length > 0
)).map((attempt) => ({
  key: attempt.key,
  site: attempt.site,
  routeStart: attempt.routeStart,
  baseline: attempt.withAlternatives.pair,
  options: attempt.withAlternatives.candidateOptions,
}));

function selectCellSites(cellSites) {
  const selected = [];
  for (const site of [...cellSites].sort((left, right) => (
    sitePriority(right.site) - sitePriority(left.site) ||
    left.site[1] - right.site[1] || left.site[0] - right.site[0]
  ))) {
    const neighbours = selected.filter((candidate) => distance(candidate, site) <= DISTRICT_RADIUS);
    const ranked = site.options.map((pair) => {
      const signature = pairKey(pair);
      const groups = new Set(pair.visualGroups);
      const pairReuse = neighbours.filter((candidate) => (
        pairKey(candidate.pair) === signature
      )).length;
      const groupReuse = neighbours.reduce((total, candidate) => (
        total + candidate.pair.visualGroups.filter((group) => groups.has(group)).length
      ), 0);
      return {
        pair,
        pairReuse,
        groupReuse,
        variation: optionPriority(site.site, pair.id),
      };
    }).sort((left, right) => (
      left.pairReuse - right.pairReuse || left.groupReuse - right.groupReuse ||
      right.variation - left.variation || left.pair.id.localeCompare(right.pair.id)
    ));
    const winner = ranked[0];
    if (!winner) continue;
    selected.push({
      ...site,
      pair: winner.pair,
      pairReuseAtAdmission: winner.pairReuse,
      groupReuseAtAdmission: winner.groupReuse,
    });
  }
  return selected;
}

function summarize(selection, ownership) {
  const signatureCounts = countValues(selection.map((entry) => pairKey(entry.pair)));
  let nearPairRepeatEdges = 0;
  let nearGroupReuseEdges = 0;
  let boundaryPairRepeatEdges = 0;
  let boundaryGroupReuseEdges = 0;
  for (let first = 0; first < selection.length; first++) {
    for (let second = first + 1; second < selection.length; second++) {
      const left = selection[first];
      const right = selection[second];
      if (distance(left, right) > DISTRICT_RADIUS) continue;
      const acrossBoundary = ownership(left) !== ownership(right);
      if (pairKey(left.pair) === pairKey(right.pair)) {
        nearPairRepeatEdges++;
        if (acrossBoundary) boundaryPairRepeatEdges++;
      }
      const rightGroups = new Set(right.pair.visualGroups);
      if (left.pair.visualGroups.some((group) => rightGroups.has(group))) {
        nearGroupReuseEdges++;
        if (acrossBoundary) boundaryGroupReuseEdges++;
      }
    }
  }
  const entropy = Object.values(signatureCounts).reduce((sum, count) => {
    const probability = count / Math.max(1, selection.length);
    return sum - probability * Math.log(probability);
  }, 0);
  return {
    occupiedSiteCount: selection.length,
    uniquePairSignatureCount: Object.keys(signatureCounts).length,
    effectivePairSignatureCount: Number(Math.exp(entropy).toFixed(4)),
    nearPairRepeatEdges,
    nearGroupReuseEdges,
    boundaryPairRepeatEdges,
    boundaryGroupReuseEdges,
    pairSignatureCounts: signatureCounts,
  };
}

const variants = [];
for (const size of CELL_SIZES) {
  for (const phaseFractionX of PHASE_FRACTIONS) {
    for (const phaseFractionY of PHASE_FRACTIONS) {
      const phaseX = Math.round(size * phaseFractionX);
      const phaseY = Math.round(size * phaseFractionY);
      const cells = new Map();
      for (const site of sites) {
        const key = cellKey(site, size, phaseX, phaseY);
        const members = cells.get(key) ?? [];
        members.push(site);
        cells.set(key, members);
      }
      const selection = [...cells.values()].flatMap(selectCellSites);
      const ownership = (site) => cellKey(site, size, phaseX, phaseY);
      variants.push({
        cellSize: size,
        phaseX,
        phaseY,
        cellCount: cells.size,
        estimatedPlaceCellEvaluationsPerOwnedCell: Math.ceil(
          (size + PLACE_SOURCE_REACH * 2) / PLACE_CELL_SIZE,
        ) ** 2,
        ...summarize(selection, ownership),
        selectedSites: selection.sort((left, right) => (
          left.site[1] - right.site[1] || left.site[0] - right.site[0]
        )).map((entry) => ({
          key: entry.key,
          site: entry.site,
          routeStart: entry.routeStart,
          ownershipCell: ownership(entry),
          pair: entry.pair,
          pairReuseAtAdmission: entry.pairReuseAtAdmission,
          groupReuseAtAdmission: entry.groupReuseAtAdmission,
          candidateOptionCount: entry.options.length,
        })),
      });
    }
  }
}

const ranked = [...variants].sort((left, right) => (
  right.occupiedSiteCount - left.occupiedSiteCount ||
  left.nearPairRepeatEdges - right.nearPairRepeatEdges ||
  left.nearGroupReuseEdges - right.nearGroupReuseEdges ||
  left.boundaryPairRepeatEdges - right.boundaryPairRepeatEdges ||
  left.boundaryGroupReuseEdges - right.boundaryGroupReuseEdges ||
  right.effectivePairSignatureCount - left.effectivePairSignatureCount ||
  left.estimatedPlaceCellEvaluationsPerOwnedCell -
    right.estimatedPlaceCellEvaluationsPerOwnedCell ||
  left.cellSize - right.cellSize || left.phaseY - right.phaseY || left.phaseX - right.phaseX
));

const unpartitionedSelection = selectCellSites(sites);
const output = {
  source: path.resolve(inputPath),
  worldSeed: WORLD_SEED,
  districtRadius: DISTRICT_RADIUS,
  siteCount: sites.length,
  optionCount: sites.reduce((total, site) => total + site.options.length, 0),
  unpartitioned: summarize(unpartitionedSelection, () => 'unpartitioned'),
  selected: ranked[0],
  pareto: ranked.slice(0, 16).map(({ selectedSites: _selectedSites, ...variant }) => variant),
  variants: variants.map(({ selectedSites: _selectedSites, ...variant }) => variant),
};
const encoded = `${JSON.stringify(output, null, 2)}\n`;
if (outputPath) {
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(path.resolve(outputPath), encoded);
}
process.stdout.write(encoded);
