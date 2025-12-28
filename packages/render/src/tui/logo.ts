/**
 * Logo Widget
 *
 * Renders the Maldoror ASCII art logo with gradient colors.
 */

import {
  type RGB,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

/**
 * The Maldoror ASCII art logo.
 */
export const MALDOROR_LOGO = [
  '███╗   ███╗ █████╗ ██╗     ██████╗  ██████╗ ██████╗  ██████╗ ██████╗ ',
  '████╗ ████║██╔══██╗██║     ██╔══██╗██╔═══██╗██╔══██╗██╔═══██╗██╔══██╗',
  '██╔████╔██║███████║██║     ██║  ██║██║   ██║██████╔╝██║   ██║██████╔╝',
  '██║╚██╔╝██║██╔══██║██║     ██║  ██║██║   ██║██╔══██╗██║   ██║██╔══██╗',
  '██║ ╚═╝ ██║██║  ██║███████╗██████╔╝╚██████╔╝██║  ██║╚██████╔╝██║  ██║',
  '╚═╝     ╚═╝╚═╝  ╚═╝╚══════╝╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝',
];

/**
 * Get the width of the logo.
 */
export const LOGO_WIDTH = MALDOROR_LOGO[0]!.length;

/**
 * Get the height of the logo.
 */
export const LOGO_HEIGHT = MALDOROR_LOGO.length;

/**
 * Default broody crimson gradient for the logo.
 */
export const DEFAULT_LOGO_GRADIENT: RGB[] = [
  { r: 180, g: 60, b: 90 },   // Bright crimson (top)
  { r: 160, g: 50, b: 80 },   // Rose crimson
  { r: 140, g: 45, b: 70 },   // Deep rose
  { r: 120, g: 40, b: 65 },   // Wine
  { r: 100, g: 35, b: 55 },   // Burgundy
  { r: 85, g: 30, b: 50 },    // Dark plum (bottom)
];

export interface LogoConfig {
  x: number;
  y: number;
  gradient?: RGB[];
  backgroundColor?: RGB;
  centered?: boolean;
  screenWidth?: number;
}

/**
 * Render the logo to a stream using ANSI escape codes.
 */
export function renderLogoToStream(
  write: (s: string) => void,
  config: LogoConfig
): void {
  const {
    x,
    y,
    gradient = DEFAULT_LOGO_GRADIENT,
    backgroundColor,
  } = config;

  // Calculate x position (may be adjusted for centering)
  let startX = x;
  if (config.centered && config.screenWidth) {
    startX = Math.max(1, Math.floor((config.screenWidth - LOGO_WIDTH) / 2));
  }

  const bg = backgroundColor ? rgbToAnsiBg(backgroundColor) : '';

  for (let i = 0; i < MALDOROR_LOGO.length; i++) {
    const color = gradient[i] || gradient[gradient.length - 1]!;
    write(
      ansiMoveTo(y + i, startX) +
      bg +
      rgbToAnsiFg(color) +
      MALDOROR_LOGO[i] +
      ANSI_RESET
    );
  }
}

/**
 * Render a subtitle below the logo.
 */
export function renderSubtitleToStream(
  write: (s: string) => void,
  x: number,
  y: number,
  subtitle: string,
  color: RGB = { r: 120, g: 100, b: 115 },
  backgroundColor?: RGB,
  centered: boolean = false,
  screenWidth?: number
): void {
  let startX = x;
  if (centered && screenWidth) {
    startX = Math.max(1, Math.floor((screenWidth - subtitle.length) / 2));
  }

  let output = ansiMoveTo(y, startX);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }
  output += rgbToAnsiFg(color) + subtitle + ANSI_RESET;

  write(output);
}

/**
 * Render the full logo with subtitle.
 */
export function renderFullLogoToStream(
  write: (s: string) => void,
  config: LogoConfig & {
    subtitle?: string;
    subtitleColor?: RGB;
    subtitleGap?: number;
  }
): void {
  const {
    subtitle = 'T E R M I N A L   M M O',
    subtitleColor = { r: 120, g: 100, b: 115 },
    subtitleGap = 2,
    ...logoConfig
  } = config;

  renderLogoToStream(write, logoConfig);

  const subtitleY = logoConfig.y + LOGO_HEIGHT + subtitleGap;
  renderSubtitleToStream(
    write,
    logoConfig.x,
    subtitleY,
    subtitle,
    subtitleColor,
    logoConfig.backgroundColor,
    logoConfig.centered,
    logoConfig.screenWidth
  );
}

/**
 * Animated logo with fade-in effect.
 */
export class AnimatedLogo {
  private frame: number = 0;
  private maxFrames: number;
  private interval: ReturnType<typeof setInterval> | null = null;
  private config: LogoConfig;
  private write: (s: string) => void;
  private onComplete?: () => void;

  constructor(
    write: (s: string) => void,
    config: LogoConfig,
    fadeFrames: number = 10
  ) {
    this.write = write;
    this.config = config;
    this.maxFrames = fadeFrames;
  }

  /**
   * Start the fade-in animation.
   */
  fadeIn(onComplete?: () => void): void {
    this.onComplete = onComplete;
    this.frame = 0;

    this.interval = setInterval(() => {
      this.renderFrame();
      this.frame++;

      if (this.frame >= this.maxFrames) {
        this.stop();
        this.onComplete?.();
      }
    }, 50);
  }

  /**
   * Stop the animation.
   */
  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  /**
   * Render current animation frame.
   */
  private renderFrame(): void {
    const progress = this.frame / this.maxFrames;
    const gradient = this.config.gradient || DEFAULT_LOGO_GRADIENT;

    // Interpolate colors from dim to full brightness
    const fadedGradient = gradient.map(color => ({
      r: Math.round(color.r * progress),
      g: Math.round(color.g * progress),
      b: Math.round(color.b * progress),
    }));

    renderLogoToStream(this.write, {
      ...this.config,
      gradient: fadedGradient,
    });
  }
}
