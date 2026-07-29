import fs from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length < 2) {
  throw new Error(
    'Usage: node regional-street-pair-local-policy-lab.mjs <metrics...> <output.json>',
  );
}
const outputPath = path.resolve(args.at(-1));
const inputPaths = args.slice(0, -1).map((input) => path.resolve(input));
const DISTRICT_RADIUS = 96;
const MAX_SALT = 0xffff;
const SITE_PRIORITY_SALT = 0x4d6f;
const POLICY_ROUNDS = Number(process.env.MALDOROR_PAIR_POLICY_ROUNDS ?? '1');
const HASH_MODE = process.env.MALDOROR_PAIR_POLICY_HASH_MODE ?? 'signature-salt';
if (!Number.isInteger(POLICY_ROUNDS) || POLICY_ROUNDS < 0 || POLICY_ROUNDS > 4) {
  throw new Error(`Invalid MALDOROR_PAIR_POLICY_ROUNDS: ${POLICY_ROUNDS}`);
}
if (![
  'signature-salt',
  'signature-seed',
  'route-signature-seed',
  'lattice-index',
].includes(HASH_MODE)) {
  throw new Error(`Invalid MALDOROR_PAIR_POLICY_HASH_MODE: ${HASH_MODE}`);
}

const stringHash = (value) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};
const spatialHash2DUnit = (seed, x, y, salt) => {
  let value = (seed ^ salt ^ Math.imul(Math.trunc(x), 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value ^= Math.imul(Math.trunc(y), 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 13), 0x27d4eb2d);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
};
const pairKey = (pair) => [...pair.visualGroups].sort().join('|');
const distance = (left, right) => Math.hypot(
  left.routeStart[0] - right.routeStart[0],
  left.routeStart[1] - right.routeStart[1],
);

const samples = [];
for (const inputPath of inputPaths) {
  const metrics = JSON.parse(await fs.readFile(inputPath, 'utf8'));
  if (!metrics.focalEligibilityAudit?.attempts || !metrics.worldSeed) {
    throw new Error(`Missing focal eligibility audit or world seed: ${inputPath}`);
  }
  const seed = Number(BigInt.asUintN(32, BigInt(String(metrics.worldSeed))));
  const sites = metrics.focalEligibilityAudit.attempts.filter((attempt) => (
    attempt.withAlternatives?.candidateOptions?.length > 0
  )).map((attempt) => ({
    key: attempt.key,
    site: attempt.site,
    routeStart: attempt.routeStart,
    options: attempt.withAlternatives.candidateOptions,
    priority: spatialHash2DUnit(seed, attempt.site[0], attempt.site[1], SITE_PRIORITY_SALT),
  }));
  samples.push({
    source: inputPath,
    seed,
    sites,
    higherNeighbours: sites.map((site, siteIndex) => sites.map((candidate, candidateIndex) => ({
      candidate,
      candidateIndex,
    })).filter(({ candidate, candidateIndex }) => (
      candidateIndex !== siteIndex && distance(site, candidate) <= DISTRICT_RADIUS &&
      (candidate.priority > site.priority || (
        candidate.priority === site.priority && (
          candidate.site[1] < site.site[1] ||
          (candidate.site[1] === site.site[1] && candidate.site[0] < site.site[0])
        )
      ))
    )).map(({ candidateIndex }) => candidateIndex)),
  });
}

function select(sample, salt) {
  const variation = (site, pair) => {
    const signatureHash = stringHash(pairKey(pair));
    if (HASH_MODE === 'signature-seed') {
      return spatialHash2DUnit(sample.seed ^ signatureHash, site.site[0], site.site[1], salt);
    }
    if (HASH_MODE === 'route-signature-seed') {
      return spatialHash2DUnit(
        sample.seed ^ signatureHash,
        Math.floor(site.routeStart[0]),
        Math.floor(site.routeStart[1]),
        salt,
      );
    }
    return spatialHash2DUnit(
      sample.seed,
      site.site[0],
      site.site[1],
      signatureHash ^ salt,
    );
  };
  let choices = sample.sites.map((site) => {
    const ordered = [...site.options].sort((left, right) => (
      pairKey(left).localeCompare(pairKey(right)) || left.id.localeCompare(right.id)
    ));
    if (HASH_MODE === 'lattice-index') {
      const scales = [12, 16, 20, 24, 32, 48, 64, 96];
      const scale = scales[salt & 7];
      const coefficientX = ((salt >>> 3) & 15) + 1;
      const coefficientY = ((salt >>> 7) & 15) + 1;
      const phase = salt >>> 11;
      const index = ((
        coefficientX * Math.floor(site.routeStart[0] / scale) +
        coefficientY * Math.floor(site.routeStart[1] / scale) + phase
      ) % ordered.length + ordered.length) % ordered.length;
      return ordered[index];
    }
    return ordered.sort((left, right) => (
      variation(site, right) - variation(site, left) || left.id.localeCompare(right.id)
    ))[0];
  });
  for (let round = 0; round < POLICY_ROUNDS; round++) {
    choices = sample.sites.map((site, siteIndex) => {
      const neighbours = sample.higherNeighbours[siteIndex].map((index) => choices[index]);
      return [...site.options].sort((left, right) => {
        const score = (pair) => {
          const signature = pairKey(pair);
          const groups = new Set(pair.visualGroups);
          return {
            pairReuse: neighbours.filter((candidate) => pairKey(candidate) === signature).length,
            groupReuse: neighbours.reduce((total, candidate) => (
              total + candidate.visualGroups.filter((group) => groups.has(group)).length
            ), 0),
          };
        };
        const leftScore = score(left);
        const rightScore = score(right);
        return leftScore.pairReuse - rightScore.pairReuse ||
          leftScore.groupReuse - rightScore.groupReuse ||
          variation(site, right) - variation(site, left) || left.id.localeCompare(right.id);
      })[0];
    });
  }
  return sample.sites.map((site, siteIndex) => ({
    ...site,
    pair: choices[siteIndex],
  }));
}

function summarize(selection) {
  const counts = new Map();
  let nearPairRepeatEdges = 0;
  let nearGroupReuseEdges = 0;
  for (const site of selection) {
    const signature = pairKey(site.pair);
    counts.set(signature, (counts.get(signature) ?? 0) + 1);
  }
  for (let first = 0; first < selection.length; first++) {
    for (let second = first + 1; second < selection.length; second++) {
      const left = selection[first];
      const right = selection[second];
      if (distance(left, right) > DISTRICT_RADIUS) continue;
      if (pairKey(left.pair) === pairKey(right.pair)) nearPairRepeatEdges++;
      const rightGroups = new Set(right.pair.visualGroups);
      if (left.pair.visualGroups.some((group) => rightGroups.has(group))) {
        nearGroupReuseEdges++;
      }
    }
  }
  const entropy = [...counts.values()].reduce((sum, count) => {
    const probability = count / Math.max(1, selection.length);
    return sum - probability * Math.log(probability);
  }, 0);
  return {
    occupiedSiteCount: selection.length,
    uniquePairSignatureCount: counts.size,
    effectivePairSignatureCount: Number(Math.exp(entropy).toFixed(4)),
    nearPairRepeatEdges,
    nearGroupReuseEdges,
  };
}

const results = [];
for (let salt = 0; salt <= MAX_SALT; salt++) {
  const sampleResults = samples.map((sample) => summarize(select(sample, salt)));
  results.push({
    salt,
    maxNearPairRepeatEdges: Math.max(...sampleResults.map((sample) => (
      sample.nearPairRepeatEdges
    ))),
    totalNearPairRepeatEdges: sampleResults.reduce((total, sample) => (
      total + sample.nearPairRepeatEdges
    ), 0),
    maxNearGroupReuseEdges: Math.max(...sampleResults.map((sample) => (
      sample.nearGroupReuseEdges
    ))),
    totalNearGroupReuseEdges: sampleResults.reduce((total, sample) => (
      total + sample.nearGroupReuseEdges
    ), 0),
    totalUniquePairSignatures: sampleResults.reduce((total, sample) => (
      total + sample.uniquePairSignatureCount
    ), 0),
    totalEffectivePairSignatures: Number(sampleResults.reduce((total, sample) => (
      total + sample.effectivePairSignatureCount
    ), 0).toFixed(4)),
  });
}
results.sort((left, right) => (
  left.maxNearPairRepeatEdges - right.maxNearPairRepeatEdges ||
  left.totalNearPairRepeatEdges - right.totalNearPairRepeatEdges ||
  left.maxNearGroupReuseEdges - right.maxNearGroupReuseEdges ||
  left.totalNearGroupReuseEdges - right.totalNearGroupReuseEdges ||
  right.totalEffectivePairSignatures - left.totalEffectivePairSignatures ||
  right.totalUniquePairSignatures - left.totalUniquePairSignatures ||
  left.salt - right.salt
));
const selected = results[0];
const selectedSamples = samples.map((sample) => {
  const selection = select(sample, selected.salt);
  return {
    source: sample.source,
    ...summarize(selection),
    selectedSites: selection.map((site) => ({
      key: site.key,
      site: site.site,
      routeStart: site.routeStart,
      pair: site.pair,
      optionCount: site.options.length,
    })),
  };
});
const output = {
  policy: 'coordinate-local higher-neighbour visual-pair priority',
  policyRounds: POLICY_ROUNDS,
  hashMode: HASH_MODE,
  districtRadius: DISTRICT_RADIUS,
  searchedSaltRange: [0, MAX_SALT],
  selected,
  samples: selectedSamples,
  top: results.slice(0, 32),
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ output: outputPath, ...selected }, null, 2)}\n`);
