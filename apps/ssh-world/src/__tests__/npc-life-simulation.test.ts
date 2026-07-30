import { describe, expect, it } from 'vitest';
import type { NPCLifeState, WorldLifeState } from '@maldoror/protocol';
import {
  advanceNPCLifeMinute,
  advanceWorldLifeMinute,
  bindNPCLifeWorkplace,
  createInitialNPCLifeState,
  createInitialWorldLifeState,
  type LifePosition,
} from '../game/npc-life-simulation.js';

const WORLD_SEED = 'maldoror-living-world-proof';

function resident(id: string, x: number, y: number): LifePosition {
  return { id, x, y, kind: 'npc' };
}

function advance(
  world: WorldLifeState,
  life: NPCLifeState,
  position: LifePosition,
  people: LifePosition[],
  minutes: number,
): { world: WorldLifeState; life: NPCLifeState; eventKeys: string[] } {
  const eventKeys: string[] = [];
  for (let index = 0; index < minutes; index++) {
    const worldResult = advanceWorldLifeMinute(world);
    world = worldResult.state;
    const lifeResult = advanceNPCLifeMinute(life, world, position, people);
    life = lifeResult.state;
    eventKeys.push(...worldResult.events.map((event) => event.dedupeKey));
    eventKeys.push(...lifeResult.events.map((event) => event.dedupeKey));
  }
  return { world, life, eventKeys };
}

