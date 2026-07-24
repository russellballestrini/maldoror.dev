import type {
  NPCLifeActivity,
  NPCLifeEvent,
  NPCLifeNeeds,
  NPCLifeRole,
  NPCLifeScheduleEntry,
  NPCLifeState,
  WorldLifeState,
  WorldSeason,
  WorldWeatherKind,
} from '@maldoror/protocol';

export interface LifePosition {
  id: string;
  x: number;
  y: number;
  kind: 'npc' | 'player';
  familiarity?: number;
  /** Observer-specific social valence: -1 avoids, 0 neutral, 1 seeks. */
  disposition?: number;
  /** Observer-specific range for perceiving interpersonal danger. */
  detectionRadius?: number;
}

export interface NPCLifeMinuteResult {
  state: NPCLifeState;
  events: NPCLifeEvent[];
}

export interface WorldLifeMinuteResult {
  state: WorldLifeState;
  events: NPCLifeEvent[];
}

const DAY_MINUTES = 24 * 60;
const ENCOUNTER_RADIUS = 3;
const ENCOUNTER_COOLDOWN_MINUTES = 30;
const LIFE_STATE_VERSION = 2;

const ROLES: readonly NPCLifeRole[] = [
  'steward',
  'maker',
  'forager',
  'trader',
  'watcher',
  'scholar',
];

const ACTIVITY_TIE_BREAK: readonly NPCLifeActivity[] = [
  'shelter',
  'sleep',
  'eat',
  'rest',
  'socialize',
  'work',
  'explore',
];

