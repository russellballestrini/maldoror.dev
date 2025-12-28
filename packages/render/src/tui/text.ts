/**
 * Text Widget
 *
 * Renders styled text with alignment, colors, and truncation options.
 */

import type { ScreenBuffer } from '../buffer/screen-buffer.js';
import {
  type RGB,
  type Alignment,
  rgbToCell,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

export interface TextConfig {
  x: number;
  y: number;
  text: string;
  color?: RGB;
  backgroundColor?: RGB;
  align?: Alignment;
  maxWidth?: number;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

/**
 * Calculate aligned x position for text.
 */
function getAlignedX(x: number, textLen: number, maxWidth: number | undefined, align: Alignment): number {
  if (!maxWidth || align === 'left') return x;
  if (align === 'center') return x + Math.floor((maxWidth - textLen) / 2);
  if (align === 'right') return x + maxWidth - textLen;
  return x;
}

/**
 * Truncate text to fit within maxWidth.
 */
function truncateText(text: string, maxWidth: number | undefined): string {
  if (!maxWidth || text.length <= maxWidth) return text;
  if (maxWidth <= 3) return text.slice(0, maxWidth);
  return text.slice(0, maxWidth - 3) + '...';
}

/**
 * Get ANSI style codes.
 */
function getStyleCodes(config: TextConfig): string {
  let codes = '';
  if (config.bold) codes += '\x1b[1m';
  if (config.dim) codes += '\x1b[2m';
  if (config.italic) codes += '\x1b[3m';
  if (config.underline) codes += '\x1b[4m';
  return codes;
}

/**
 * Render text to a stream using ANSI escape codes.
 */
export function renderTextToStream(
  write: (s: string) => void,
  config: TextConfig
): void {
  const {
    x,
    y,
    text,
    color = { r: 200, g: 195, b: 205 },
    backgroundColor,
    align = 'left',
    maxWidth,
  } = config;

  const displayText = truncateText(text, maxWidth);
  const alignedX = getAlignedX(x, displayText.length, maxWidth, align);

  let output = ansiMoveTo(y, alignedX);
  output += getStyleCodes(config);
  output += rgbToAnsiFg(color);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }
  output += displayText + ANSI_RESET;

  write(output);
}

/**
 * Render text to a ScreenBuffer.
 */
export function renderTextToBuffer(
  buffer: ScreenBuffer,
  config: TextConfig
): void {
  const {
    x,
    y,
    text,
    color = { r: 200, g: 195, b: 205 },
    backgroundColor,
    align = 'left',
    maxWidth,
  } = config;

  const displayText = truncateText(text, maxWidth);
  const alignedX = getAlignedX(x, displayText.length, maxWidth, align);

  const fgCell = rgbToCell(color);
  const bgCell = backgroundColor ? rgbToCell(backgroundColor) : undefined;

  buffer.writeText(alignedX, y, displayText, fgCell, bgCell);
}

/**
 * Render multiline text, splitting on newlines and wrapping if needed.
 */
export function renderMultilineTextToStream(
  write: (s: string) => void,
  config: TextConfig & { lineHeight?: number }
): number {
  const lines = config.text.split('\n');
  const lineHeight = config.lineHeight ?? 1;
  let currentY = config.y;

  for (const line of lines) {
    renderTextToStream(write, { ...config, y: currentY, text: line });
    currentY += lineHeight;
  }

  return currentY - config.y; // Return number of lines rendered
}

/**
 * Render multiline text to a ScreenBuffer.
 */
export function renderMultilineTextToBuffer(
  buffer: ScreenBuffer,
  config: TextConfig & { lineHeight?: number }
): number {
  const lines = config.text.split('\n');
  const lineHeight = config.lineHeight ?? 1;
  let currentY = config.y;

  for (const line of lines) {
    renderTextToBuffer(buffer, { ...config, y: currentY, text: line });
    currentY += lineHeight;
  }

  return currentY - config.y;
}

/**
 * Create a gradient text effect across characters.
 */
export function renderGradientTextToStream(
  write: (s: string) => void,
  x: number,
  y: number,
  text: string,
  startColor: RGB,
  endColor: RGB,
  backgroundColor?: RGB
): void {
  write(ansiMoveTo(y, x));
  if (backgroundColor) {
    write(rgbToAnsiBg(backgroundColor));
  }

  const len = text.length;
  for (let i = 0; i < len; i++) {
    const t = len > 1 ? i / (len - 1) : 0;
    const r = Math.round(startColor.r + (endColor.r - startColor.r) * t);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * t);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * t);
    write(rgbToAnsiFg({ r, g, b }) + text[i]);
  }

  write(ANSI_RESET);
}
