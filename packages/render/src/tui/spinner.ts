/**
 * Spinner Widget
 *
 * Animated loading spinner with various styles.
 */

import {
  type RGB,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

/**
 * Spinner animation styles.
 */
export type SpinnerStyle =
  | 'dots'       // ⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏
  | 'line'       // -\|/
  | 'arc'        // ◜◠◝◞◡◟
  | 'circle'     // ◐◓◑◒
  | 'pulse'      // ◉○
  | 'bounce'     // ⠁⠂⠄⡀⢀⠠⠐⠈
  | 'arrows'     // ←↖↑↗→↘↓↙
  | 'bar'        // █▓▒░
  | 'clock'      // 🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛
  | 'moon';      // 🌑🌒🌓🌔🌕🌖🌗🌘

/**
 * Animation frames for each spinner style.
 */
export const SPINNER_FRAMES: Record<SpinnerStyle, string[]> = {
  dots: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
  line: ['-', '\\', '|', '/'],
  arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
  circle: ['◐', '◓', '◑', '◒'],
  pulse: ['◉', '○', '◎', '○'],
  bounce: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'],
  arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙'],
  bar: ['█', '▓', '▒', '░', '▒', '▓'],
  clock: ['🕐', '🕑', '🕒', '🕓', '🕔', '🕕', '🕖', '🕗', '🕘', '🕙', '🕚', '🕛'],
  moon: ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'],
};

export interface SpinnerConfig {
  x: number;
  y: number;
  style?: SpinnerStyle;
  color?: RGB;
  backgroundColor?: RGB;
  label?: string;
  labelColor?: RGB;
  labelGap?: number;
}

/**
 * Render a single spinner frame to a stream.
 */
export function renderSpinnerFrameToStream(
  write: (s: string) => void,
  frame: number,
  config: SpinnerConfig
): void {
  const {
    x,
    y,
    style = 'dots',
    color = { r: 200, g: 160, b: 100 },
    backgroundColor,
    label,
    labelColor = { r: 160, g: 150, b: 165 },
    labelGap = 1,
  } = config;

  const frames = SPINNER_FRAMES[style];
  const spinnerChar = frames[frame % frames.length];

  let output = ansiMoveTo(y, x);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }
  output += rgbToAnsiFg(color) + spinnerChar;

  if (label) {
    output += ' '.repeat(labelGap) + rgbToAnsiFg(labelColor) + label;
  }

  output += ANSI_RESET;
  write(output);
}

/**
 * Spinner controller for managing animation state.
 */
export class SpinnerController {
  private frame: number = 0;
  private interval: ReturnType<typeof setInterval> | null = null;
  private config: SpinnerConfig;
  private write: (s: string) => void;
  private frameRate: number;

  constructor(
    write: (s: string) => void,
    config: SpinnerConfig,
    frameRate: number = 80
  ) {
    this.write = write;
    this.config = config;
    this.frameRate = frameRate;
  }

  /**
   * Start the spinner animation.
   */
  start(): void {
    if (this.interval) return;

    this.render();
    this.interval = setInterval(() => {
      this.frame++;
      this.render();
    }, this.frameRate);
  }

  /**
   * Stop the spinner animation.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Render current frame.
   */
  render(): void {
    renderSpinnerFrameToStream(this.write, this.frame, this.config);
  }

  /**
   * Update spinner config.
   */
  update(config: Partial<SpinnerConfig>): void {
    this.config = { ...this.config, ...config };
    this.render();
  }

  /**
   * Update just the label.
   */
  setLabel(label: string): void {
    this.config.label = label;
    this.render();
  }

  /**
   * Check if spinner is running.
   */
  isRunning(): boolean {
    return this.interval !== null;
  }

  /**
   * Get current frame number.
   */
  getFrame(): number {
    return this.frame;
  }

  /**
   * Reset frame counter.
   */
  reset(): void {
    this.frame = 0;
  }
}

/**
 * Create a spinner controller.
 */
export function createSpinner(
  write: (s: string) => void,
  config: SpinnerConfig,
  frameRate?: number
): SpinnerController {
  return new SpinnerController(write, config, frameRate);
}