/** Stable FNV-1a mixer. All simulation variation is derived from persisted facts. */
export function stableLifeHash(...parts: Array<string | number>): number {
  let hash = 2166136261;
  const source = parts.join('\u001f');
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createInitialWorldLifeState(
  worldSeed: string,
  worldMinute = 8 * 60,
  worldId = 'primary',
): WorldLifeState {
  const normalizedMinute = Math.max(0, Math.floor(worldMinute));
  return {
    worldId,
    worldSeed,
    worldMinute: normalizedMinute,
    weather: 'clear',
    weatherIntensity: 0.12,
    weatherUntilWorldMinute: normalizedMinute + 90,
    season: seasonForMinute(normalizedMinute),
    rngState: stableLifeHash(worldSeed, worldId, 'weather') || 0x6d2b79f5,
  };
}

export function createInitialNPCLifeState(input: {
  npcId: string;
  homeX: number;
  homeY: number;
  roamRadius: number;
  worldMinute: number;
  worldSeed: string;
}): NPCLifeState {
  const role = ROLES[stableLifeHash(input.worldSeed, input.npcId, 'role') % ROLES.length]!;
  const schedule = createDailySchedule(input);
  const minuteOfDay = positiveModulo(input.worldMinute, DAY_MINUTES);
  const planned = plannedScheduleEntry(schedule, minuteOfDay);
  const needUnit = (label: string): number => (
    0.24 + hashUnit(input.worldSeed, input.npcId, label) * 0.32
  );

  return {
    npcId: input.npcId,
    homeX: input.homeX,
    homeY: input.homeY,
    role,
    schedule,
    needs: {
      rest: needUnit('rest'),
      nourishment: needUnit('nourishment'),
      social: needUnit('social'),
      purpose: needUnit('purpose'),
      curiosity: needUnit('curiosity'),
      safety: 0.08 + hashUnit(input.worldSeed, input.npcId, 'safety') * 0.12,
    },
    currentActivity: planned.activity,
    activityStartedWorldMinute: Math.max(0, Math.floor(input.worldMinute)),
    destinationX: planned.destinationX,
    destinationY: planned.destinationY,
    lastWorldMinute: Math.max(0, Math.floor(input.worldMinute)),
    lastEncounterWorldMinute: null,
    lastSocialTargetId: null,
    stateVersion: LIFE_STATE_VERSION,
  };
}

export function createDailySchedule(input: {
  npcId: string;
  homeX: number;
  homeY: number;
  roamRadius: number;
  worldSeed: string;
}): NPCLifeScheduleEntry[] {
  const jitter = stableLifeHash(input.worldSeed, input.npcId, 'chronotype') % 91;
  const wake = 315 + jitter;
  const morningEnd = 700 + (jitter >> 2);
  const afternoonStart = morningEnd + 55;
  const afternoonEnd = 990 + (jitter >> 3);
  const socialEnd = afternoonEnd + 100;
  const exploreEnd = socialEnd + 95;
  const sleepStart = Math.min(1350, exploreEnd + 125);
  const work = personalAnchor(input, 'work', 0.48, 0.78);
  const explore = personalAnchor(input, 'explore', 0.62, 0.9);
  const social = neighborhoodAnchor(input);

  return [
    entry(0, wake, 'sleep', input.homeX, input.homeY),
    entry(wake, wake + 45, 'eat', input.homeX, input.homeY),
    entry(wake + 45, morningEnd, 'work', work.x, work.y),
    entry(morningEnd, afternoonStart, 'eat', input.homeX, input.homeY),
    entry(afternoonStart, afternoonEnd, 'work', work.x, work.y),
    entry(afternoonEnd, socialEnd, 'socialize', social.x, social.y),
    entry(socialEnd, exploreEnd, 'explore', explore.x, explore.y),
    entry(exploreEnd, sleepStart, 'rest', input.homeX, input.homeY),
    entry(sleepStart, DAY_MINUTES, 'sleep', input.homeX, input.homeY),
  ];
}

/** Advance exactly one canonical minute. Replaying from a checkpoint is exact. */
export function advanceWorldLifeMinute(world: WorldLifeState): WorldLifeMinuteResult {
  const next: WorldLifeState = {
    ...world,
    worldMinute: world.worldMinute + 1,
    season: seasonForMinute(world.worldMinute + 1),
  };
  const events: NPCLifeEvent[] = [];

  if (next.worldMinute >= world.weatherUntilWorldMinute) {
    const previousWeather = world.weather;
    const first = nextXorshift(world.rngState);
    const second = nextXorshift(first);
    const third = nextXorshift(second);
    next.rngState = third;
    next.weather = chooseWeather(first / 0x100000000, next.season);
    next.weatherIntensity = round6(0.2 + (second / 0x100000000) * 0.78);
    next.weatherUntilWorldMinute = next.worldMinute + 75 + (third % 166);
    events.push({
      dedupeKey: `weather:${next.worldId}:${next.worldMinute}`,
      eventType: 'weather_changed',
      worldMinute: next.worldMinute,
      npcId: null,
      targetId: null,
      x: null,
      y: null,
      cause: { previousWeather, season: next.season },
      consequence: {
        weather: next.weather,
        intensity: next.weatherIntensity,
        untilWorldMinute: next.weatherUntilWorldMinute,
      },
    });
  }

  return { state: next, events };
}

/**
 * Advance one inhabitant by one world minute. The utility model observes the
 * same immutable position snapshot for every NPC, so iteration order cannot
 * change decisions or relationship facts.
 */
export function advanceNPCLifeMinute(
  previous: NPCLifeState,
  world: WorldLifeState,
  position: LifePosition,
  people: readonly LifePosition[],
): NPCLifeMinuteResult {
  if (world.worldMinute <= previous.lastWorldMinute) {
    return { state: previous, events: [] };
  }

  let state = previous;
  const events: NPCLifeEvent[] = [];
  for (let minute = previous.lastWorldMinute + 1; minute <= world.worldMinute; minute++) {
    const minuteWorld = minute === world.worldMinute
      ? world
      : { ...world, worldMinute: minute, season: seasonForMinute(minute) };
    const result = advanceOneNPCMinute(state, minuteWorld, position, people);
    state = result.state;
    events.push(...result.events);
  }

  return { state, events };
}

export function primaryNPCNeed(needs: NPCLifeNeeds): keyof NPCLifeNeeds {
  let primary: keyof NPCLifeNeeds = 'rest';
  for (const key of Object.keys(needs) as Array<keyof NPCLifeNeeds>) {
    if (needs[key] > needs[primary]) primary = key;
  }
  return primary;
}

function advanceOneNPCMinute(
  previous: NPCLifeState,
  world: WorldLifeState,
  position: LifePosition,
  people: readonly LifePosition[],
): NPCLifeMinuteResult {
  const previousNeeds = previous.needs;
  const outdoors = chebyshev(position.x, position.y, previous.homeX, previous.homeY) > 2;
  const weatherRisk = weatherDanger(world.weather, world.weatherIntensity);
  const threat = threateningPerson(position, people);
  const needs = updateNeeds(
    previousNeeds,
    previous.currentActivity,
    outdoors,
    weatherRisk,
    threat?.danger ?? 0,
  );
  const planned = plannedScheduleEntry(previous.schedule, positiveModulo(world.worldMinute, DAY_MINUTES));
  const nearest = preferredPerson(position, people, previous.lastSocialTargetId);
  const activity = chooseActivity(
    needs,
    planned.activity,
    world,
    position,
    previous,
    threat?.danger ?? 0,
  );
  const destination = destinationForActivity(activity, planned, previous, position, nearest, threat);
  const state: NPCLifeState = {
    ...previous,
    needs,
    currentActivity: activity,
    activityStartedWorldMinute: activity === previous.currentActivity
      ? previous.activityStartedWorldMinute
      : world.worldMinute,
    destinationX: destination.x,
    destinationY: destination.y,
    lastWorldMinute: world.worldMinute,
    stateVersion: LIFE_STATE_VERSION,
  };
  const events: NPCLifeEvent[] = [];

  if (activity !== previous.currentActivity) {
    events.push({
      dedupeKey: `activity:${previous.npcId}:${world.worldMinute}:${activity}`,
      eventType: 'activity_changed',
      worldMinute: world.worldMinute,
      npcId: previous.npcId,
      targetId: null,
      x: position.x,
      y: position.y,
      cause: {
        planned: planned.activity,
        primaryNeed: primaryNPCNeed(needs),
        weather: world.weather,
        interpersonalDanger: threat?.danger ?? 0,
      },
      consequence: { from: previous.currentActivity, to: activity, destination },
    });
  }

  for (const key of Object.keys(needs) as Array<keyof NPCLifeNeeds>) {
    if (previousNeeds[key] < 0.82 && needs[key] >= 0.82) {
      events.push({
        dedupeKey: `urgent:${previous.npcId}:${key}:${world.worldMinute}`,
        eventType: 'need_became_urgent',
        worldMinute: world.worldMinute,
        npcId: previous.npcId,
        targetId: null,
        x: position.x,
        y: position.y,
        cause: { need: key, pressure: needs[key] },
        consequence: { selectedActivity: activity },
      });
    }
  }

  const canEncounter = previous.lastEncounterWorldMinute === null
    || world.worldMinute - previous.lastEncounterWorldMinute >= ENCOUNTER_COOLDOWN_MINUTES;
  if (activity === 'socialize' && nearest && nearest.distance <= ENCOUNTER_RADIUS && canEncounter) {
    state.lastEncounterWorldMinute = world.worldMinute;
    state.lastSocialTargetId = nearest.person.id;
    state.needs = { ...state.needs, social: clamp01(state.needs.social - 0.18) };
    events.push({
      dedupeKey: `encounter:${previous.npcId}:${nearest.person.id}:${world.worldMinute}`,
      eventType: 'social_encounter',
      worldMinute: world.worldMinute,
      npcId: previous.npcId,
      targetId: nearest.person.id,
      x: position.x,
      y: position.y,
      cause: {
        activity,
        targetKind: nearest.person.kind,
        priorSocialPressure: needs.social,
        targetDisposition: nearest.person.disposition ?? 0,
      },
      consequence: {
        socialPressure: state.needs.social,
        familiarityDelta: 0.04,
      },
    });
  }

  return { state, events };
}

function updateNeeds(
  previous: NPCLifeNeeds,
  activity: NPCLifeActivity,
  outdoors: boolean,
  weatherRisk: number,
  interpersonalDanger: number,
): NPCLifeNeeds {
  const next: NPCLifeNeeds = {
    rest: previous.rest + 0.0012,
    nourishment: previous.nourishment + 0.0016,
    social: previous.social + 0.001,
    purpose: previous.purpose + 0.0009,
    curiosity: previous.curiosity + 0.0008,
    safety: previous.safety
      + (outdoors ? weatherRisk * 0.012 : -0.0025)
      + interpersonalDanger * 0.018,
  };

  if (activity === 'sleep') next.rest -= 0.012;
  if (activity === 'eat') next.nourishment -= 0.026;
  if (activity === 'socialize') next.social -= 0.009;
  if (activity === 'work') next.purpose -= 0.006;
  if (activity === 'explore') next.curiosity -= 0.008;
  if (activity === 'shelter') next.safety -= 0.018;
  if (activity === 'rest') next.rest -= 0.007;

  for (const key of Object.keys(next) as Array<keyof NPCLifeNeeds>) {
    next[key] = round6(clamp01(next[key]));
  }
  return next;
}

function chooseActivity(
  needs: NPCLifeNeeds,
  planned: NPCLifeActivity,
  world: WorldLifeState,
  position: LifePosition,
  life: NPCLifeState,
  interpersonalDanger: number,
): NPCLifeActivity {
  const minuteOfDay = positiveModulo(world.worldMinute, DAY_MINUTES);
  const night = minuteOfDay < 330 || minuteOfDay >= 1320;
  const outdoors = chebyshev(position.x, position.y, life.homeX, life.homeY) > 2;
  const danger = weatherDanger(world.weather, world.weatherIntensity);
  if (interpersonalDanger >= 0.25) return 'shelter';
  if (outdoors && danger >= 0.5 && needs.safety >= 0.68) return 'shelter';
  if (needs.nourishment >= 0.9) return 'eat';
  if (needs.rest >= 0.94) return night ? 'sleep' : 'rest';

  const activityAge = world.worldMinute - life.activityStartedWorldMinute;
  if (activityAge < 12) return life.currentActivity;
  const scores: Record<NPCLifeActivity, number> = {
    sleep: needs.rest * 1.1 + (night ? 0.72 : 0),
    eat: needs.nourishment * 1.18,
    work: needs.purpose * 0.96,
    socialize: needs.social * 1.02,
    explore: needs.curiosity * 0.94,
    shelter: needs.safety * 1.22 + (outdoors ? danger * 0.72 : 0),
    rest: needs.rest * 0.88 + 0.08,
  };
  scores[planned] += 0.52;
  scores[life.currentActivity] += 0.16;
  applyRoleUtilityBias(life.role, scores);

  let selected = ACTIVITY_TIE_BREAK[0]!;
  for (const activity of ACTIVITY_TIE_BREAK) {
    if (scores[activity] > scores[selected]) selected = activity;
  }
  return selected;
}

function destinationForActivity(
  activity: NPCLifeActivity,
  planned: NPCLifeScheduleEntry,
  life: NPCLifeState,
  position: LifePosition,
  nearest: { person: LifePosition; distance: number } | null,
  threat: { person: LifePosition; danger: number } | null,
): { x: number; y: number } {
  if (activity === 'shelter' && threat && threat.danger >= 0.25) {
    return retreatFrom(position, threat.person);
  }
  if (activity === 'sleep' || activity === 'eat' || activity === 'rest' || activity === 'shelter') {
    return { x: life.homeX, y: life.homeY };
  }
  if (activity === 'socialize' && nearest && nearest.distance <= 8) {
    return { x: nearest.person.x, y: nearest.person.y };
  }
  if (activity === planned.activity) {
    return { x: planned.destinationX, y: planned.destinationY };
  }
  const matching = life.schedule.find((candidate) => candidate.activity === activity);
  return matching
    ? { x: matching.destinationX, y: matching.destinationY }
    : { x: life.homeX, y: life.homeY };
}

function personalAnchor(
  input: { npcId: string; homeX: number; homeY: number; roamRadius: number; worldSeed: string },
  label: string,
  minScale: number,
  maxScale: number,
): { x: number; y: number } {
  const angle = hashUnit(input.worldSeed, input.npcId, label, 'angle') * Math.PI * 2;
  const scale = minScale + hashUnit(input.worldSeed, input.npcId, label, 'radius') * (maxScale - minScale);
  const distance = Math.max(2, input.roamRadius * scale);
  return {
    x: input.homeX + Math.round(Math.cos(angle) * distance),
    y: input.homeY + Math.round(Math.sin(angle) * distance),
  };
}

function neighborhoodAnchor(input: {
  npcId: string;
  homeX: number;
  homeY: number;
  roamRadius: number;
  worldSeed: string;
}): { x: number; y: number } {
  const cellSize = Math.max(12, Math.min(32, input.roamRadius * 2));
  const cellX = Math.floor(input.homeX / cellSize);
  const cellY = Math.floor(input.homeY / cellSize);
  const sharedX = cellX * cellSize
    + Math.floor(hashUnit(input.worldSeed, cellX, cellY, 'social-x') * cellSize);
  const sharedY = cellY * cellSize
    + Math.floor(hashUnit(input.worldSeed, cellX, cellY, 'social-y') * cellSize);
  return clampToRadius(input.homeX, input.homeY, sharedX, sharedY, input.roamRadius * 0.82);
}

function plannedScheduleEntry(
  schedule: readonly NPCLifeScheduleEntry[],
  minuteOfDay: number,
): NPCLifeScheduleEntry {
  return schedule.find((candidate) => (
    minuteOfDay >= candidate.startMinute && minuteOfDay < candidate.endMinute
  )) ?? schedule[0] ?? entry(0, DAY_MINUTES, 'rest', 0, 0);
}

function preferredPerson(
  position: LifePosition,
  people: readonly LifePosition[],
  lastSocialTargetId: string | null,
): { person: LifePosition; distance: number } | null {
  let nearest: { person: LifePosition; distance: number; preference: number } | null = null;
  for (const person of people) {
    if (person.id === position.id) continue;
    const distance = Math.hypot(person.x - position.x, person.y - position.y);
    const preference = distance
      - Math.max(0, person.familiarity ?? 0) * 6
      - clampDisposition(person.disposition ?? 0) * 5
      - (person.id === lastSocialTargetId ? 1.5 : 0);
    if (
      !nearest
      || preference < nearest.preference
      || (preference === nearest.preference && person.id.localeCompare(nearest.person.id) < 0)
    ) {
      nearest = { person, distance, preference };
    }
  }
  return nearest ? { person: nearest.person, distance: nearest.distance } : null;
}

function threateningPerson(
  position: LifePosition,
  people: readonly LifePosition[],
): { person: LifePosition; danger: number } | null {
  const detectionRadius = Math.max(1, position.detectionRadius ?? 10);
  let mostDangerous: { person: LifePosition; danger: number } | null = null;
  for (const person of people) {
    if (person.id === position.id || person.kind !== 'player') continue;
    const aversion = Math.max(0, -clampDisposition(person.disposition ?? 0));
    if (aversion === 0) continue;
    const distance = Math.hypot(person.x - position.x, person.y - position.y);
    const proximity = Math.max(0, 1 - distance / detectionRadius);
    const danger = round6(aversion * proximity);
    if (
      !mostDangerous
      || danger > mostDangerous.danger
      || (danger === mostDangerous.danger && person.id.localeCompare(mostDangerous.person.id) < 0)
    ) {
      mostDangerous = { person, danger };
    }
  }
  return mostDangerous;
}

function retreatFrom(position: LifePosition, threat: LifePosition): { x: number; y: number } {
  let dx = position.x - threat.x;
  let dy = position.y - threat.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) {
    const angle = hashUnit(position.id, threat.id, 'retreat-direction') * Math.PI * 2;
    dx = Math.cos(angle);
    dy = Math.sin(angle);
  } else {
    dx /= distance;
    dy /= distance;
  }
  return {
    x: position.x + Math.round(dx * 8),
    y: position.y + Math.round(dy * 8),
  };
}

