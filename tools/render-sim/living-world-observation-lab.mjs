/**
 * Accelerated deterministic living-world observation.
 *
 * Runs eighteen persistent residents and two human-presence traces through a
 * full simulated day. It records schedules, movement, needs, weather response,
 * encounters, append-only facts, and a split-run restart equivalence digest.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {
  advanceNPCLifeMinute,
  advanceWorldLifeMinute,
  createInitialNPCLifeState,
  createInitialWorldLifeState,
} from '../../apps/ssh-world/dist/game/npc-life-simulation.js';

const OUTPUT = process.env.MALDOROR_LIVING_WORLD_OUTPUT ??
  '/mnt/donto-data/donto-resources/maldoror/living-world-research/deterministic-life-v1';
const WORLD_SEED = process.env.MALDOROR_WORLD_SEED ?? '8801799478018485';
const START_MINUTE = 300;
const DURATION_MINUTES = 1440;
const RESTART_MINUTE = 613;
const RESIDENT_COUNT = 18;

fs.mkdirSync(OUTPUT, { recursive: true });

function initialSimulation() {
  const world = createInitialWorldLifeState(WORLD_SEED, START_MINUTE);
  const residents = Array.from({ length: RESIDENT_COUNT }, (_, index) => {
    const homeX = (index % 6) * 4 - 10;
    const homeY = Math.floor(index / 6) * 5 - 5;
    const id = `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
    return {
      id,
      x: homeX,
      y: homeY,
      distance: 0,
      activities: new Set(),
      familiarity: new Map(),
      life: createInitialNPCLifeState({
        npcId: id,
        homeX,
        homeY,
        roamRadius: 18,
        worldMinute: world.worldMinute,
        worldSeed: WORLD_SEED,
      }),
    };
  });
  return { world, residents, events: [], samples: [] };
}

function humanPositions(worldMinute) {
  const elapsed = worldMinute - START_MINUTE;
  const patrolPhase = elapsed % 48;
  return [
    {
      id: '10000000-0000-4000-8000-000000000001',
      kind: 'player',
      x: patrolPhase < 24 ? -12 + patrolPhase : 12 - (patrolPhase - 24),
      y: -1,
    },
    {
      id: '10000000-0000-4000-8000-000000000002',
      kind: 'player',
      x: 1 + Math.round(Math.sin(elapsed / 31) * 2),
      y: 1 + Math.round(Math.cos(elapsed / 37) * 2),
    },
  ];
}

function step(simulation) {
  const worldResult = advanceWorldLifeMinute(simulation.world);
  simulation.world = worldResult.state;
  simulation.events.push(...worldResult.events);
  const people = [
    ...simulation.residents.map((resident) => ({
      id: resident.id,
      kind: 'npc',
      x: resident.x,
      y: resident.y,
    })),
    ...humanPositions(simulation.world.worldMinute),
  ];

  for (const resident of simulation.residents) {
    const perceivedPeople = people.map((person) => ({
      ...person,
      familiarity: resident.familiarity.get(person.id) ?? 0,
    }));
    const result = advanceNPCLifeMinute(
      resident.life,
      simulation.world,
      { id: resident.id, kind: 'npc', x: resident.x, y: resident.y },
      perceivedPeople,
    );
    resident.life = result.state;
    resident.activities.add(result.state.currentActivity);
    simulation.events.push(...result.events);
    for (const event of result.events) {
      if (event.eventType !== 'social_encounter' || !event.targetId) continue;
      resident.familiarity.set(
        event.targetId,
        Math.min(1, (resident.familiarity.get(event.targetId) ?? 0) + 0.04),
      );
    }
  }

  // The lab deliberately uses the same discrete, axis-priority travel cadence
  // as the runtime motor while isolating terrain collision from life policy.
  for (const resident of simulation.residents) {
    const dx = resident.life.destinationX - resident.x;
    const dy = resident.life.destinationY - resident.y;
    if (dx === 0 && dy === 0) continue;
    if (Math.abs(dx) > Math.abs(dy)) resident.x += Math.sign(dx);
    else resident.y += Math.sign(dy);
    resident.distance++;
  }

  if ((simulation.world.worldMinute - START_MINUTE) % 10 === 0) {
    simulation.samples.push({
      worldMinute: simulation.world.worldMinute,
      weather: simulation.world.weather,
      environment: {
        surfaceWetness: simulation.world.surfaceWetness,
        waterTurbulence: simulation.world.waterTurbulence,
        vegetationVitality: simulation.world.vegetationVitality,
        decayPressure: simulation.world.decayPressure,
      },
      residents: simulation.residents.map((resident) => ({
        id: resident.id,
        role: resident.life.role,
        activity: resident.life.currentActivity,
        x: resident.x,
        y: resident.y,
        needs: resident.life.needs,
      })),
      humans: humanPositions(simulation.world.worldMinute),
    });
  }
}

function run(simulation, minutes) {
  for (let minute = 0; minute < minutes; minute++) step(simulation);
  return simulation;
}

function checkpoint(simulation) {
  return {
    world: structuredClone(simulation.world),
    residents: simulation.residents.map((resident) => ({
      id: resident.id,
      x: resident.x,
      y: resident.y,
      distance: resident.distance,
      activities: new Set(resident.activities),
      familiarity: new Map(resident.familiarity),
      life: structuredClone(resident.life),
    })),
    events: structuredClone(simulation.events),
    samples: structuredClone(simulation.samples),
  };
}

function canonicalState(simulation) {
  return {
    world: simulation.world,
    residents: simulation.residents.map((resident) => ({
      id: resident.id,
      x: resident.x,
      y: resident.y,
      distance: resident.distance,
      activities: [...resident.activities].sort(),
      familiarity: [...resident.familiarity.entries()].sort(([left], [right]) => left.localeCompare(right)),
      life: resident.life,
    })),
    eventKeys: simulation.events.map((event) => event.dedupeKey),
  };
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

const uninterrupted = run(initialSimulation(), DURATION_MINUTES);
const firstLeg = run(initialSimulation(), RESTART_MINUTE);
const resumed = run(checkpoint(firstLeg), DURATION_MINUTES - RESTART_MINUTE);
const uninterruptedDigest = digest(canonicalState(uninterrupted));
const resumedDigest = digest(canonicalState(resumed));

const eventCounts = Object.fromEntries(
  [...new Set(uninterrupted.events.map((event) => event.eventType))]
    .sort()
    .map((type) => [type, uninterrupted.events.filter((event) => event.eventType === type).length]),
);
const encounters = uninterrupted.events.filter((event) => event.eventType === 'social_encounter');
const humanEncounters = encounters.filter((event) => event.targetId?.startsWith('10000000'));
const roles = [...new Set(uninterrupted.residents.map((resident) => resident.life.role))].sort();
const activities = [...new Set(uninterrupted.residents.flatMap((resident) => [...resident.activities]))].sort();
const weatherStates = [...new Set(uninterrupted.samples.map((sample) => sample.weather))].sort();
const shelterDuringRisk = uninterrupted.samples.flatMap((sample) => (
  sample.weather === 'storm' || sample.weather === 'cold_snap' || sample.weather === 'heat_haze'
    ? sample.residents.filter((resident) => resident.activity === 'shelter')
    : []
)).length;
const environmentalRange = (key) => {
  const values = uninterrupted.samples.map((sample) => sample.environment[key]);
  return { minimum: Math.min(...values), maximum: Math.max(...values), final: values.at(-1) };
};

const report = {
  configuration: {
    worldSeed: WORLD_SEED,
    residents: RESIDENT_COUNT,
    humanPresenceTraces: 2,
    startWorldMinute: START_MINUTE,
    durationWorldMinutes: DURATION_MINUTES,
    restartBoundaryWorldMinutes: RESTART_MINUTE,
    externalModelCalls: 0,
  },
  restartEquivalence: {
    uninterruptedDigest,
    resumedDigest,
    exact: uninterruptedDigest === resumedDigest,
  },
  coverage: {
    roles,
    activities,
    weatherStates,
    eventCounts,
    uniqueEncounterPairs: new Set(encounters.map((event) => `${event.npcId}:${event.targetId}`)).size,
    humanEncounters: humanEncounters.length,
    shelterSamplesDuringEnvironmentalRisk: shelterDuringRisk,
    environmentalConsequences: {
      surfaceWetness: environmentalRange('surfaceWetness'),
      waterTurbulence: environmentalRange('waterTurbulence'),
      vegetationVitality: environmentalRange('vegetationVitality'),
      decayPressure: environmentalRange('decayPressure'),
    },
  },
  residents: uninterrupted.residents.map((resident) => ({
    id: resident.id,
    role: resident.life.role,
    finalActivity: resident.life.currentActivity,
    activitiesObserved: [...resident.activities].sort(),
    distanceTravelled: resident.distance,
    finalPosition: { x: resident.x, y: resident.y },
    finalNeeds: resident.life.needs,
    encounterEvents: encounters.filter((event) => event.npcId === resident.id).length,
    persistentRelationships: resident.familiarity.size,
    strongestFamiliarity: Math.max(0, ...resident.familiarity.values()),
  })),
};

if (!report.restartEquivalence.exact) {
  throw new Error('Split-run living simulation diverged from uninterrupted result');
}
if (roles.length !== 6 || activities.length < 6 || weatherStates.length < 3) {
  throw new Error('Living-world observation did not exercise the expected state space');
}
if (report.coverage.environmentalConsequences.surfaceWetness.maximum < 0.5 ||
    report.coverage.environmentalConsequences.waterTurbulence.maximum < 0.35) {
  throw new Error('Weather did not leave a measurable persistent environmental consequence');
}

fs.writeFileSync(path.join(OUTPUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(
  path.join(OUTPUT, 'final-state.json'),
  `${JSON.stringify(canonicalState(uninterrupted), null, 2)}\n`,
);
fs.writeFileSync(
  path.join(OUTPUT, 'events.jsonl'),
  `${uninterrupted.events.map((event) => JSON.stringify(event)).join('\n')}\n`,
);

const palette = {
  sleep: '#29243f',
  eat: '#c78946',
  work: '#8d4c61',
  socialize: '#ce6687',
  explore: '#6c9b83',
  shelter: '#53687d',
  rest: '#726a86',
};
const width = 1500;
const left = 160;
const top = 90;
const plotWidth = width - left - 45;
const rowHeight = 28;
const height = top + RESIDENT_COUNT * rowHeight + 105;
const xFor = (worldMinute) => left + ((worldMinute - START_MINUTE) / DURATION_MINUTES) * plotWidth;
const rows = uninterrupted.residents.map((resident, index) => {
  const samples = uninterrupted.samples.map((sample) => (
    sample.residents.find((candidate) => candidate.id === resident.id)
  ));
  const cells = samples.map((sample, sampleIndex) => {
    const x = left + (sampleIndex / samples.length) * plotWidth;
    const cellWidth = plotWidth / samples.length + 0.5;
    return `<rect x="${x.toFixed(2)}" y="${top + index * rowHeight}" width="${cellWidth.toFixed(2)}" height="20" fill="${palette[sample.activity]}"/>`;
  }).join('');
  return `<text x="22" y="${top + index * rowHeight + 15}" fill="#d8cddd" font-size="13" font-family="monospace">${String(index + 1).padStart(2, '0')} ${resident.life.role}</text>${cells}`;
}).join('');
const weather = uninterrupted.samples.map((sample, index) => {
  const x = left + (index / uninterrupted.samples.length) * plotWidth;
  const cellWidth = plotWidth / uninterrupted.samples.length + 0.5;
  const color = sample.weather === 'storm' ? '#657992'
    : sample.weather === 'rain' ? '#526c83'
      : sample.weather === 'mist' ? '#a3a4ad'
        : sample.weather === 'cold_snap' ? '#9bb6c7'
          : sample.weather === 'heat_haze' ? '#b97958'
            : '#332e47';
  return `<rect x="${x.toFixed(2)}" y="42" width="${cellWidth.toFixed(2)}" height="20" fill="${color}"/>`;
}).join('');
const ticks = Array.from({ length: 7 }, (_, index) => {
  const minute = START_MINUTE + index * 240;
  const label = `${String(Math.floor((minute % 1440) / 60)).padStart(2, '0')}:00`;
  const x = xFor(minute);
  return `<line x1="${x}" x2="${x}" y1="64" y2="${height - 65}" stroke="#493d55" stroke-width="1"/><text x="${x - 18}" y="${height - 42}" fill="#9f91a7" font-size="12" font-family="monospace">${label}</text>`;
}).join('');
const legend = Object.entries(palette).map(([activity, color], index) => (
  `<rect x="${left + index * 150}" y="${height - 25}" width="14" height="14" fill="${color}"/><text x="${left + index * 150 + 20}" y="${height - 13}" fill="#cdbfd2" font-size="12" font-family="monospace">${activity}</text>`
)).join('');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#0c0912"/>
<text x="22" y="28" fill="#f0d8e6" font-size="20" font-family="monospace">MALDOROR / 24-HOUR LIVING-WORLD OBSERVATION</text>
<text x="22" y="55" fill="#9f91a7" font-size="12" font-family="monospace">18 residents · 2 human traces · exact restart ${report.restartEquivalence.exact} · ${encounters.length} encounters</text>
${weather}${ticks}${rows}${legend}</svg>`;
fs.writeFileSync(path.join(OUTPUT, 'timeline.svg'), svg);
await sharp(Buffer.from(svg)).png().toFile(path.join(OUTPUT, 'timeline.png'));

const findings = `# Deterministic living-world observation v1

## Result

- Simulated ${DURATION_MINUTES} world minutes for ${RESIDENT_COUNT} persistent residents plus two human-presence traces.
- Exact split-run/restart equivalence: **${report.restartEquivalence.exact}** (${uninterruptedDigest}).
- Role coverage: ${roles.join(', ')}.
- Activity coverage: ${activities.join(', ')}.
- Weather observed: ${weatherStates.join(', ')}.
- Append-only facts: ${uninterrupted.events.length}; social encounters: ${encounters.length}; human encounters: ${humanEncounters.length}.
- Environmental risk produced ${shelterDuringRisk} sampled shelter responses.
- Surface wetness ranged ${report.coverage.environmentalConsequences.surfaceWetness.minimum.toFixed(3)}–${report.coverage.environmentalConsequences.surfaceWetness.maximum.toFixed(3)} and water disturbance ${report.coverage.environmentalConsequences.waterTurbulence.minimum.toFixed(3)}–${report.coverage.environmentalConsequences.waterTurbulence.maximum.toFixed(3)}; neither snaps back when precipitation stops.
- External model/API calls: **0**.
- The companion interleaved 160x46 bounded profile is in \`atmosphere-performance.json\`; it rotates scenario order every frame so JIT, GC, and scheduler noise are not assigned systematically to one weather state.

## Research translated into the implementation

- **Fixed canonical steps, not render-time deltas.** Glenn Fiedler's fixed-timestep work makes exact replay an explicit engineering property. Maldoror advances one integer world-minute and proves uninterrupted/split-run digest equality: https://gafferongames.com/post/fix_your_timestep/
- **Cyclic daily structure plus reactive rescheduling.** AIIDE's cyclic-scheduling work evaluates generated daily schedules as a route to believable, complete character behavior. Maldoror generates a gapless individual day, then lets typed needs and weather override it: https://ojs.aaai.org/index.php/AIIDE/article/view/12709
- **Continuous utility, not brittle name/keyword scripts.** The Game AI Pro utility architecture scores normalized considerations and selects the best action. Maldoror scores schedule, need pressure, exposure, weather, role, and activity inertia: https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf
- **Observation, memory, relationships, and planning are separate load-bearing systems.** The Generative Agents ablation found observation, planning, and reflection each mattered; the Humanoid Agents extension adds basic needs and relationship closeness. Maldoror keeps cheap embodied utility always on, emits append-only observations, persists directed familiarity, and reserves optional language cognition for a separate non-metered-safe layer: https://arxiv.org/abs/2304.03442 and https://arxiv.org/abs/2310.05418
- **One atmosphere affects the entire scene.** Bruneton and Neyret identify sky colour as an hour cue and aerial perspective as a distance cue. The terminal renderer therefore grades terrain, buildings, and inhabitants together rather than tinting isolated assets: https://onlinelibrary.wiley.com/doi/pdf/10.1111/j.1467-8659.2008.01245.x
- **Rain is a coupled appearance system, not falling lines.** Tatarchuk and Isidoro combine rainfall with wet materials, ripples, splashes, glow, and reflections. Maldoror keeps the affordable terminal subset: persistent wetness, surface darkening/specular response, water disturbance, rain streaks, and wet light bounce: https://diglib.eg.org/items/b4d11d22-3e3d-4ac5-b33c-6b091143add1
- **Wet materials darken and become more specular for different physical reasons.** Jensen, Legakis, and Dorsey separate absorbed-water darkening from the smoother reflective surface layer. The ANSI pass preserves that distinction as broad darkening plus sparse world-anchored glints instead of a uniform blue overlay: https://diglib.eg.org/items/67f592b4-f58f-4893-8f63-2cbd81534558
- **Phenology responds to integrated climate controls.** Stöckli et al. model seasonal plant state through time-integrated temperature, light, and moisture controls. Maldoror likewise evolves vitality and decay slowly from season and retained moisture rather than swapping four static palettes at calendar boundaries: https://agupubs.onlinelibrary.wiley.com/doi/10.1029/2010JG001545

## Scope boundary

This is an accelerated engineering observation, not Gate C. Gate C still requires an uninterrupted physical 60-minute multi-client session against the migrated deployed runtime.
`;
fs.writeFileSync(path.join(OUTPUT, 'FINDINGS.md'), findings);

console.log(JSON.stringify({ output: OUTPUT, ...report }, null, 2));
