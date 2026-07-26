/**
 * Faithful regional navigation proof for persisted inhabitants near arrival.
 *
 * The fixtures are read-only snapshots of the two production residents and
 * their already-resolved schedule destinations. Expensive world composition
 * runs once in the persistent prewarm worker; path queries consume only the
 * imported resolution-1 collision package on the main thread.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { stableLifeHash } from '../../apps/ssh-world/dist/game/npc-life-simulation.js';
import { coalesceNPCNavigationBounds } from '../../apps/ssh-world/dist/game/npc-navigation-bounds.js';
import { findBoundedNPCPath } from '../../apps/ssh-world/dist/game/npc-pathfinding.js';
import { RegionalPrewarmService } from '../../apps/ssh-world/dist/game/regional-prewarm-service.js';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OUTPUT = process.env.MALDOROR_NPC_NAVIGATION_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/living-world-research/' +
  'v149-regional-inhabitant-navigation';
const WORLD_SEED = BigInt(process.env.MALDOROR_WORLD_SEED ?? '8801799478018485');
const PADDING = 2;
const RESOLUTION = 1;
const residents = [
  {
    id: '5ac706e1-52b6-4cb6-b4af-b82fcd08c4b9',
    name: 'A Unicorn Half Lady',
    start: { x: -12, y: -16 },
    home: { x: -12, y: -16 },
    target: { x: -20, y: -11 },
    roamRadius: 15,
  },
  {
    id: '1a572329-5b6c-4ebe-a53c-13218db75c91',
    name: 'Dog',
    start: { x: -9, y: 1 },
    home: { x: -9, y: 1 },
    target: { x: -21, y: 4 },
    roamRadius: 15,
  },
];

fs.mkdirSync(OUTPUT, { recursive: true });
const assets = defaultRegionalWorldAssetPaths(ROOT);
const kitStartedAt = performance.now();
const kit = await loadRegionalWorldKit({ worldSeed: WORLD_SEED, assets });
const kitMs = performance.now() - kitStartedAt;
const started = await RegionalPrewarmService.start({
  worldSeed: String(WORLD_SEED),
  assets,
}, 120_000);
const service = started.service;
const requestedBounds = residents.map((resident) => navigationBounds(resident));
const preparedBounds = coalesceNPCNavigationBounds(requestedBounds, 15, 8192);
const collisionWorld = kit.createSessionWorld({
  maxPreparedViewports: preparedBounds.length,
  clearSharedCachesOnDestroy: false,
});

try {
  const preparations = [];
  for (const bounds of preparedBounds) {
    const prepared = await service.prepare(bounds, RESOLUTION);
    const importStartedAt = performance.now();
    collisionWorld.importPreparedViewport(prepared.viewport);
    const importMs = performance.now() - importStartedAt;
    preparations.push({
      bounds,
      area: area(bounds),
      generationMs: round(prepared.generationMs),
      roundTripMs: round(prepared.roundTripMs),
      importMs: round(importMs),
      rssMiB: prepared.rssMiB,
    });
  }

  const uncovered = requestedBounds.filter((bounds) => !collisionWorld.hasPreparedViewportCoverage(
    bounds.minX,
    bounds.minY,
    bounds.maxX,
    bounds.maxY,
    RESOLUTION,
  ));
  if (uncovered.length > 0) {
    throw new Error(`Imported collision packages left ${uncovered.length} resident bounds uncovered`);
  }

  const compositorTilesBefore = kit.compositor.getStats().cachedTiles;
  const paths = residents.map((resident) => {
    let collisionQueries = 0;
    const searchStartedAt = performance.now();
    const steps = findBoundedNPCPath({
      startX: resident.start.x,
      startY: resident.start.y,
      targetX: resident.target.x,
      targetY: resident.target.y,
      homeX: resident.home.x,
      homeY: resident.home.y,
      roamRadius: resident.roamRadius,
      tieBreaker: stableLifeHash(
        resident.id,
        resident.target.x,
        resident.target.y,
        'motor-path',
      ),
      isBlocked: (x, y) => {
        collisionQueries++;
        return !collisionWorld.getTileAtResolution(x, y, RESOLUTION).walkable ||
          collisionWorld.isBuildingAt(x, y);
      },
    });
    const searchMs = performance.now() - searchStartedAt;
    if (!steps) throw new Error(`${resident.name} has no bounded regional route`);
    assertPath(resident, steps);
    return {
      id: resident.id,
      name: resident.name,
      start: resident.start,
      target: resident.target,
      roamRadius: resident.roamRadius,
      steps: steps.length,
      collisionQueries,
      searchMs: round(searchMs),
      route: steps,
    };
  });
  const compositorTilesAfter = kit.compositor.getStats().cachedTiles;
  if (compositorTilesAfter !== compositorTilesBefore) {
    throw new Error(
      `Navigation fell through to synchronous material composition: ` +
      `${compositorTilesBefore} -> ${compositorTilesAfter}`,
    );
  }

  const report = {
    generatedAt: new Date().toISOString(),
    worldSeed: String(WORLD_SEED),
    fixtures: 'read-only production resident snapshots and resolved schedule destinations',
    topology: {
      workerOwnedSemanticKits: 1,
      persistentGeneratorThreads: 1,
      importedCollisionProviders: 1,
      externalModelCalls: 0,
    },
    startup: {
      kitMs: round(kitMs),
      mainAssetSource: kit.assetLoad.source,
      mainAssetLoadMs: round(kit.assetLoad.loadMs),
      generatorMs: round(started.startup.startupMs),
      generatorAssetSource: started.startup.assetSource,
      generatorAssetLoadMs: round(started.startup.assetLoadMs),
      generatorRssMiB: started.startup.rssMiB,
    },
    preparation: {
      requestedRegions: requestedBounds.length,
      coalescedRegions: preparedBounds.length,
      allResidentBoundsCovered: true,
      regions: preparations,
    },
    paths,
    mainThreadMaterialFallbacks: compositorTilesAfter - compositorTilesBefore,
    generator: service.getStats(),
    provider: collisionWorld.getRegionalStats(),
    peakRssMiB: round(process.resourceUsage().maxRSS / 1024),
  };
  fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));
} finally {
  collisionWorld.destroy();
  await service.stop();
  kit.clearSharedCaches();
}

function navigationBounds(resident) {
  const radius = Math.ceil(resident.roamRadius) + PADDING;
  return {
    minX: resident.home.x - radius,
    minY: resident.home.y - radius,
    maxX: resident.home.x + radius,
    maxY: resident.home.y + radius,
  };
}

function assertPath(resident, steps) {
  let previous = resident.start;
  for (const step of steps) {
    if (Math.abs(step.x - previous.x) + Math.abs(step.y - previous.y) !== 1) {
      throw new Error(`${resident.name} route contains a non-cardinal step`);
    }
    const dx = step.x - resident.home.x;
    const dy = step.y - resident.home.y;
    if (dx * dx + dy * dy > resident.roamRadius * resident.roamRadius) {
      throw new Error(`${resident.name} route escaped its persisted roam disc`);
    }
    previous = step;
  }
  if (previous.x !== resident.target.x || previous.y !== resident.target.y) {
    throw new Error(`${resident.name} route did not reach its resolved schedule target`);
  }
}

function area(bounds) {
  return (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1);
}

function round(value) {
  return Number(value.toFixed(3));
}