function clampDisposition(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function applyRoleUtilityBias(
  role: NPCLifeRole,
  scores: Record<NPCLifeActivity, number>,
): void {
  switch (role) {
    case 'steward':
      scores.work += 0.1;
      scores.socialize += 0.07;
      scores.shelter += 0.03;
      break;
    case 'maker':
      scores.work += 0.16;
      scores.rest += 0.03;
      break;
    case 'forager':
      scores.explore += 0.15;
      scores.work += 0.04;
      break;
    case 'trader':
      scores.socialize += 0.15;
      scores.work += 0.05;
      break;
    case 'watcher':
      scores.explore += 0.08;
      scores.shelter += 0.08;
      scores.work += 0.04;
      break;
    case 'scholar':
      scores.explore += 0.12;
      scores.work += 0.05;
      break;
  }
}

function chooseWeather(unit: number, season: WorldSeason): WorldWeatherKind {
  const coldBias = season === 'winter' ? 0.12 : 0;
  const heatBias = season === 'summer' ? 0.12 : 0;
  if (unit < 0.34 - coldBias - heatBias / 2) return 'clear';
  if (unit < 0.52 - heatBias / 2) return 'mist';
  if (unit < 0.75 - heatBias / 3) return 'rain';
  if (unit < 0.84) return 'storm';
  if (unit < 0.92 + coldBias - heatBias) return 'cold_snap';
  return 'heat_haze';
}

function weatherDanger(weather: WorldWeatherKind, intensity: number): number {
  if (weather === 'storm') return intensity;
  if (weather === 'cold_snap') return intensity * 0.72;
  if (weather === 'heat_haze') return intensity * 0.58;
  if (weather === 'rain') return intensity * 0.34;
  if (weather === 'mist') return intensity * 0.16;
  return 0;
}

function seasonForMinute(worldMinute: number): WorldSeason {
  const seasonIndex = Math.floor(worldMinute / (30 * DAY_MINUTES)) % 4;
  return (['spring', 'summer', 'autumn', 'winter'] as const)[seasonIndex]!;
}

function entry(
  startMinute: number,
  endMinute: number,
  activity: NPCLifeActivity,
  destinationX: number,
  destinationY: number,
): NPCLifeScheduleEntry {
  return { startMinute, endMinute, activity, destinationX, destinationY };
}

function clampToRadius(
  centerX: number,
  centerY: number,
  targetX: number,
  targetY: number,
  radius: number,
): { x: number; y: number } {
  const dx = targetX - centerX;
  const dy = targetY - centerY;
  const distance = Math.hypot(dx, dy);
  if (distance <= radius || distance === 0) return { x: targetX, y: targetY };
  const scale = radius / distance;
  return {
    x: centerX + Math.round(dx * scale),
    y: centerY + Math.round(dy * scale),
  };
}

function hashUnit(...parts: Array<string | number>): number {
  return stableLifeHash(...parts) / 0x100000000;
}

function nextXorshift(value: number): number {
  let state = value >>> 0;
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return (state >>> 0) || 0x6d2b79f5;
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
