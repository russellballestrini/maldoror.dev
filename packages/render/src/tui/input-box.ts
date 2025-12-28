/**
 * Input Box Widget
 *
 * Renders a text input field with optional border and placeholder.
 */

import type { ScreenBuffer } from '../buffer/screen-buffer.js';
import {
  type RGB,
  type BorderStyle,
  BORDER_CHARS,
  rgbToCell,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

export interface InputBoxConfig {
  x: number;
  y: number;
  width: number;
  value: string;
  placeholder?: string;
  borderStyle?: BorderStyle;
  borderColor?: RGB;
  backgroundColor?: RGB;
  textColor?: RGB;
  placeholderColor?: RGB;
  cursorVisible?: boolean;
  maxDisplayLength?: number;
}

/**
 * Render an input box to a stream.
 */
export function renderInputBoxToStream(
  write: (s: string) => void,
  config: InputBoxConfig
): void {
  const {
    x,
    y,
    width,
    value,
    placeholder = '',
    borderStyle = 'single',
    borderColor = { r: 80, g: 80, b: 100 },
    backgroundColor = { r: 15, g: 12, b: 18 },
    textColor = { r: 255, g: 255, b: 255 },
    placeholderColor = { r: 100, g: 100, b: 120 },
    cursorVisible = true,
    maxDisplayLength,
  } = config;

  const chars = BORDER_CHARS[borderStyle];
  const borderFg = rgbToAnsiFg(borderColor);
  const bg = rgbToAnsiBg(backgroundColor);
  const textFg = rgbToAnsiFg(textColor);
  const phFg = rgbToAnsiFg(placeholderColor);

  const innerWidth = width - 2;
  const displayWidth = maxDisplayLength ?? innerWidth - 2;

  // Calculate display value (scroll if too long)
  let displayValue = value;
  if (value.length > displayWidth) {
    displayValue = value.slice(-(displayWidth));
  }

  // Top border
  write(ansiMoveTo(y, x) + borderFg + bg + chars.topLeft + chars.horizontal.repeat(innerWidth) + chars.topRight + ANSI_RESET);

  // Input line
  const showPlaceholder = value.length === 0 && placeholder;
  const displayText = showPlaceholder ? placeholder : displayValue;
  const displayColor = showPlaceholder ? phFg : textFg;
  const paddedText = displayText.padEnd(innerWidth);

  write(ansiMoveTo(y + 1, x) + borderFg + bg + chars.vertical);
  write(displayColor + bg + paddedText);
  write(borderFg + chars.vertical + ANSI_RESET);

  // Bottom border
  write(ansiMoveTo(y + 2, x) + borderFg + bg + chars.bottomLeft + chars.horizontal.repeat(innerWidth) + chars.bottomRight + ANSI_RESET);

  // Position cursor
  if (cursorVisible && !showPlaceholder) {
    const cursorX = x + 1 + displayValue.length;
    write(ansiMoveTo(y + 1, cursorX) + '\x1b[?25h'); // Show cursor
  }
}

/**
 * Render an input box to a ScreenBuffer.
 */
export function renderInputBoxToBuffer(
  buffer: ScreenBuffer,
  config: InputBoxConfig
): void {
  const {
    x,
    y,
    width,
    value,
    placeholder = '',
    borderStyle = 'single',
    borderColor = { r: 80, g: 80, b: 100 },
    backgroundColor = { r: 15, g: 12, b: 18 },
    textColor = { r: 255, g: 255, b: 255 },
    placeholderColor = { r: 100, g: 100, b: 120 },
    maxDisplayLength,
  } = config;

  const chars = BORDER_CHARS[borderStyle];
  const borderFg = rgbToCell(borderColor);
  const bgCell = rgbToCell(backgroundColor);
  const textFgCell = rgbToCell(textColor);
  const phFgCell = rgbToCell(placeholderColor);

  const innerWidth = width - 2;
  const displayWidth = maxDisplayLength ?? innerWidth - 2;

  // Calculate display value
  let displayValue = value;
  if (value.length > displayWidth) {
    displayValue = value.slice(-(displayWidth));
  }

  // Top border
  buffer.setCell(x, y, { char: chars.topLeft, fg: borderFg, bg: bgCell });
  for (let i = 1; i <= innerWidth; i++) {
    buffer.setCell(x + i, y, { char: chars.horizontal, fg: borderFg, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y, { char: chars.topRight, fg: borderFg, bg: bgCell });

  // Input line
  buffer.setCell(x, y + 1, { char: chars.vertical, fg: borderFg, bg: bgCell });
  const showPlaceholder = value.length === 0 && placeholder;
  const displayText = showPlaceholder ? placeholder : displayValue;
  const displayFg = showPlaceholder ? phFgCell : textFgCell;

  for (let i = 0; i < innerWidth; i++) {
    const char = displayText[i] ?? ' ';
    buffer.setCell(x + 1 + i, y + 1, { char, fg: displayFg, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y + 1, { char: chars.vertical, fg: borderFg, bg: bgCell });

  // Bottom border
  buffer.setCell(x, y + 2, { char: chars.bottomLeft, fg: borderFg, bg: bgCell });
  for (let i = 1; i <= innerWidth; i++) {
    buffer.setCell(x + i, y + 2, { char: chars.horizontal, fg: borderFg, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y + 2, { char: chars.bottomRight, fg: borderFg, bg: bgCell });
}

/**
 * Update only the input value portion (for fast updates while typing).
 */
export function updateInputValueToStream(
  write: (s: string) => void,
  x: number,
  y: number,
  innerWidth: number,
  value: string,
  textColor: RGB = { r: 255, g: 255, b: 255 },
  backgroundColor: RGB = { r: 15, g: 12, b: 18 },
  maxDisplayLength?: number
): void {
  const displayWidth = maxDisplayLength ?? innerWidth - 2;
  let displayValue = value;
  if (value.length > displayWidth) {
    displayValue = value.slice(-(displayWidth));
  }

  const paddedText = displayValue.padEnd(innerWidth);

  write(
    ansiMoveTo(y + 1, x + 1) +
    rgbToAnsiBg(backgroundColor) +
    rgbToAnsiFg(textColor) +
    paddedText +
    ansiMoveTo(y + 1, x + 1 + displayValue.length) +
    '\x1b[?25h' + // Show cursor
    ANSI_RESET
  );
}
