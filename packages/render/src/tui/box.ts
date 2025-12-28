/**
 * Box Widget
 *
 * Renders a box with optional border, title, and background.
 * Can render to either a stream (ANSI) or a ScreenBuffer.
 */

import type { ScreenBuffer } from '../buffer/screen-buffer.js';
import {
  type RGB,
  type BorderStyle,
  type Alignment,
  BORDER_CHARS,
  rgbToCell,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

export interface BoxConfig {
  x: number;
  y: number;
  width: number;
  height: number;
  borderStyle?: BorderStyle;
  borderColor?: RGB;
  backgroundColor?: RGB;
  title?: string;
  titleColor?: RGB;
  titleAlign?: Alignment;
}

/**
 * Render a box to a stream using ANSI escape codes.
 */
export function renderBoxToStream(
  write: (s: string) => void,
  config: BoxConfig
): void {
  const {
    x,
    y,
    width,
    height,
    borderStyle = 'single',
    borderColor = { r: 80, g: 70, b: 90 },
    backgroundColor = { r: 20, g: 18, b: 25 },
    title,
    titleColor = { r: 160, g: 150, b: 165 },
    titleAlign = 'center',
  } = config;

  const chars = BORDER_CHARS[borderStyle];
  const borderFg = rgbToAnsiFg(borderColor);
  const bg = rgbToAnsiBg(backgroundColor);
  const titleFg = rgbToAnsiFg(titleColor);

  // Top border
  let topLine = chars.topLeft + chars.horizontal.repeat(width - 2) + chars.topRight;

  // Insert title if provided
  if (title && borderStyle !== 'none') {
    const titleText = ` ${title} `;
    const maxTitleLen = width - 4;
    const displayTitle = titleText.length > maxTitleLen
      ? titleText.slice(0, maxTitleLen)
      : titleText;

    let titlePos: number;
    switch (titleAlign) {
      case 'left':
        titlePos = 2;
        break;
      case 'right':
        titlePos = width - displayTitle.length - 2;
        break;
      case 'center':
      default:
        titlePos = Math.floor((width - displayTitle.length) / 2);
    }

    // Build top line with title
    const beforeTitle = chars.topLeft + chars.horizontal.repeat(titlePos - 1);
    const afterTitle = chars.horizontal.repeat(width - titlePos - displayTitle.length - 1) + chars.topRight;
    topLine = beforeTitle + displayTitle + afterTitle;

    // Write with colors
    write(ansiMoveTo(y, x) + borderFg + bg + beforeTitle);
    write(titleFg + displayTitle);
    write(borderFg + afterTitle + ANSI_RESET);
  } else {
    write(ansiMoveTo(y, x) + borderFg + bg + topLine + ANSI_RESET);
  }

  // Middle rows
  for (let row = 1; row < height - 1; row++) {
    write(
      ansiMoveTo(y + row, x) +
      borderFg + bg +
      chars.vertical +
      bg + ' '.repeat(width - 2) +
      borderFg + chars.vertical +
      ANSI_RESET
    );
  }

  // Bottom border
  const bottomLine = chars.bottomLeft + chars.horizontal.repeat(width - 2) + chars.bottomRight;
  write(ansiMoveTo(y + height - 1, x) + borderFg + bg + bottomLine + ANSI_RESET);
}

/**
 * Render a box to a ScreenBuffer.
 */
export function renderBoxToBuffer(
  buffer: ScreenBuffer,
  config: BoxConfig
): void {
  const {
    x,
    y,
    width,
    height,
    borderStyle = 'single',
    borderColor = { r: 80, g: 70, b: 90 },
    backgroundColor = { r: 20, g: 18, b: 25 },
    title,
    titleColor = { r: 160, g: 150, b: 165 },
    titleAlign = 'center',
  } = config;

  const chars = BORDER_CHARS[borderStyle];
  const fgCell = rgbToCell(borderColor);
  const bgCell = rgbToCell(backgroundColor);
  const titleFgCell = rgbToCell(titleColor);

  // Fill background
  for (let row = y; row < y + height; row++) {
    for (let col = x; col < x + width; col++) {
      buffer.setCell(col, row, { char: ' ', fg: fgCell, bg: bgCell });
    }
  }

  if (borderStyle === 'none') return;

  // Top border
  buffer.setCell(x, y, { char: chars.topLeft, fg: fgCell, bg: bgCell });
  for (let col = x + 1; col < x + width - 1; col++) {
    buffer.setCell(col, y, { char: chars.horizontal, fg: fgCell, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y, { char: chars.topRight, fg: fgCell, bg: bgCell });

  // Side borders
  for (let row = y + 1; row < y + height - 1; row++) {
    buffer.setCell(x, row, { char: chars.vertical, fg: fgCell, bg: bgCell });
    buffer.setCell(x + width - 1, row, { char: chars.vertical, fg: fgCell, bg: bgCell });
  }

  // Bottom border
  buffer.setCell(x, y + height - 1, { char: chars.bottomLeft, fg: fgCell, bg: bgCell });
  for (let col = x + 1; col < x + width - 1; col++) {
    buffer.setCell(col, y + height - 1, { char: chars.horizontal, fg: fgCell, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y + height - 1, { char: chars.bottomRight, fg: fgCell, bg: bgCell });

  // Title
  if (title) {
    const titleText = ` ${title} `;
    const maxTitleLen = width - 4;
    const displayTitle = titleText.length > maxTitleLen
      ? titleText.slice(0, maxTitleLen)
      : titleText;

    let titlePos: number;
    switch (titleAlign) {
      case 'left':
        titlePos = x + 2;
        break;
      case 'right':
        titlePos = x + width - displayTitle.length - 2;
        break;
      case 'center':
      default:
        titlePos = x + Math.floor((width - displayTitle.length) / 2);
    }

    buffer.writeText(titlePos, y, displayTitle, titleFgCell, bgCell);
  }
}

/**
 * Draw a horizontal divider inside a box.
 */
export function renderDividerToStream(
  write: (s: string) => void,
  x: number,
  y: number,
  width: number,
  borderStyle: BorderStyle = 'single',
  borderColor: RGB = { r: 80, g: 70, b: 90 },
  backgroundColor: RGB = { r: 20, g: 18, b: 25 }
): void {
  const chars = BORDER_CHARS[borderStyle];
  const borderFg = rgbToAnsiFg(borderColor);
  const bg = rgbToAnsiBg(backgroundColor);

  write(
    ansiMoveTo(y, x) +
    borderFg + bg +
    chars.teeLeft +
    chars.horizontal.repeat(width - 2) +
    chars.teeRight +
    ANSI_RESET
  );
}

/**
 * Draw a horizontal divider to a ScreenBuffer.
 */
export function renderDividerToBuffer(
  buffer: ScreenBuffer,
  x: number,
  y: number,
  width: number,
  borderStyle: BorderStyle = 'single',
  borderColor: RGB = { r: 80, g: 70, b: 90 },
  backgroundColor: RGB = { r: 20, g: 18, b: 25 }
): void {
  const chars = BORDER_CHARS[borderStyle];
  const fgCell = rgbToCell(borderColor);
  const bgCell = rgbToCell(backgroundColor);

  buffer.setCell(x, y, { char: chars.teeLeft, fg: fgCell, bg: bgCell });
  for (let col = x + 1; col < x + width - 1; col++) {
    buffer.setCell(col, y, { char: chars.horizontal, fg: fgCell, bg: bgCell });
  }
  buffer.setCell(x + width - 1, y, { char: chars.teeRight, fg: fgCell, bg: bgCell });
}
