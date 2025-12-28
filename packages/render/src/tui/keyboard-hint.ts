/**
 * Keyboard Hint Widget
 *
 * Renders keyboard shortcut hints like "[Enter] Confirm  [Esc] Cancel"
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

export interface KeyHint {
  key: string;      // e.g., "Enter", "Esc", "Tab"
  action: string;   // e.g., "Confirm", "Cancel", "Next"
  type?: 'primary' | 'secondary' | 'danger'; // Color scheme
}

export interface KeyboardHintConfig {
  x: number;
  y: number;
  hints: KeyHint[];
  keyColor?: RGB;
  primaryActionColor?: RGB;
  secondaryActionColor?: RGB;
  dangerActionColor?: RGB;
  backgroundColor?: RGB;
  separator?: string;
}

// Default colors
const DEFAULT_KEY_COLOR: RGB = { r: 100, g: 200, b: 100 };
const DEFAULT_PRIMARY_COLOR: RGB = { r: 180, g: 180, b: 180 };
const DEFAULT_SECONDARY_COLOR: RGB = { r: 140, g: 140, b: 150 };
const DEFAULT_DANGER_COLOR: RGB = { r: 200, g: 100, b: 100 };

/**
 * Render keyboard hints to a stream.
 */
export function renderKeyboardHintsToStream(
  write: (s: string) => void,
  config: KeyboardHintConfig
): void {
  const {
    x,
    y,
    hints,
    keyColor = DEFAULT_KEY_COLOR,
    primaryActionColor = DEFAULT_PRIMARY_COLOR,
    secondaryActionColor = DEFAULT_SECONDARY_COLOR,
    dangerActionColor = DEFAULT_DANGER_COLOR,
    backgroundColor,
    separator = '  ',
  } = config;

  const keyFg = rgbToAnsiFg(keyColor);
  const primaryFg = rgbToAnsiFg(primaryActionColor);
  const secondaryFg = rgbToAnsiFg(secondaryActionColor);
  const dangerFg = rgbToAnsiFg(dangerActionColor);
  const bg = backgroundColor ? rgbToAnsiBg(backgroundColor) : '';

  let output = ansiMoveTo(y, x) + bg;

  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i]!;

    // Add separator between hints
    if (i > 0) {
      output += separator;
    }

    // Key in brackets
    output += keyFg + `[${hint.key}]`;

    // Action text with appropriate color
    let actionFg: string;
    switch (hint.type) {
      case 'danger':
        actionFg = dangerFg;
        break;
      case 'secondary':
        actionFg = secondaryFg;
        break;
      case 'primary':
      default:
        actionFg = primaryFg;
    }
    output += ' ' + actionFg + hint.action;
  }

  output += ANSI_RESET;
  write(output);
}

/**
 * Render keyboard hints to a ScreenBuffer.
 */
export function renderKeyboardHintsToBuffer(
  buffer: ScreenBuffer,
  config: KeyboardHintConfig
): void {
  const {
    x,
    y,
    hints,
    keyColor = DEFAULT_KEY_COLOR,
    primaryActionColor = DEFAULT_PRIMARY_COLOR,
    secondaryActionColor = DEFAULT_SECONDARY_COLOR,
    dangerActionColor = DEFAULT_DANGER_COLOR,
    backgroundColor,
    separator = '  ',
  } = config;

  const keyFg = rgbToCell(keyColor);
  const primaryFg = rgbToCell(primaryActionColor);
  const secondaryFg = rgbToCell(secondaryActionColor);
  const dangerFg = rgbToCell(dangerActionColor);
  const bgCell = backgroundColor ? rgbToCell(backgroundColor) : undefined;

  let currentX = x;

  for (let i = 0; i < hints.length; i++) {
    const hint = hints[i]!;

    // Add separator between hints
    if (i > 0) {
      for (const char of separator) {
        buffer.setCell(currentX++, y, { char, fg: primaryFg, bg: bgCell });
      }
    }

    // Opening bracket
    buffer.setCell(currentX++, y, { char: '[', fg: keyFg, bg: bgCell });

    // Key text
    for (const char of hint.key) {
      buffer.setCell(currentX++, y, { char, fg: keyFg, bg: bgCell });
    }

    // Closing bracket
    buffer.setCell(currentX++, y, { char: ']', fg: keyFg, bg: bgCell });

    // Space
    buffer.setCell(currentX++, y, { char: ' ', fg: primaryFg, bg: bgCell });

    // Action text with appropriate color
    let actionFg = primaryFg;
    switch (hint.type) {
      case 'danger':
        actionFg = dangerFg;
        break;
      case 'secondary':
        actionFg = secondaryFg;
        break;
    }

    for (const char of hint.action) {
      buffer.setCell(currentX++, y, { char, fg: actionFg, bg: bgCell });
    }
  }
}

/**
 * Get the total width of keyboard hints.
 */
export function getKeyboardHintsWidth(hints: KeyHint[], separator: string = '  '): number {
  let width = 0;
  for (let i = 0; i < hints.length; i++) {
    if (i > 0) width += separator.length;
    width += hints[i]!.key.length + hints[i]!.action.length + 3; // [key] action
  }
  return width;
}

/**
 * Create common hint presets.
 */
export const COMMON_HINTS = {
  confirmCancel: [
    { key: 'Enter', action: 'Confirm', type: 'primary' as const },
    { key: 'Esc', action: 'Cancel', type: 'danger' as const },
  ],
  generateCancel: [
    { key: 'Enter', action: 'Generate', type: 'primary' as const },
    { key: 'Esc', action: 'Cancel', type: 'danger' as const },
  ],
  close: [
    { key: 'Esc', action: 'Close', type: 'secondary' as const },
  ],
  closeWithQuestion: [
    { key: 'Esc', action: 'Close', type: 'secondary' as const },
    { key: '?', action: 'Close', type: 'secondary' as const },
  ],
};
