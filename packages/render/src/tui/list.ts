/**
 * List Widget
 *
 * Renders bulleted or numbered lists with consistent styling.
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

export type ListStyle = 'bullet' | 'dash' | 'arrow' | 'numbered' | 'none';

export interface ListConfig {
  x: number;
  y: number;
  items: string[];
  style?: ListStyle;
  headerText?: string;
  headerColor?: RGB;
  bulletColor?: RGB;
  itemColor?: RGB;
  backgroundColor?: RGB;
  indent?: number;
  maxWidth?: number;
}

const BULLET_CHARS: Record<ListStyle, string> = {
  bullet: '•',
  dash: '-',
  arrow: '→',
  numbered: '', // Will be replaced with numbers
  none: '',
};

/**
 * Render a list to a stream.
 */
export function renderListToStream(
  write: (s: string) => void,
  config: ListConfig
): number {
  const {
    x,
    y,
    items,
    style = 'dash',
    headerText,
    headerColor = { r: 100, g: 100, b: 120 },
    bulletColor = { r: 100, g: 100, b: 120 },
    itemColor = { r: 100, g: 100, b: 120 },
    backgroundColor,
    indent = 2,
    maxWidth,
  } = config;

  const headerFg = rgbToAnsiFg(headerColor);
  const bulletFg = rgbToAnsiFg(bulletColor);
  const itemFg = rgbToAnsiFg(itemColor);
  const bg = backgroundColor ? rgbToAnsiBg(backgroundColor) : '';

  let currentY = y;

  // Render header if present
  if (headerText) {
    write(ansiMoveTo(currentY, x) + bg + headerFg + headerText + ANSI_RESET);
    currentY++;
  }

  // Render items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let prefix = ' '.repeat(indent);

    if (style === 'numbered') {
      prefix += `${i + 1}. `;
    } else if (style !== 'none') {
      prefix += BULLET_CHARS[style] + ' ';
    }

    let displayItem = item;
    if (maxWidth && prefix.length + item.length > maxWidth) {
      displayItem = item.slice(0, maxWidth - prefix.length - 3) + '...';
    }

    write(
      ansiMoveTo(currentY, x) + bg +
      bulletFg + prefix +
      itemFg + displayItem +
      ANSI_RESET
    );
    currentY++;
  }

  return currentY - y; // Return number of lines rendered
}

/**
 * Render a list to a ScreenBuffer.
 */
export function renderListToBuffer(
  buffer: ScreenBuffer,
  config: ListConfig
): number {
  const {
    x,
    y,
    items,
    style = 'dash',
    headerText,
    headerColor = { r: 100, g: 100, b: 120 },
    bulletColor = { r: 100, g: 100, b: 120 },
    itemColor = { r: 100, g: 100, b: 120 },
    backgroundColor,
    indent = 2,
    maxWidth,
  } = config;

  const headerFg = rgbToCell(headerColor);
  const bulletFg = rgbToCell(bulletColor);
  const itemFg = rgbToCell(itemColor);
  const bgCell = backgroundColor ? rgbToCell(backgroundColor) : undefined;

  let currentY = y;

  // Render header if present
  if (headerText) {
    buffer.writeText(x, currentY, headerText, headerFg, bgCell);
    currentY++;
  }

  // Render items
  for (let i = 0; i < items.length; i++) {
    const item = items[i]!;
    let currentX = x;

    // Indent
    for (let j = 0; j < indent; j++) {
      buffer.setCell(currentX++, currentY, { char: ' ', fg: itemFg, bg: bgCell });
    }

    // Bullet/number
    if (style === 'numbered') {
      const num = `${i + 1}. `;
      for (const char of num) {
        buffer.setCell(currentX++, currentY, { char, fg: bulletFg, bg: bgCell });
      }
    } else if (style !== 'none') {
      buffer.setCell(currentX++, currentY, { char: BULLET_CHARS[style], fg: bulletFg, bg: bgCell });
      buffer.setCell(currentX++, currentY, { char: ' ', fg: bulletFg, bg: bgCell });
    }

    // Item text
    let displayItem = item;
    const availableWidth = maxWidth ? maxWidth - (currentX - x) : undefined;
    if (availableWidth && item.length > availableWidth) {
      displayItem = item.slice(0, availableWidth - 3) + '...';
    }

    for (const char of displayItem) {
      buffer.setCell(currentX++, currentY, { char, fg: itemFg, bg: bgCell });
    }

    currentY++;
  }

  return currentY - y;
}

/**
 * Render key-value pairs (for help screens).
 */
export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueListConfig {
  x: number;
  y: number;
  pairs: KeyValuePair[];
  keyWidth?: number;
  keyColor?: RGB;
  valueColor?: RGB;
  backgroundColor?: RGB;
  separator?: string;
}

/**
 * Render a key-value list to a stream.
 */
export function renderKeyValueListToStream(
  write: (s: string) => void,
  config: KeyValueListConfig
): number {
  const {
    x,
    y,
    pairs,
    keyWidth = 18,
    keyColor = { r: 120, g: 200, b: 255 },
    valueColor = { r: 200, g: 200, b: 210 },
    backgroundColor,
    separator = '',
  } = config;

  const keyFg = rgbToAnsiFg(keyColor);
  const valueFg = rgbToAnsiFg(valueColor);
  const bg = backgroundColor ? rgbToAnsiBg(backgroundColor) : '';

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const paddedKey = pair.key.padEnd(keyWidth);

    write(
      ansiMoveTo(y + i, x) + bg +
      keyFg + paddedKey +
      separator +
      valueFg + pair.value +
      ANSI_RESET
    );
  }

  return pairs.length;
}

/**
 * Render a key-value list to a ScreenBuffer.
 */
export function renderKeyValueListToBuffer(
  buffer: ScreenBuffer,
  config: KeyValueListConfig
): number {
  const {
    x,
    y,
    pairs,
    keyWidth = 18,
    keyColor = { r: 120, g: 200, b: 255 },
    valueColor = { r: 200, g: 200, b: 210 },
    backgroundColor,
  } = config;

  const keyFg = rgbToCell(keyColor);
  const valueFg = rgbToCell(valueColor);
  const bgCell = backgroundColor ? rgbToCell(backgroundColor) : undefined;

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i]!;
    const paddedKey = pair.key.padEnd(keyWidth);

    buffer.writeText(x, y + i, paddedKey, keyFg, bgCell);
    buffer.writeText(x + keyWidth, y + i, pair.value, valueFg, bgCell);
  }

  return pairs.length;
}
