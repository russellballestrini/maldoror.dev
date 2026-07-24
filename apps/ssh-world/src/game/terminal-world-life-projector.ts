import type { WorldLifeState } from '@maldoror/protocol';

export const TERMINAL_ATMOSPHERE_STEP_MINUTES = 30;

export interface TerminalWorldLifeProjection {
  state: WorldLifeState;
  animationEpoch: number;
}

/**
 * Decouple the exact one-world-minute simulation clock from a terminal-wide
 * truecolour repaint. Global light and persistent environmental grading move
 * through 48 coherent states per world day; weather and season transitions
 * remain immediate. Rain/storm still receive a one-second animation epoch, but
 * the global grade stays fixed inside the current atmosphere step so the codec
 * only transports changing streaks and local material motion.
 */
export class TerminalWorldLifeProjector {
  private snapshot: WorldLifeState | null = null;
  private bucket = Number.NaN;

  project(source: WorldLifeState): TerminalWorldLifeProjection {
    const bucket = Math.floor(source.worldMinute / TERMINAL_ATMOSPHERE_STEP_MINUTES);
    const transition = !this.snapshot || bucket !== this.bucket ||
      source.weather !== this.snapshot.weather ||
      source.weatherIntensity !== this.snapshot.weatherIntensity ||
      source.season !== this.snapshot.season;
    if (transition) {
      this.bucket = bucket;
      this.snapshot = {
        ...source,
        worldMinute: bucket * TERMINAL_ATMOSPHERE_STEP_MINUTES,
      };
    }
    const animatedWeather = source.weather === 'rain' || source.weather === 'storm';
    return {
      state: { ...this.snapshot! },
      animationEpoch: animatedWeather ? source.worldMinute : bucket,
    };
  }
}
