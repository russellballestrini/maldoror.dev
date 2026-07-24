#!/usr/bin/env node
/** Resumable raw-SSH + faithful-replay acceptance-atlas capture runner. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RUN_DIR = path.resolve(requiredArgument('--run-dir'));
const ENVIRONMENT = requiredArgument('--environment');
const LIMIT = integerArgument('--limit');
const SETTLE = numberArgument('--settle', 1.5);
const config = readJson(path.join(RUN_DIR, 'runtime-config.json'));
const plan = readJson(path.join(RUN_DIR, 'capture-plan.json'));
const atlas = readJson(config.atlasPath);
const environment = atlas.environments.find((candidate) => candidate.id === ENVIRONMENT);
if (!environment) throw new Error(`Unknown environment ${ENVIRONMENT}`);

await requireHealthyServer(config.statsPort);
requireScratchEnvironment(config.container, config.database, environment);

const selected = plan.captures.filter((capture) => capture.environment === ENVIRONMENT);
const captures = Number.isSafeInteger(LIMIT) ? selected.slice(0, LIMIT) : selected;
if (captures.length === 0) throw new Error(`No capture fixtures assigned to ${ENVIRONMENT}`);

const progressPath = path.join(RUN_DIR, 'atlas-progress.json');
const progress = fs.existsSync(progressPath)
  ? readJson(progressPath)
  : {
      schemaVersion: 1,
      atlasVersion: plan.atlasVersion,
      sourcePlanSha256: sha256File(path.join(RUN_DIR, 'capture-plan.json')),
      captures: {},
    };
let completed = 0;
let skipped = 0;
for (const capture of captures) {
  const captureId = `${capture.siteId}--${capture.zoom}--${capture.viewport}`;
  const rawPath = path.join(RUN_DIR, 'raw', ENVIRONMENT, `${captureId}.bin`);
  const imagePath = path.join(RUN_DIR, 'faithful', ENVIRONMENT, `${captureId}.png`);
  const existing = progress.captures[captureId];
  if (
    existing
    && existing.environment === ENVIRONMENT
    && fs.existsSync(rawPath)
    && fs.existsSync(imagePath)
    && existing.rawSha256 === sha256File(rawPath)
    && existing.imageSha256 === sha256File(imagePath)
  ) {
    skipped++;
    console.log(JSON.stringify({ event: 'atlas_capture_skipped', captureId }));
    continue;
  }

  fs.mkdirSync(path.dirname(rawPath), { recursive: true });
  fs.mkdirSync(path.dirname(imagePath), { recursive: true });
  const startedAt = Date.now();
  const captureResult = run('python3', [
    path.join(REPO, 'tools/render-sim/capture-live.py'),
    rawPath,
    '--cols', String(capture.cols),
    '--rows', String(capture.rows),
    '--settle', String(SETTLE),
    '--timeout', '60',
    '--host', '127.0.0.1',
    '--port', String(config.sshPort),
    '--identity', capture.privateKeyPath,
    '--user', capture.username,
    '--known-hosts', path.join(RUN_DIR, 'known-hosts'),
  ], { capture: true });
  run('node', [
    path.join(REPO, 'tools/render-sim/faithful-render.mjs'),
    rawPath,
    String(capture.cols),
    String(capture.rows),
    imagePath,
  ], { capture: true });

  const raw = fs.readFileSync(rawPath);
  const terminalText = stripTerminalControl(raw.toString('utf8'));
  const expectedPosition = `Pos: (${capture.x}, ${capture.y})`;
  if (!terminalText.includes(expectedPosition)) {
    throw new Error(`${captureId} did not render authoritative ${expectedPosition}`);
  }
  if (!terminalText.includes(`Zoom: ${capture.zoomLevel}%`)) {
    throw new Error(`${captureId} did not render zoom ${capture.zoomLevel}%`);
  }
  if (!terminalText.includes('Mode: OCTANT')) {
    throw new Error(`${captureId} did not use Ghostty octant mode`);
  }
  const metadata = await sharp(imagePath).metadata();
  const syncStart = Buffer.from('\x1b[?2026h');
  const syncEnd = Buffer.from('\x1b[?2026l');
  const firstStart = raw.indexOf(syncStart);
  const firstEndOffset = firstStart < 0 ? -1 : raw.indexOf(syncEnd, firstStart + syncStart.length);
  const firstEnd = firstEndOffset < 0 ? raw.length : firstEndOffset + syncEnd.length;
  const synchronizedFrames = countBuffer(raw, syncStart);
  const record = {
    captureId,
    fixtureId: capture.fixtureId,
    siteId: capture.siteId,
    environment: ENVIRONMENT,
    coordinates: [capture.x, capture.y],
    zoom: capture.zoom,
    zoomLevel: capture.zoomLevel,
    viewport: capture.viewport,
    cols: capture.cols,
    rows: capture.rows,
    durationMs: Date.now() - startedAt,
    rawPath,
    imagePath,
    rawBytes: raw.length,
    firstFrameBytes: firstEnd,
    steadyBytes: raw.length - firstEnd,
    synchronizedFrames,
    rawSha256: sha256(raw),
    imageSha256: sha256File(imagePath),
    imageWidth: metadata.width,
    imageHeight: metadata.height,
    capturedAt: new Date().toISOString(),
    captureOutput: captureResult.trim(),
  };
  progress.captures[captureId] = record;
  progress.updatedAt = record.capturedAt;
  atomicJson(progressPath, progress);
  completed++;
  console.log(JSON.stringify({ event: 'atlas_capture_complete', ...record }));
}

const environmentRecords = Object.values(progress.captures)
  .filter((record) => record.environment === ENVIRONMENT);
const summary = {
  event: 'atlas_environment_complete',
  environment: ENVIRONMENT,
  planned: selected.length,
  selectedThisRun: captures.length,
  completedThisRun: completed,
  skippedThisRun: skipped,
  retainedForEnvironment: environmentRecords.length,
  rawBytes: environmentRecords.reduce((sum, record) => sum + record.rawBytes, 0),
  synchronizedFrames: environmentRecords.reduce((sum, record) => sum + record.synchronizedFrames, 0),
};
console.log(JSON.stringify(summary, null, 2));

async function requireHealthyServer(port) {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) throw new Error(`Acceptance stats health returned ${response.status}`);
  const health = await response.json();
  if (health.status !== 'ok') throw new Error(`Acceptance server is not healthy: ${JSON.stringify(health)}`);
}

function requireScratchEnvironment(container, database, expected) {
  const actual = run('podman', [
    'exec', container,
    'psql', '--tuples-only', '--no-align', '--username', 'postgres', '--dbname', database,
    '--command', "SELECT world_minute || '|' || weather || '|' || weather_intensity FROM world_life_state WHERE world_id = 'primary'",
  ], { capture: true }).trim();
  const [minute, weather] = actual.split('|');
  if (weather !== expected.weather) {
    throw new Error(`Scratch weather is ${weather}, expected ${expected.weather}; stop, set environment, and restart`);
  }
  if (Number(minute) < expected.worldMinute) {
    throw new Error(`Scratch clock ${minute} precedes ${expected.id} fixture ${expected.worldMinute}`);
  }
}

function stripTerminalControl(value) {
  return value
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b./g, '');
}

function countBuffer(haystack, needle) {
  let count = 0;
  let offset = 0;
  while ((offset = haystack.indexOf(needle, offset)) >= 0) {
    count++;
    offset += needle.length;
  }
  return count;
}

function atomicJson(destination, value) {
  const temporary = `${destination}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temporary, destination);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256(fs.readFileSync(file));
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return options.capture ? result.stdout : '';
}

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  const value = Number.parseInt(process.argv[index + 1], 10);
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function numberArgument(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  const value = Number.parseFloat(process.argv[index + 1]);
  if (!Number.isFinite(value) || value < 0.25 || value > 10) throw new Error(`${name} must be between 0.25 and 10`);
  return value;
}
