import { describe, expect, it } from 'vitest';
import type { WorldLifeState } from '@maldoror/protocol';
import {
  TERMINAL_ATMOSPHERE_STEP_MINUTES,
  TerminalWorldLifeProjector,
} from '../game/terminal-world-life-projector.js';

function state(worldMinute: number, weather: WorldLifeState['weather'] = 'clear'): WorldLifeState {
  return {
    worldId: 'projection-proof',
    worldSeed: '42',
    worldMinute,
    weather,
    weatherIntensity: weather === 'clear' ? 0.1 : 0.8,
    weatherUntilWorldMinute: worldMinute + 100,
    season: 'spring',
    rngState: 1,
    surfaceWetness: 0.2,
    waterTurbulence: 0.1,
    vegetationVitality: 0.7,
    decayPressure: 0.1,
  };
}

describe('TerminalWorldLifeProjector', () => {
  it('holds one coherent global grade inside a terminal atmosphere step', () => {
    const projector = new TerminalWorldLifeProjector();
    const first = projector.project(state(481));
    const changedSimulation = state(499);
    changedSimulation.surfaceWetness = 0.9;
    const second = projector.project(changedSimulation);

    expect(first.state.worldMinute).toBe(480);
    expect(second).toEqual(first);
    expect(TERMINAL_ATMOSPHERE_STEP_MINUTES).toBe(30);

    const next = projector.project(state(510));
    expect(next.state.worldMinute).toBe(510);
    expect(next.animationEpoch).not.toBe(first.animationEpoch);
  });

  it('applies weather transitions immediately without advancing the global light', () => {
    const projector = new TerminalWorldLifeProjector();
    const clear = projector.project(state(481));
    const rain = projector.project(state(482, 'rain'));

    expect(clear.state.worldMinute).toBe(rain.state.worldMinute);
    expect(rain.state.weather).toBe('rain');
    expect(rain.state.weatherIntensity).toBe(0.8);
  });

  it('advances only the animation epoch during rain inside one grade step', () => {
    const projector = new TerminalWorldLifeProjector();
    const first = projector.project(state(481, 'storm'));
    const next = projector.project(state(482, 'storm'));

    expect(next.state).toEqual(first.state);
    expect(next.animationEpoch).toBe(first.animationEpoch + 1);
  });
});
