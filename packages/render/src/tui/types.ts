/**
 * TUI Widget Types
 *
 * Common types for TUI widgets. Widgets can render to either
 * a ScreenBuffer (for Component-based UI) or a stream (for boot screen).
 */

import type { Cell } from '@maldoror/protocol';

/**
 * RGB color value
 */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

/**
 * Text alignment options
 */
export type Alignment = 'left' | 'center' | 'right';

/**
 * Box border style
 */
export type BorderStyle = 'single' | 'double' | 'rounded' | 'bold' | 'none';

/**
 * Border characters for each style
 */
export const BORDER_CHARS: Record<BorderStyle, {
  topLeft: string;
  topRight: string;
  bottomLeft: string;
  bottomRight: string;
  horizontal: string;
  vertical: string;
  teeLeft: string;
  teeRight: string;
  teeTop: string;
  teeBottom: string;
  cross: string;
}> = {
  single: {
    topLeft: '┌',
    topRight: '┐',
    bottomLeft: '└',
    bottomRight: '┘',
    horizontal: '─',
    vertical: '│',
    teeLeft: '├',
    teeRight: '┤',
    teeTop: '┬',
    teeBottom: '┴',
    cross: '┼',
  },
  double: {
    topLeft: '╔',
    topRight: '╗',
    bottomLeft: '╚',
    bottomRight: '╝',
    horizontal: '═',
    vertical: '║',
    teeLeft: '╠',
    teeRight: '╣',
    teeTop: '╦',
    teeBottom: '╩',
    cross: '╬',
  },
  rounded: {
    topLeft: '╭',
    topRight: '╮',
    bottomLeft: '╰',
    bottomRight: '╯',
    horizontal: '─',
    vertical: '│',
    teeLeft: '├',
    teeRight: '┤',
    teeTop: '┬',
    teeBottom: '┴',
    cross: '┼',
  },
  bold: {
    topLeft: '┏',
    topRight: '┓',
    bottomLeft: '┗',
    bottomRight: '┛',
    horizontal: '━',
    vertical: '┃',
    teeLeft: '┣',
    teeRight: '┫',
    teeTop: '┳',
    teeBottom: '┻',
    cross: '╋',
  },
  none: {
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
    horizontal: ' ',
    vertical: ' ',
    teeLeft: ' ',
    teeRight: ' ',
    teeTop: ' ',
    teeBottom: ' ',
    cross: ' ',
  },
};

/**
 * Convert RGB to Cell color
 */
export function rgbToCell(rgb: RGB): Cell['fg'] {
  return { type: 'rgb', value: [rgb.r, rgb.g, rgb.b] };
}

/**
 * Convert RGB to ANSI escape sequence for foreground
 */
export function rgbToAnsiFg(rgb: RGB): string {
  return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

/**
 * Convert RGB to ANSI escape sequence for background
 */
export function rgbToAnsiBg(rgb: RGB): string {
  return `\x1b[48;2;${rgb.r};${rgb.g};${rgb.b}m`;
}

/**
 * ANSI reset code
 */
export const ANSI_RESET = '\x1b[0m';

/**
 * Hide cursor
 */
export const ANSI_HIDE_CURSOR = '\x1b[?25l';

/**
 * Show cursor
 */
export const ANSI_SHOW_CURSOR = '\x1b[?25h';

/**
 * Move cursor to position (1-indexed)
 */
export function ansiMoveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

/**
 * Clear entire screen
 */
export const ANSI_CLEAR_SCREEN = '\x1b[2J';

/**
 * Enter alternate screen
 */
export const ANSI_ALTERNATE_SCREEN_ON = '\x1b[?1049h';

/**
 * Exit alternate screen
 */
export const ANSI_ALTERNATE_SCREEN_OFF = '\x1b[?1049l';