describe('deterministic NPC life simulation', () => {
  it('creates diverse, gapless schedules whose destinations stay inside the roam area', () => {
    const residents = Array.from({ length: 24 }, (_, index) => createInitialNPCLifeState({
      npcId: `resident-${index}`,
      homeX: 100,
      homeY: -40,
      roamRadius: 18,
      worldMinute: 480,
      worldSeed: WORLD_SEED,
    }));

    expect(new Set(residents.map((life) => life.role)).size).toBeGreaterThanOrEqual(5);
    expect(new Set(residents.map((life) => life.schedule[0]!.endMinute)).size).toBeGreaterThan(10);

    for (const life of residents) {
      expect(life.schedule[0]!.startMinute).toBe(0);
      expect(life.schedule.at(-1)!.endMinute).toBe(1440);
      for (let index = 1; index < life.schedule.length; index++) {
        expect(life.schedule[index]!.startMinute).toBe(life.schedule[index - 1]!.endMinute);
      }
      for (const entry of life.schedule) {
        expect(Math.hypot(entry.destinationX - life.homeX, entry.destinationY - life.homeY))
          .toBeLessThanOrEqual(18.5);
      }
    }
  });

  it('binds work to one reachable authored place independent of input order', () => {
    const initial = createInitialNPCLifeState({
      npcId: 'place-bound-resident',
      homeX: 0,
      homeY: 0,
      roamRadius: 15,
      worldMinute: 480,
      worldSeed: WORLD_SEED,
    });
    initial.currentActivity = 'work';
    const workplaces = [
      { id: 'quay:market@8,0', x: 8, y: 0 },
      { id: 'quay:workshop@0,9', x: 0, y: 9 },
      { id: 'quay:outside@20,0', x: 20, y: 0 },
    ];

    const forward = bindNPCLifeWorkplace(
      initial,
      workplaces,
      WORLD_SEED,
      15,
      480,
    );
    const reversed = bindNPCLifeWorkplace(
      initial,
      [...workplaces].reverse(),
      WORLD_SEED,
      15,
      480,
    );

    expect(reversed).toEqual(forward);
    expect(forward.state.stateVersion).toBe(3);
    const work = forward.state.schedule.filter((entry) => entry.activity === 'work');
    expect(work).toHaveLength(2);
    expect(new Set(work.map((entry) => `${entry.destinationX},${entry.destinationY}`)).size).toBe(1);
    expect(Math.hypot(work[0]!.destinationX, work[0]!.destinationY)).toBeLessThanOrEqual(15);
    expect([forward.state.destinationX, forward.state.destinationY])
      .toEqual([work[0]!.destinationX, work[0]!.destinationY]);
    expect(forward.event).toEqual(expect.objectContaining({
      eventType: 'workplace_bound',
      worldMinute: 480,
      consequence: expect.objectContaining({
        destination: { x: work[0]!.destinationX, y: work[0]!.destinationY },
        workPeriods: 2,
      }),
    }));

    const replay = bindNPCLifeWorkplace(forward.state, workplaces, WORLD_SEED, 15, 480);
    expect(replay.state).toBe(forward.state);
    expect(replay.event).toBeNull();
  });

  it('preserves the deterministic personal schedule when no authored workplace is reachable', () => {
    const initial = createInitialNPCLifeState({
      npcId: 'remote-resident',
      homeX: -12,
      homeY: -16,
      roamRadius: 15,
      worldMinute: 480,
      worldSeed: WORLD_SEED,
    });
    const result = bindNPCLifeWorkplace(
      initial,
      [{ id: 'distant-quay', x: 8, y: 8 }],
      WORLD_SEED,
      15,
      480,
    );

    expect(result.state).toBe(initial);
    expect(result.event).toBeNull();
  });

  it('lets urgent embodied needs override a routine without keyword or name rules', () => {
    const world = createInitialWorldLifeState(WORLD_SEED, 600);
    const initial = createInitialNPCLifeState({
      npcId: 'hungry-resident',
      homeX: 0,
      homeY: 0,
      roamRadius: 15,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    initial.currentActivity = 'work';
    initial.needs = {
      rest: 0.2,
      nourishment: 0.98,
      social: 0.2,
      purpose: 0.3,
      curiosity: 0.2,
      safety: 0.1,
    };

    const nextWorld = advanceWorldLifeMinute(world).state;
    const result = advanceNPCLifeMinute(initial, nextWorld, resident(initial.npcId, 8, 8), []);

    expect(result.state.currentActivity).toBe('eat');
    expect(result.state.destinationX).toBe(initial.homeX);
    expect(result.state.destinationY).toBe(initial.homeY);
    expect(result.events).toContainEqual(expect.objectContaining({ eventType: 'activity_changed' }));
  });

  it('makes dangerous weather pull exposed residents toward shelter', () => {
    const world: WorldLifeState = {
      ...createInitialWorldLifeState(WORLD_SEED, 800),
      weather: 'storm',
      weatherIntensity: 0.95,
      weatherUntilWorldMinute: 1000,
    };
    const life = createInitialNPCLifeState({
      npcId: 'exposed-resident',
      homeX: 3,
      homeY: 4,
      roamRadius: 20,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    life.currentActivity = 'explore';
    life.needs = { rest: 0.2, nourishment: 0.2, social: 0.2, purpose: 0.2, curiosity: 0.4, safety: 0.74 };

    const nextWorld = advanceWorldLifeMinute(world).state;
    const result = advanceNPCLifeMinute(life, nextWorld, resident(life.npcId, 17, 17), []);

    expect(result.state.currentActivity).toBe('shelter');
    expect([result.state.destinationX, result.state.destinationY]).toEqual([3, 4]);
  });

  it('retains rain as wet surfaces and disturbed water after the weather itself changes', () => {
    let world: WorldLifeState = {
      ...createInitialWorldLifeState(WORLD_SEED, 800),
      weather: 'storm',
      weatherIntensity: 0.9,
      weatherUntilWorldMinute: 2000,
    };
    for (let minute = 0; minute < 90; minute++) world = advanceWorldLifeMinute(world).state;
    const saturated = world.surfaceWetness;
    const disturbed = world.waterTurbulence;

    world = {
      ...world,
      weather: 'clear',
      weatherIntensity: 0.2,
      weatherUntilWorldMinute: 3000,
    };
    world = advanceWorldLifeMinute(world).state;

    expect(saturated).toBeGreaterThan(0.65);
    expect(disturbed).toBeGreaterThan(0.7);
    expect(world.surfaceWetness).toBeLessThan(saturated);
    expect(world.surfaceWetness).toBeGreaterThan(0.6);
    expect(world.waterTurbulence).toBeGreaterThan(0.65);
  });

  it('records a season boundary while vegetation and decay respond gradually', () => {
    const boundary = 30 * 1440;
    const world: WorldLifeState = {
      ...createInitialWorldLifeState(WORLD_SEED, boundary - 1),
      season: 'spring',
      weatherUntilWorldMinute: boundary + 500,
    };
    const result = advanceWorldLifeMinute(world);

    expect(result.state.season).toBe('summer');
    expect(result.state.vegetationVitality).not.toBe(world.vegetationVitality);
    expect(result.state.decayPressure).not.toBe(world.decayPressure);
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: 'season_changed',
      worldMinute: boundary,
      cause: expect.objectContaining({ previousSeason: 'spring' }),
      consequence: expect.objectContaining({ season: 'summer' }),
    }));
  });

  it('records a social encounter once per cooldown and changes the persistent need state', () => {
    const world = createInitialWorldLifeState(WORLD_SEED, 1030);
    const person = resident('neighbour', 11, 10);
    const self = resident('social-resident', 10, 10);
    const life = createInitialNPCLifeState({
      npcId: self.id,
      homeX: 10,
      homeY: 10,
      roamRadius: 15,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    life.currentActivity = 'socialize';
    life.needs.social = 0.94;

    const firstWorld = advanceWorldLifeMinute(world).state;
    const first = advanceNPCLifeMinute(life, firstWorld, self, [self, person]);
    expect(first.events).toContainEqual(expect.objectContaining({
      eventType: 'social_encounter',
      npcId: self.id,
      targetId: person.id,
    }));
    expect(first.state.needs.social).toBeLessThan(0.8);

    const secondWorld = advanceWorldLifeMinute(firstWorld).state;
    const second = advanceNPCLifeMinute(first.state, secondWorld, self, [self, person]);
    expect(second.events.filter((event) => event.eventType === 'social_encounter')).toHaveLength(0);
  });

  it('lets persisted familiarity shape who an inhabitant seeks out', () => {
    const world = createInitialWorldLifeState(WORLD_SEED, 1030);
    const self = resident('relationship-resident', 0, 0);
    const life = createInitialNPCLifeState({
      npcId: self.id,
      homeX: 0,
      homeY: 0,
      roamRadius: 15,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    life.currentActivity = 'socialize';
    life.activityStartedWorldMinute = 1000;
    life.needs.social = 0.88;

    const nextWorld = advanceWorldLifeMinute(world).state;
    const result = advanceNPCLifeMinute(life, nextWorld, self, [
      self,
      { ...resident('near-stranger', 1, 0), familiarity: 0 },
      { ...resident('known-neighbour', 5, 0), familiarity: 1 },
    ]);

    expect(result.state.currentActivity).toBe('socialize');
    expect([result.state.destinationX, result.state.destinationY]).toEqual([5, 0]);
  });

  it('uses positive player disposition as a continuous social attraction signal', () => {
    const world = createInitialWorldLifeState(WORLD_SEED, 1030);
    const self = resident('welcoming-resident', 0, 0);
    const life = createInitialNPCLifeState({
      npcId: self.id,
      homeX: 0,
      homeY: 0,
      roamRadius: 15,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    life.currentActivity = 'socialize';
    life.activityStartedWorldMinute = 1000;
    life.needs.social = 0.88;

    const nextWorld = advanceWorldLifeMinute(world).state;
    const result = advanceNPCLifeMinute(life, nextWorld, self, [
      self,
      { ...resident('neutral-neighbour', 2, 0), familiarity: 0 },
      { id: 'welcome-player', x: 6, y: 0, kind: 'player', disposition: 1 },
    ]);

    expect([result.state.destinationX, result.state.destinationY]).toEqual([6, 0]);
  });

  it('turns negative player disposition into proximity-scaled retreat movement', () => {
    const world = createInitialWorldLifeState(WORLD_SEED, 700);
    const self: LifePosition = {
      ...resident('wary-resident', 0, 0),
      detectionRadius: 10,
    };
    const life = createInitialNPCLifeState({
      npcId: self.id,
      homeX: 0,
      homeY: 0,
      roamRadius: 15,
      worldMinute: world.worldMinute,
      worldSeed: WORLD_SEED,
    });
    life.currentActivity = 'work';
    life.activityStartedWorldMinute = 650;

    const nextWorld = advanceWorldLifeMinute(world).state;
    const result = advanceNPCLifeMinute(life, nextWorld, self, [
      self,
      { id: 'unwelcome-player', x: 1, y: 0, kind: 'player', disposition: -1 },
    ]);

    expect(result.state.currentActivity).toBe('shelter');
    expect(result.state.destinationX).toBeLessThan(self.x);
    expect(result.state.destinationY).toBe(self.y);
    expect(result.events).toContainEqual(expect.objectContaining({
      eventType: 'activity_changed',
      cause: expect.objectContaining({ interpersonalDanger: 0.9 }),
    }));
  });

  it('is bit-for-bit identical across a persisted restart boundary', () => {
    const initialWorld = createInitialWorldLifeState(WORLD_SEED, 470);
    const position = resident('restart-resident', -7, 12);
    const neighbour = resident('restart-neighbour', -6, 12);
    const initialLife = createInitialNPCLifeState({
      npcId: position.id,
      homeX: -7,
      homeY: 12,
      roamRadius: 17,
      worldMinute: initialWorld.worldMinute,
      worldSeed: WORLD_SEED,
    });

    const uninterrupted = advance(initialWorld, initialLife, position, [position, neighbour], 360);
    const firstLeg = advance(initialWorld, initialLife, position, [position, neighbour], 137);
    const resumed = advance(firstLeg.world, firstLeg.life, position, [position, neighbour], 223);

    expect(resumed.world).toEqual(uninterrupted.world);
    expect(resumed.life).toEqual(uninterrupted.life);
    expect([...firstLeg.eventKeys, ...resumed.eventKeys]).toEqual(uninterrupted.eventKeys);
  });
});
