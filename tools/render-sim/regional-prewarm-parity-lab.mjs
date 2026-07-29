import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  decodeRegionalRuntimePrewarmBundle,
} from '../../apps/ssh-world/dist/game/regional-runtime-prewarm.js';

const [controlBundlePath, candidateBundlePath, controlReportPath,
  candidateReportPath, outputPath] = process.argv.slice(2).map((value) => (
  value ? path.resolve(value) : value
));
if (!controlBundlePath || !candidateBundlePath || !controlReportPath ||
    !candidateReportPath || !outputPath) {
  throw new Error(
    'Usage: regional-prewarm-parity-lab.mjs ' +
    '<control-bundle> <candidate-bundle> <control-report> <candidate-report> <output>',
  );
}

const [controlBytes, candidateBytes, controlReportBytes, candidateReportBytes] =
  await Promise.all([
    fs.readFile(controlBundlePath),
    fs.readFile(candidateBundlePath),
    fs.readFile(controlReportPath),
    fs.readFile(candidateReportPath),
  ]);
const control = decodeRegionalRuntimePrewarmBundle(controlBytes);
const candidate = decodeRegionalRuntimePrewarmBundle(candidateBytes);
const controlReport = JSON.parse(controlReportBytes.toString('utf8'));
const candidateReport = JSON.parse(candidateReportBytes.toString('utf8'));

const planeNames = [
  'terrainRgba',
  'terrainMaterial',
  'terrainWalkable',
  'overlayCoordinates',
  'overlayRgba',
  'solid',
];
const viewportKey = (viewport) => (
  `${viewport.worldSeed}:${viewport.bounds.minX},${viewport.bounds.minY},` +
  `${viewport.bounds.maxX},${viewport.bounds.maxY}@${viewport.resolution}`
);
const typedBytes = (value) => Buffer.from(
  value.buffer,
  value.byteOffset,
  value.byteLength,
);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fileRecord = (source, bytes) => ({
  source,
  bytes: bytes.length,
  sha256: digest(bytes),
});
const semanticDigest = (viewport) => {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify({
    version: viewport.version,
    worldSeed: viewport.worldSeed,
    bounds: viewport.bounds,
    resolution: viewport.resolution,
    dynamicPlacements: viewport.dynamicPlacements,
  }));
  for (const name of planeNames) {
    hash.update(name);
    hash.update(typedBytes(viewport[name]));
  }
  return hash.digest('hex');
};
const viewportRecord = (viewport) => ({
  key: viewportKey(viewport),
  semanticSha256: semanticDigest(viewport),
  terrainTiles: (viewport.bounds.maxX - viewport.bounds.minX + 1) *
    (viewport.bounds.maxY - viewport.bounds.minY + 1),
  overlays: viewport.overlayCoordinates.length / 2,
  dynamicPlacements: viewport.dynamicPlacements.length,
  planes: Object.fromEntries(planeNames.map((name) => [name, {
    bytes: viewport[name].byteLength,
    sha256: digest(typedBytes(viewport[name])),
  }])),
});
const ordered = (bundle) => [...bundle.viewports].sort((left, right) => (
  viewportKey(left).localeCompare(viewportKey(right))
));
const controlViewports = ordered(control);
const candidateViewports = ordered(candidate);
const viewportParity = controlViewports.map((controlViewport, index) => {
  const candidateViewport = candidateViewports[index];
  const controlRecord = viewportRecord(controlViewport);
  const candidateRecord = candidateViewport ? viewportRecord(candidateViewport) : null;
  const planeParity = Object.fromEntries(planeNames.map((name) => [
    name,
    Boolean(candidateViewport) &&
      typedBytes(controlViewport[name]).equals(typedBytes(candidateViewport[name])),
  ]));
  const identityEqual = Boolean(candidateViewport) &&
    viewportKey(controlViewport) === viewportKey(candidateViewport);
  const versionEqual = Boolean(candidateViewport) &&
    controlViewport.version === candidateViewport.version;
  const dynamicPlacementsEqual = Boolean(candidateViewport) &&
    JSON.stringify(controlViewport.dynamicPlacements) ===
      JSON.stringify(candidateViewport.dynamicPlacements);
  return {
    key: controlRecord.key,
    identityEqual,
    versionEqual,
    dynamicPlacementsEqual,
    planeParity,
    allEqual: identityEqual && versionEqual && dynamicPlacementsEqual &&
      Object.values(planeParity).every(Boolean),
    control: controlRecord,
    candidate: candidateRecord,
  };
});

