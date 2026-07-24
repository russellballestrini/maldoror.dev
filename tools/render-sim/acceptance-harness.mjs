#!/usr/bin/env node
/** Provision and operate the isolated Maldoror real-SSH acceptance harness. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RESEARCH_ROOT = '/mnt/donto-data/donto-resources/maldoror';
const DEFAULT_ATLAS = path.join(REPO, 'tools/render-sim/acceptance-atlas-v1.json');
const COMMAND = process.argv[2];
const RUN_DIR = validatedRunDirectory(argument('--run-dir'));
const DB_PORT = integerArgument('--db-port', 55436);
const SSH_PORT = integerArgument('--ssh-port', 3222);
const STATS_PORT = integerArgument('--stats-port', 13300);
const CONFIG_PATH = path.join(RUN_DIR, 'runtime-config.json');
const CONFIGURED_CONTAINER = COMMAND !== 'prepare' && fs.existsSync(CONFIG_PATH)
  ? JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).container
  : undefined;
const CONTAINER = argument('--container') ?? CONFIGURED_CONTAINER ?? 'maldoror-acceptance-pg';

if (COMMAND === 'prepare') await prepare();
else if (COMMAND === 'set-environment') await setEnvironment(requiredArgument('--environment'));
else if (COMMAND === 'serve') await serve();
else if (COMMAND === 'status') status();
else if (COMMAND === 'teardown') teardown();
else usage();

async function prepare() {
  await assertPortAvailable(DB_PORT);
  await assertPortAvailable(SSH_PORT);
  await assertPortAvailable(STATS_PORT);
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const atlasPath = path.resolve(argument('--atlas') ?? DEFAULT_ATLAS);
  const atlas = JSON.parse(fs.readFileSync(atlasPath, 'utf8'));
  const password = crypto.randomBytes(24).toString('base64url');
  const database = 'maldoror_acceptance';
  const databaseUrl = `postgres://postgres:${password}@127.0.0.1:${DB_PORT}/${database}`;
  const label = `dev.maldoror.acceptance.run=${RUN_DIR}`;

  if (containerExists()) {
    throw new Error(`Container ${CONTAINER} already exists; inspect or teardown it explicitly`);
  }
  try {
    run('podman', [
      'run', '--detach', '--name', CONTAINER,
      '--label', 'dev.maldoror.acceptance=1', '--label', label,
      '--env', `POSTGRES_PASSWORD=${password}`,
      '--env', `POSTGRES_DB=${database}`,
      '--publish', `127.0.0.1:${DB_PORT}:5432`,
      '--tmpfs', '/var/lib/postgresql/data:rw,size=512m',
      'docker.io/library/postgres:16-alpine',
    ]);
    await waitForDatabase(database);
    applyMigrations(database);

    const keyDirectory = path.join(RUN_DIR, 'keys');
    fs.mkdirSync(keyDirectory, { recursive: true });
    const hostKeyPath = path.join(keyDirectory, 'host-ed25519');
    run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'maldoror-acceptance-host', '-f', hostKeyPath]);

    const sessions = [];
    const capturePlan = [];
    let identityIndex = 0;
    for (const site of atlas.sites) {
      for (const zoom of atlas.zooms) {
        identityIndex++;
        const fixtureId = `${site.id}--${zoom.id}`;
        const username = `atlas-${String(identityIndex).padStart(3, '0')}`;
        const userId = crypto.randomUUID();
        const privateKeyPath = path.join(keyDirectory, fixtureId);
        run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', fixtureId, '-f', privateKeyPath]);
        const publicKey = fs.readFileSync(`${privateKeyPath}.pub`, 'utf8').trim();
        const fingerprintSha256 = publicKeyFingerprint(publicKey);
        const restoredState = {
          playerX: site.x,
          playerY: site.y,
          zoomLevel: zoom.level,
          renderMode: 'octant',
          cameraMode: 'follow',
        };
        sessions.push({
          fixtureId,
          fingerprintSha256,
          userId,
          username,
          restoredState,
        });
        for (const viewport of atlas.viewports) {
          capturePlan.push({
            fixtureId,
            siteId: site.id,
            kind: site.kind,
            expectedPrimary: site.expectedPrimary,
            expectedPair: site.expectedPair,
            x: site.x,
            y: site.y,
            zoom: zoom.id,
            zoomLevel: zoom.level,
            environment: site.environment,
            viewport: viewport.id,
            cols: viewport.cols,
            rows: viewport.rows,
            username,
            privateKeyPath,
          });
        }
      }
    }

    seedIdentities(database, atlas.worldSeed, sessions, keyDirectory);
    const runtimeManifestPath = path.join(RUN_DIR, 'runtime-manifest.json');
    writeJson(runtimeManifestPath, {
      schemaVersion: 1,
      atlasVersion: atlas.atlasVersion,
      worldSeed: atlas.worldSeed,
      sourceAtlasPath: atlasPath,
      sourceAtlasSha256: sha256File(atlasPath),
      sessions,
    }, 0o600);
    writeJson(path.join(RUN_DIR, 'capture-plan.json'), {
      schemaVersion: 1,
      atlasVersion: atlas.atlasVersion,
      captureCount: capturePlan.length,
      captures: capturePlan,
    }, 0o600);
    writeJson(CONFIG_PATH, {
      schemaVersion: 1,
      container: CONTAINER,
      database,
      databaseUrl,
      dbPort: DB_PORT,
      sshPort: SSH_PORT,
      statsPort: STATS_PORT,
      hostKeyPath,
      runtimeManifestPath,
      atlasPath,
    }, 0o600);
    await setEnvironment(atlas.environments[0].id);
    console.log(JSON.stringify({
      event: 'acceptance_prepared',
      runDir: RUN_DIR,
      container: CONTAINER,
      identities: sessions.length,
      captures: capturePlan.length,
      runtimeManifestPath,
      capturePlanPath: path.join(RUN_DIR, 'capture-plan.json'),
    }, null, 2));
  } catch (error) {
    if (containerExists()) removeOwnedContainer();
    throw error;
  }
}

async function setEnvironment(environmentId) {
  const config = readConfig();
  const atlas = JSON.parse(fs.readFileSync(config.atlasPath, 'utf8'));
  const environment = atlas.environments.find((candidate) => candidate.id === environmentId);
  if (!environment) throw new Error(`Unknown atlas environment ${environmentId}`);
  const season = environment.worldMinute >= 129_600 ? 'winter'
    : environment.worldMinute >= 86_400 ? 'autumn'
      : environment.worldMinute >= 43_200 ? 'summer'
        : 'spring';
  const wet = environment.weather === 'storm' ? 0.92 : environment.weather === 'rain' ? 0.7 : 0.18;
  const turbulence = environment.weather === 'storm' ? 0.88 : environment.weather === 'rain' ? 0.48 : 0.1;
  const sql = `
    INSERT INTO world_life_state (
      world_id, world_seed, world_minute, weather, weather_intensity,
      weather_until_world_minute, season, rng_state, surface_wetness,
      water_turbulence, vegetation_vitality, decay_pressure
    ) VALUES (
      'primary', ${literal(atlas.worldSeed)}, ${integer(environment.worldMinute)},
      ${literal(environment.weather)}, ${finite(environment.weatherIntensity)},
      ${integer(environment.worldMinute + 10000)}, ${literal(season)}, 194681,
      ${wet}, ${turbulence}, 0.76, 0.14
    ) ON CONFLICT (world_id) DO UPDATE SET
      world_seed = EXCLUDED.world_seed,
      world_minute = EXCLUDED.world_minute,
      weather = EXCLUDED.weather,
      weather_intensity = EXCLUDED.weather_intensity,
      weather_until_world_minute = EXCLUDED.weather_until_world_minute,
      season = EXCLUDED.season,
      rng_state = EXCLUDED.rng_state,
      surface_wetness = EXCLUDED.surface_wetness,
      water_turbulence = EXCLUDED.water_turbulence,
      vegetation_vitality = EXCLUDED.vegetation_vitality,
      decay_pressure = EXCLUDED.decay_pressure,
      updated_at = now();
  `;
  psql(config.database, sql);
  console.log(JSON.stringify({ event: 'acceptance_environment_set', ...environment, season }));
}

async function serve() {
  const config = readConfig();
  assertOwnedContainer();
  const diagnosticNodeArgs = process.env.MALDOROR_ACCEPTANCE_TRACE_GC === '1'
    ? ['--trace-gc']
    : [];
  const child = spawn(
    process.execPath,
    [...diagnosticNodeArgs, path.join(REPO, 'apps/ssh-world/dist/acceptance-server.js')],
    {
      cwd: path.join(REPO, 'apps/ssh-world'),
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: 'test',
        DATABASE_URL: config.databaseUrl,
        SSH_PORT: String(config.sshPort),
        STATS_PORT: String(config.statsPort),
        SSH_HOST_KEY_PATH: config.hostKeyPath,
        MALDOROR_ACCEPTANCE_MANIFEST: config.runtimeManifestPath,
        MALDOROR_ASSET_ROOT: REPO,
        MALDOROR_ENABLE_METERED_NPC_COGNITION: '0',
      },
    },
  );
  const forward = (signal) => child.kill(signal);
  process.on('SIGINT', forward);
  process.on('SIGTERM', forward);
  const code = await new Promise((resolve) => child.once('exit', resolve));
  process.exitCode = typeof code === 'number' ? code : 1;
}

function status() {
  const config = readConfig();
  assertOwnedContainer();
  const inspect = JSON.parse(run('podman', ['inspect', CONTAINER], { capture: true }));
  console.log(JSON.stringify({
    event: 'acceptance_status',
    runDir: RUN_DIR,
    container: CONTAINER,
    running: inspect[0]?.State?.Running === true,
    dbPort: config.dbPort,
    sshPort: config.sshPort,
    statsPort: config.statsPort,
  }, null, 2));
}

function teardown() {
  assertOwnedContainer();
  removeOwnedContainer();
  console.log(JSON.stringify({
    event: 'acceptance_scratch_database_removed',
    container: CONTAINER,
    retainedResearchArtifacts: RUN_DIR,
  }));
}

function seedIdentities(database, worldSeed, sessions, keyDirectory) {
  let sql = `INSERT INTO world (id, seed, name) VALUES (1, ${integer(BigInt(worldSeed))}, 'Maldoror acceptance') ON CONFLICT (id) DO UPDATE SET seed = EXCLUDED.seed;\n`;
  for (const session of sessions) {
    const publicKey = fs.readFileSync(path.join(keyDirectory, `${session.fixtureId}.pub`), 'utf8').trim();
    sql += `INSERT INTO users (id, username) VALUES (${literal(session.userId)}::uuid, ${literal(session.username)});\n`;
    sql += `INSERT INTO user_keys (user_id, fingerprint_sha256, public_key, label) VALUES (${literal(session.userId)}::uuid, ${literal(session.fingerprintSha256)}, ${literal(publicKey)}, ${literal(session.fixtureId)});\n`;
    sql += `INSERT INTO player_state (user_id, x, y, direction) VALUES (${literal(session.userId)}::uuid, 0, 0, 'down');\n`;
  }
  psql(database, sql);
}

function applyMigrations(database) {
  const migrationDirectory = path.join(REPO, 'packages/db/drizzle');
  const migrations = fs.readdirSync(migrationDirectory)
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .sort();
  for (const migration of migrations) {
    psql(database, fs.readFileSync(path.join(migrationDirectory, migration), 'utf8'));
    console.log(`applied ${migration}`);
  }
}

function psql(database, sql) {
  run('podman', [
    'exec', '--interactive', CONTAINER,
    'psql', '--set', 'ON_ERROR_STOP=1', '--username', 'postgres', '--dbname', database,
  ], { input: sql });
}

async function waitForDatabase(database) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const initProcess = spawnSync(
      'podman',
      ['exec', CONTAINER, 'cat', '/proc/1/comm'],
      { encoding: 'utf8' },
    );
    const result = spawnSync('podman', [
      'exec', CONTAINER, 'pg_isready', '--username', 'postgres', '--dbname', database,
    ], { encoding: 'utf8' });
    // The official image starts a temporary initialization server, stops it,
    // then starts the durable server. Do not race the first readiness window.
    if (initProcess.stdout?.trim() === 'postgres' && result.status === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('Acceptance PostgreSQL did not become ready within 30 seconds');
}

function assertPortAvailable(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', (error) => reject(new Error(`Port ${port} is unavailable: ${error.message}`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

function readConfig() {
  if (!fs.existsSync(CONFIG_PATH)) throw new Error(`No prepared harness at ${CONFIG_PATH}`);
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function containerExists() {
  return spawnSync('podman', ['container', 'exists', CONTAINER]).status === 0;
}

function assertOwnedContainer() {
  if (!containerExists()) throw new Error(`Acceptance container ${CONTAINER} does not exist`);
  const labels = JSON.parse(run('podman', ['inspect', '--format', '{{json .Config.Labels}}', CONTAINER], { capture: true }));
  if (labels['dev.maldoror.acceptance'] !== '1' || labels['dev.maldoror.acceptance.run'] !== RUN_DIR) {
    throw new Error(`Refusing to operate on unowned container ${CONTAINER}`);
  }
}

function removeOwnedContainer() {
  assertOwnedContainer();
  run('podman', ['rm', '--force', CONTAINER]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO,
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status}): ${(result.stderr || result.stdout).trim()}`);
  }
  return options.capture ? result.stdout.trim() : result.stdout;
}

function publicKeyFingerprint(publicKey) {
  const encoded = publicKey.split(/\s+/)[1];
  if (!encoded) throw new Error('Generated public key has no key blob');
  return crypto.createHash('sha256').update(Buffer.from(encoded, 'base64')).digest('base64').replace(/=+$/, '');
}

function writeJson(destination, value, mode) {
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.chmodSync(destination, mode);
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function literal(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function integer(value) {
  const numeric = typeof value === 'bigint' ? value : BigInt(value);
  return numeric.toString();
}

function finite(value) {
  if (!Number.isFinite(value)) throw new Error(`Expected a finite number, got ${value}`);
  return String(value);
}

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function requiredArgument(name) {
  const value = argument(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function integerArgument(name, fallback) {
  const value = Number.parseInt(argument(name) ?? String(fallback), 10);
  if (!Number.isSafeInteger(value) || value < 1024 || value > 65_535) throw new Error(`${name} is invalid`);
  return value;
}

function validatedRunDirectory(value) {
  if (!value) usage();
  const resolved = path.resolve(value);
  if (!resolved.startsWith(`${RESEARCH_ROOT}${path.sep}`)) {
    throw new Error(`--run-dir must be below ${RESEARCH_ROOT}`);
  }
  return resolved;
}

function usage() {
  console.error('Usage: acceptance-harness.mjs <prepare|set-environment|serve|status|teardown> --run-dir <mounted research path> [options]');
  process.exit(2);
}
