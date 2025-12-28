/**
 * Progress Bar Widget
 *
 * Renders a progress bar with various styles and options.
 */

import type { ScreenBuffer } from '../buffer/screen-buffer.js';
import {
  type RGB,
  rgbToCell,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

/**
 * Progress bar fill styles.
 */
export type ProgressBarStyle =
  | 'block'      // █░
  | 'gradient'   // ████▓▒░
  | 'dots'       // ⣿⣶⣤⣀
  | 'arrows'     // ▶▷
  | 'line'       // ━─
  | 'ascii';     // #-

/**
 * Characters for each progress bar style.
 */
export const PROGRESS_CHARS: Record<ProgressBarStyle, { filled: string; empty: string; partial?: string[] }> = {
  block: { filled: '█', empty: '░' },
  gradient: { filled: '█', empty: ' ', partial: ['▏', '▎', '▍', '▌', '▋', '▊', '▉'] },
  dots: { filled: '⣿', empty: '⣀', partial: ['⣀', '⣤', '⣶'] },
  arrows: { filled: '▶', empty: '▷' },
  line: { filled: '━', empty: '─' },
  ascii: { filled: '#', empty: '-' },
};

export interface ProgressBarConfig {
  x: number;
  y: number;
  width: number;
  progress: number; // 0.0 to 1.0
  style?: ProgressBarStyle;
  filledColor?: RGB;
  emptyColor?: RGB;
  backgroundColor?: RGB;
  showPercentage?: boolean;
  percentageColor?: RGB;
  brackets?: boolean;
  bracketColor?: RGB;
}

/**
 * Render a progress bar to a stream using ANSI escape codes.
 */
export function renderProgressBarToStream(
  write: (s: string) => void,
  config: ProgressBarConfig
): void {
  const {
    x,
    y,
    width,
    progress,
    style = 'block',
    filledColor = { r: 120, g: 180, b: 120 },
    emptyColor = { r: 60, g: 55, b: 65 },
    backgroundColor,
    showPercentage = false,
    percentageColor = { r: 140, g: 135, b: 145 },
    brackets = true,
    bracketColor = { r: 80, g: 70, b: 90 },
  } = config;

  const chars = PROGRESS_CHARS[style];
  const clampedProgress = Math.max(0, Math.min(1, progress));

  // Calculate bar width (accounting for brackets and percentage)
  let barWidth = width;
  if (brackets) barWidth -= 2;
  if (showPercentage) barWidth -= 5; // " 100%"

  const filledWidth = Math.floor(clampedProgress * barWidth);
  const emptyWidth = barWidth - filledWidth;

  // Calculate partial fill if style supports it
  let partialChar = '';
  if (chars.partial) {
    const remainder = (clampedProgress * barWidth) - filledWidth;
    if (remainder > 0 && emptyWidth > 0) {
      const partialIndex = Math.floor(remainder * chars.partial.length);
      partialChar = chars.partial[Math.min(partialIndex, chars.partial.length - 1)] || '';
    }
  }

  let output = ansiMoveTo(y, x);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }

  // Opening bracket
  if (brackets) {
    output += rgbToAnsiFg(bracketColor) + '[';
  }

  // Filled portion
  output += rgbToAnsiFg(filledColor) + chars.filled.repeat(filledWidth);

  // Partial fill
  if (partialChar) {
    output += partialChar;
    output += rgbToAnsiFg(emptyColor) + chars.empty.repeat(Math.max(0, emptyWidth - 1));
  } else {
    output += rgbToAnsiFg(emptyColor) + chars.empty.repeat(emptyWidth);
  }

  // Closing bracket
  if (brackets) {
    output += rgbToAnsiFg(bracketColor) + ']';
  }

  // Percentage
  if (showPercentage) {
    const pct = Math.round(clampedProgress * 100).toString().padStart(3);
    output += rgbToAnsiFg(percentageColor) + ` ${pct}%`;
  }

  output += ANSI_RESET;
  write(output);
}