const buildById = (report) => new Map(
  report.runtimePrewarm.builds.map((build) => [build.id, build]),
);
const controlBuilds = buildById(controlReport);
const candidateBuilds = buildById(candidateReport);
const perViewportTiming = [...controlBuilds].map(([id, controlBuild]) => {
  const candidateBuild = candidateBuilds.get(id);
  const controlMs = controlBuild.generationMs;
  const candidateMs = candidateBuild?.generationMs ?? null;
  return {
    id,
    controlMs,
    candidateMs,
    speedup: candidateMs === null ? null : controlMs / candidateMs,
    reductionRate: candidateMs === null ? null : 1 - candidateMs / controlMs,
  };
});
const sum = (values) => values.reduce((total, value) => total + value, 0);
const controlGenerationMs = sum(perViewportTiming.map((entry) => entry.controlMs));
const candidateGenerationMs = sum(perViewportTiming.map((entry) => entry.candidateMs ?? 0));
const numericEnv = (key) => {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : null;
};
const allEqual = controlViewports.length === candidateViewports.length &&
  viewportParity.length === controlViewports.length &&
  viewportParity.every((entry) => entry.allEqual) &&
  control.schemaVersion === candidate.schemaVersion &&
  control.assetManifestDigest === candidate.assetManifestDigest &&
  control.assetSourceDigest === candidate.assetSourceDigest;
const result = {
  allEqual,
  control: {
    bundle: fileRecord(controlBundlePath, controlBytes),
    report: fileRecord(controlReportPath, controlReportBytes),
    runtimeDigest: control.runtimeDigest,
    assetManifestDigest: control.assetManifestDigest,
    assetSourceDigest: control.assetSourceDigest,
    wallMs: numericEnv('MALDOROR_CONTROL_WALL_MS'),
    peakRssKiB: numericEnv('MALDOROR_CONTROL_PEAK_RSS_KIB'),
  },
  candidate: {
    bundle: fileRecord(candidateBundlePath, candidateBytes),
    report: fileRecord(candidateReportPath, candidateReportBytes),
    runtimeDigest: candidate.runtimeDigest,
    assetManifestDigest: candidate.assetManifestDigest,
    assetSourceDigest: candidate.assetSourceDigest,
    wallMs: numericEnv('MALDOROR_CANDIDATE_WALL_MS'),
    peakRssKiB: numericEnv('MALDOROR_CANDIDATE_PEAK_RSS_KIB'),
  },
  timing: {
    controlGenerationMs,
    candidateGenerationMs,
    speedup: controlGenerationMs / candidateGenerationMs,
    reductionRate: 1 - candidateGenerationMs / controlGenerationMs,
    wallSpeedup: numericEnv('MALDOROR_CONTROL_WALL_MS') /
      numericEnv('MALDOROR_CANDIDATE_WALL_MS'),
    wallReductionRate: 1 - numericEnv('MALDOROR_CANDIDATE_WALL_MS') /
      numericEnv('MALDOROR_CONTROL_WALL_MS'),
    peakRssReductionRate: 1 - numericEnv('MALDOROR_CANDIDATE_PEAK_RSS_KIB') /
      numericEnv('MALDOROR_CONTROL_PEAK_RSS_KIB'),
    perViewport: perViewportTiming,
  },
  viewportCount: controlViewports.length,
  viewportParity,
};
await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: outputPath,
  allEqual,
  viewportCount: result.viewportCount,
  timing: result.timing,
}, null, 2)}\n`);
if (!allEqual) process.exitCode = 2;
