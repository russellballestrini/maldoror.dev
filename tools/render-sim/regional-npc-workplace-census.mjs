/**
 * Deterministic production-world census for authored NPC workplaces.
 *
 * Input is a read-only database snapshot written outside the repository. This
 * script mutates neither the database nor runtime services and records no
 * timings; it proves binding, fallback, order independence, and doorway
 * walkability against the same regional provider used by the worker.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  defaultRegionalWorldAssetPaths,
  loadRegionalWorldKit,
} from '../../apps/ssh-world/dist/game/regional-world-provider.js';
import {
  bindNPCLifeWorkplace,
  createNPCLifeArrivalEvent,
  projectNPCLifeActivityPhase,
  stableLifeHash,
} from '../../apps/ssh-world/dist/game/npc-life-simulation.js';
import { collectRegionalLifeWorkplaces } from '../../apps/ssh-world/dist/game/regional-life-places.js';
import { npcNavigationBoundsForHome } from '../../apps/ssh-world/dist/game/npc-navigation-bounds.js';
import { findBoundedNPCPath } from '../../apps/ssh-world/dist/game/npc-pathfinding.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const snapshotPath = process.argv[2];
if (!snapshotPath) {
  throw new Error('Usage: node regional-npc-workplace-census.mjs <resident-snapshot.json>');
}
const snapshot = JSON.parse(await fs.readFile(path.resolve(snapshotPath), 'utf8'));
if (!Array.isArray(snapshot.residents) || typeof snapshot.worldSeed !== 'string' ||
    !Number.isInteger(snapshot.worldMinute)) {
  throw new Error('Resident snapshot is missing worldSeed, worldMinute, or residents');
}

const worldSeed = BigInt(snapshot.worldSeed);
const kit = await loadRegionalWorldKit({
  worldSeed,
  assets: defaultRegionalWorldAssetPaths(ROOT),
});
const world = kit.createSessionWorld({ clearSharedCachesOnDestroy: true });
try {
  const residents = [];
  for (const resident of snapshot.residents) {
    const bounds = npcNavigationBoundsForHome(
      resident.homeX,
      resident.homeY,
      resident.roamRadius,
    );
    const workplaces = collectRegionalLifeWorkplaces(world, [bounds]);
    const reachable = workplaces.filter((place) => (
      Math.hypot(place.x - resident.homeX, place.y - resident.homeY) <= resident.roamRadius
    ));
    const binding = bindNPCLifeWorkplace(
      resident.lifeState,
      workplaces,
      snapshot.worldSeed,
      resident.roamRadius,
      snapshot.worldMinute,
    );
    const reversed = bindNPCLifeWorkplace(
      resident.lifeState,
      [...workplaces].reverse(),
      snapshot.worldSeed,
      resident.roamRadius,
      snapshot.worldMinute,
    );
    const workDestinations = binding.state.schedule
      .filter((entry) => entry.activity === 'work')
      .map((entry) => [entry.destinationX, entry.destinationY]);
    const workEntry = binding.state.schedule.find((entry) => entry.activity === 'work') ?? null;
    const scheduledWorkState = workEntry === null ? null : {
      ...binding.state,
      currentActivity: 'work',
      activityStartedWorldMinute: snapshot.worldMinute,
      destinationX: workEntry.destinationX,
      destinationY: workEntry.destinationY,
    };
    const selected = reachable.find((place) => workDestinations.some((destination) => (
      destination[0] === place.x && destination[1] === place.y
    ))) ?? null;
    const selectedPath = selected ? findBoundedNPCPath({
      startX: resident.currentX,
      startY: resident.currentY,
      targetX: selected.x,
      targetY: selected.y,
      homeX: resident.homeX,
      homeY: resident.homeY,
      roamRadius: resident.roamRadius,
      tieBreaker: stableLifeHash(resident.id, selected.id, 'census-path'),
      isBlocked: (x, y) => (
        !world.getTileAtResolution(x, y, 1).walkable || world.isBuildingAt(x, y)
      ),
    }) : null;
    const arrival = selectedPath?.at(-1) ?? null;
    residents.push({
      id: resident.id,
      name: resident.name,
      home: [resident.homeX, resident.homeY],
      currentPosition: [resident.currentX, resident.currentY],
      roamRadius: resident.roamRadius,
      previousStateVersion: resident.lifeState.stateVersion,
      previousWorkDestinations: resident.lifeState.schedule
        .filter((entry) => entry.activity === 'work')
        .map((entry) => [entry.destinationX, entry.destinationY]),
      discoveredWorkplaces: workplaces.length,
      reachableWorkplaces: reachable.map((place) => ({
        ...place,
        distanceFromHome: round(Math.hypot(place.x - resident.homeX, place.y - resident.homeY)),
        walkable: world.getTileAtResolution(place.x, place.y, 1).walkable,
        buildingCollision: world.isBuildingAt(place.x, place.y),
      })),
      selectedWorkplace: selected,
      selectedPathLength: selectedPath?.length ?? null,
      selectedPath,
      selectedPathReachesWorkplace: selected === null ? null : (
        selectedPath?.at(-1)?.x === selected.x && selectedPath?.at(-1)?.y === selected.y
      ),
      currentActivityAtSnapshot: binding.state.currentActivity,
      currentDestinationAtSnapshot: [binding.state.destinationX, binding.state.destinationY],
      scheduledWorkProjection: scheduledWorkState === null ? null : {
        premise: 'scheduled work intent projection; not current-activity observation',
        activityPhaseAtBody: projectNPCLifeActivityPhase(
          scheduledWorkState,
          resident.currentX,
          resident.currentY,
          selectedPath !== null && selectedPath.length > 0,
        ),
        activityPhaseAtArrival: arrival === null ? null : projectNPCLifeActivityPhase(
          scheduledWorkState,
          arrival.x,
          arrival.y,
          false,
        ),
        arrivalEvent: arrival === null ? null : createNPCLifeArrivalEvent({
          life: scheduledWorkState,
          x: arrival.x,
          y: arrival.y,
          worldMinute: snapshot.worldMinute,
          workplaceId: selected?.id,
        }),
      },
      boundStateVersion: binding.state.stateVersion,
      boundWorkDestinations: workDestinations,
      bindingEvent: binding.event,
      inputOrderIndependent: JSON.stringify(binding) === JSON.stringify(reversed),
      fallbackPreserved: reachable.length === 0 && binding.state === resident.lifeState,
    });
  }
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    measurementKind: 'read-only deterministic geometry and life-state census; no timing',
    sourceSnapshot: path.resolve(snapshotPath),
    worldSeed: snapshot.worldSeed,
    worldMinute: snapshot.worldMinute,
    residents,
    summary: {
      residents: residents.length,
      placeBoundResidents: residents.filter((resident) => resident.selectedWorkplace !== null).length,
      fallbackResidents: residents.filter((resident) => resident.fallbackPreserved).length,
      allSelectedDoorsWalkable: residents.every((resident) => (
        resident.selectedWorkplace === null || resident.reachableWorkplaces.some((place) => (
          place.id === resident.selectedWorkplace.id && place.walkable && !place.buildingCollision
        ))
      )),
      allBindingsOrderIndependent: residents.every((resident) => resident.inputOrderIndependent),
      allSelectedWorkplacesPathReachable: residents.every((resident) => (
        resident.selectedWorkplace === null || resident.selectedPathReachesWorkplace === true
      )),
      scheduledWorkProjectedResidents: residents.filter((resident) => (
        resident.scheduledWorkProjection !== null
      )).length,
      allScheduledWorkBodiesTraveling: residents.every((resident) => (
        resident.scheduledWorkProjection?.activityPhaseAtBody === 'traveling'
      )),
      allScheduledWorkArrivalsEngaged: residents.every((resident) => (
        resident.scheduledWorkProjection?.activityPhaseAtArrival === 'engaged'
      )),
      allScheduledWorkArrivalsAudited: residents.every((resident) => (
        resident.scheduledWorkProjection?.arrivalEvent?.eventType === 'activity_arrived'
      )),
    },
  }, null, 2));
} finally {
  world.destroy();
  kit.clearSharedCaches();
}

function round(value) {
  return Number(value.toFixed(3));
}