/**
 * Render a progress bar to a ScreenBuffer.
 */
export function renderProgressBarToBuffer(
  buffer: ScreenBuffer,
  config: ProgressBarConfig
): void {
  const {
    x,
    y,
    width,
    progress,
    style = 'block',
    filledColor = { r: 120, g: 180, b: 120 },
    emptyColor = { r: 60, g: 55, b: 65 },
    backgroundColor,
    showPercentage = false,
    percentageColor = { r: 140, g: 135, b: 145 },
    brackets = true,
    bracketColor = { r: 80, g: 70, b: 90 },
  } = config;

  const chars = PROGRESS_CHARS[style];
  const clampedProgress = Math.max(0, Math.min(1, progress));

  const filledFg = rgbToCell(filledColor);
  const emptyFg = rgbToCell(emptyColor);
  const bracketFgCell = rgbToCell(bracketColor);
  const percentageFg = rgbToCell(percentageColor);
  const bgCell = backgroundColor ? rgbToCell(backgroundColor) : undefined;

  let currentX = x;

  // Calculate bar width
  let barWidth = width;
  if (brackets) barWidth -= 2;
  if (showPercentage) barWidth -= 5;

  const filledWidth = Math.floor(clampedProgress * barWidth);
  const emptyWidth = barWidth - filledWidth;

  // Opening bracket
  if (brackets) {
    buffer.setCell(currentX++, y, { char: '[', fg: bracketFgCell, bg: bgCell });
  }

  // Filled portion
  for (let i = 0; i < filledWidth; i++) {
    buffer.setCell(currentX++, y, { char: chars.filled, fg: filledFg, bg: bgCell });
  }

  // Empty portion
  for (let i = 0; i < emptyWidth; i++) {
    buffer.setCell(currentX++, y, { char: chars.empty, fg: emptyFg, bg: bgCell });
  }

  // Closing bracket
  if (brackets) {
    buffer.setCell(currentX++, y, { char: ']', fg: bracketFgCell, bg: bgCell });
  }

  // Percentage
  if (showPercentage) {
    const pct = Math.round(clampedProgress * 100).toString().padStart(3) + '%';
    buffer.setCell(currentX++, y, { char: ' ', fg: percentageFg, bg: bgCell });
    for (const char of pct) {
      buffer.setCell(currentX++, y, { char, fg: percentageFg, bg: bgCell });
    }
  }
}

/**
 * Step progress indicator (●○○○)
 */
export interface StepIndicatorConfig {
  x: number;
  y: number;
  totalSteps: number;
  currentStep: number;
  completedColor?: RGB;
  currentColor?: RGB;
  pendingColor?: RGB;
  backgroundColor?: RGB;
  completedChar?: string;
  currentChar?: string;
  pendingChar?: string;
  separator?: string;
}

/**
 * Render a step indicator to a stream.
 */
export function renderStepIndicatorToStream(
  write: (s: string) => void,
  config: StepIndicatorConfig
): void {
  const {
    x,
    y,
    totalSteps,
    currentStep,
    completedColor = { r: 120, g: 180, b: 120 },
    currentColor = { r: 200, g: 160, b: 100 },
    pendingColor = { r: 60, g: 55, b: 65 },
    backgroundColor,
    completedChar = '●',
    currentChar = '◉',
    pendingChar = '○',
    separator = ' ',
  } = config;

  let output = ansiMoveTo(y, x);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }

  for (let i = 0; i < totalSteps; i++) {
    if (i > 0) output += separator;

    if (i < currentStep) {
      output += rgbToAnsiFg(completedColor) + completedChar;
    } else if (i === currentStep) {
      output += rgbToAnsiFg(currentColor) + currentChar;
    } else {
      output += rgbToAnsiFg(pendingColor) + pendingChar;
    }
  }

  output += ANSI_RESET;
  write(output);
}
