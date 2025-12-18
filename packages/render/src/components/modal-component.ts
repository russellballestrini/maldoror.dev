import type { Rect, Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { Component, type ComponentConfig, type InputResult } from './component.js';

/**
 * Configuration for modal components
 */
export interface ModalComponentConfig extends Omit<ComponentConfig, 'modal'> {
  title?: string;
  borderColor?: Cell['fg'];
  backgroundColor?: Cell['bg'];
}

/**
 * Base class for modal components.
 *
 * Modal components:
 * - Block input to components behind them
 * - Can be closed with ESC (by default)
 * - Are centered on the screen by default
 * - Have a border and title
 */
export abstract class ModalComponent extends Component {
  protected title: string;
  protected borderColor: Cell['fg'];
  protected backgroundColor: Cell['bg'];
  protected onCloseCallback: (() => void) | null = null;

  constructor(config: ModalComponentConfig) {
    super({ ...config, modal: true });
    this.title = config.title ?? '';
    this.borderColor = config.borderColor ?? { type: 'rgb', value: [100, 100, 120] };
    this.backgroundColor = config.backgroundColor ?? { type: 'rgb', value: [20, 20, 35] };
  }

  /**
   * Create a centered modal with given dimensions.
   */
  static createCentered(
    _id: string,
    width: number,
    height: number,
    screenCols: number,
    screenRows: number
  ): Rect {
    return {
      x: Math.floor((screenCols - width) / 2),
      y: Math.floor((screenRows - height) / 2),
      width,
      height,
    };
  }

  /**
   * Set callback for when modal requests to close.
   */
  setOnClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  /**
   * Request to close this modal.
   * Call this instead of directly hiding to notify the ComponentManager.
   */
  protected requestClose(): void {
    this.onCloseCallback?.();
  }

  /**
   * Default input handling for modals.
   * ESC closes the modal. Override to add more handlers.
   */
  handleInput(event: ParsedKey): InputResult {
    if (event.type === 'key') {
      if (event.key === 'Escape') {
        this.requestClose();
        return { handled: true, stopPropagation: true };
      }
    }
    // Block all input by default (modal behavior)
    return { handled: true, stopPropagation: true };
  }

  /**
   * Render the modal frame (background, border, title).
   * Call this at the start of render() in subclasses.
   */
  protected renderFrame(): void {
    // Fill background
    this.fill(' ', { type: 'default' }, this.backgroundColor);

    // Draw border
    this.drawBorder(this.title, this.borderColor, this.backgroundColor);
  }

  /**
   * Write text centered horizontally within the modal.
   */
  protected writeCentered(y: number, text: string, fg?: Cell['fg']): void {
    const x = Math.floor((this.bounds.width - text.length) / 2);
    this.buffer.writeText(Math.max(1, x), y, text, fg, this.backgroundColor);
  }

  /**
   * Write text at position with modal's background color.
   */
  protected writeText(x: number, y: number, text: string, fg?: Cell['fg']): void {
    this.buffer.writeText(x, y, text, fg, this.backgroundColor);
  }

  /**
   * Draw a horizontal divider line.
   */
  protected drawDivider(y: number): void {
    this.buffer.setCell(0, y, {
      char: '├',
      fg: this.borderColor,
      bg: this.backgroundColor,
    });
    for (let x = 1; x < this.bounds.width - 1; x++) {
      this.buffer.setCell(x, y, {
        char: '─',
        fg: this.borderColor,
        bg: this.backgroundColor,
      });
    }
    this.buffer.setCell(this.bounds.width - 1, y, {
      char: '┤',
      fg: this.borderColor,
      bg: this.backgroundColor,
    });
  }

  /**
   * Get the inner width (excluding borders).
   */
  protected getInnerWidth(): number {
    return this.bounds.width - 2;
  }

  /**
   * Get the inner height (excluding borders).
   */
  protected getInnerHeight(): number {
    return this.bounds.height - 2;
  }
}
