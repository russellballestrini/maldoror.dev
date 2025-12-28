import type { Duplex } from 'stream';
import {
  ANSIBuilder,
  BG_PRIMARY,
  renderBoxToStream,
  createSpinner,
  type SpinnerController,
  type RGB,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
  ANSI_ALTERNATE_SCREEN_ON,
  ANSI_ALTERNATE_SCREEN_OFF,
  ANSI_HIDE_CURSOR,
  ANSI_SHOW_CURSOR,
  ANSI_CLEAR_SCREEN,
} from '@maldoror/render';

export type ScreenState = 'input' | 'generating' | 'preview' | 'error';

export interface BoxConfig {
  width: number;
  height: number;
  startX: number;
  startY: number;
  title: string;
  borderColor: RGB;
  titleColor: RGB;
}

/**
 * Base class for modal screens (avatar generation, building placement, etc.)
 * Provides shared UI utilities for rendering boxes, spinners, text wrapping, etc.
 */
export abstract class BaseModalScreen {
  protected stream: Duplex;
  protected ansi: ANSIBuilder;
  protected state: ScreenState = 'input';
  protected destroyed: boolean = false;
  protected spinnerController: SpinnerController | null = null;
  protected inputBuffer: string = '';
  protected errorMessage: string = '';
  protected progressStep: string = '';
  protected progressCurrent: number = 0;
  protected progressTotal: number = 0;
  protected isGenerating: boolean = false;
  protected screenCols: number;
  protected screenRows: number;

  constructor(stream: Duplex, cols: number = 80, rows: number = 24) {
    this.stream = stream;
    this.screenCols = cols;
    this.screenRows = rows;
    this.ansi = new ANSIBuilder();
  }

  /**
   * Calculate centered X position for a box of given width.
   */
  protected getCenteredX(boxWidth: number): number {
    return Math.max(1, Math.floor((this.screenCols - boxWidth) / 2));
  }

  /**
   * Calculate centered Y position for a box of given height.
   */
  protected getCenteredY(boxHeight: number): number {
    return Math.max(1, Math.floor((this.screenRows - boxHeight) / 2));
  }

  protected write(s: string): void {
    this.stream.write(s);
  }

  /**
   * Fill the background with brand dark color
   * IMPORTANT: Enforces Maldoror dark theme - no system override possible
   */
  protected fillBackground(): void {
    const bg = rgbToAnsiBg(BG_PRIMARY);
    for (let y = 0; y < 30; y++) {
      this.write(ansiMoveTo(y, 0) + bg + ' '.repeat(100));
    }
    this.write(ANSI_RESET);
  }

  /**
   * Draw a box with a title using TUI widgets
   */
  protected drawBox(config: BoxConfig): void {
    const { width, height, startX, startY, title, borderColor, titleColor } = config;

    renderBoxToStream((s) => this.write(s), {
      x: startX,
      y: startY,
      width,
      height,
      borderStyle: 'double',
      borderColor,
      backgroundColor: BG_PRIMARY,
      title,
      titleColor,
    });
  }

  /**
   * Start the spinner animation at specified position
   */
  protected startSpinner(x: number, y: number): void {
    this.stopSpinner();
    this.spinnerController = createSpinner(
      (s) => this.write(s),
      {
        x,
        y,
        style: 'circle',
        color: { r: 255, g: 200, b: 100 },
        backgroundColor: BG_PRIMARY,
      },
      200
    );
    this.spinnerController.start();
  }

  /**
   * Stop the spinner animation
   */
  protected stopSpinner(): void {
    if (this.spinnerController) {
      this.spinnerController.stop();
      this.spinnerController = null;
    }
  }

  /**
   * Wrap text to fit within a maximum width
   */
  protected wrapText(text: string, maxWidth: number): string[] {
    const words = text.split(' ');
    const lines: string[] = [];
    let currentLine = '';

    for (const word of words) {
      if (currentLine.length + word.length + 1 <= maxWidth) {
        currentLine += (currentLine ? ' ' : '') + word;
      } else {
        if (currentLine) lines.push(currentLine);
        currentLine = word;
      }
    }
    if (currentLine) lines.push(currentLine);

    return lines;
  }

  /**
   * Render just the spinner character (for animation updates)
   * Override in subclass to specify position
   */
  protected abstract renderSpinnerOnly(): void;

  /**
   * Clean up resources when closing the screen
   * NOTE: Does NOT remove stream listeners - subclass must do that to avoid
   * removing game session's listener
   */
  protected cleanup(): void {
    this.destroyed = true;
    this.stopSpinner();
    // Don't removeAllListeners('data') here - it would remove game session's listener!
    // Each subclass should remove only its own listener before calling cleanup()
    this.write(
      ANSI_ALTERNATE_SCREEN_OFF +
      ANSI_SHOW_CURSOR +
      ANSI_RESET
    );
  }

  /**
   * Enter the modal screen (alternate buffer, hide cursor, dark background)
   * IMPORTANT: Enforces Maldoror dark theme - no system override possible
   */
  protected enterScreen(): void {
    this.write(
      ANSI_ALTERNATE_SCREEN_ON +
      ANSI_HIDE_CURSOR +
      rgbToAnsiBg(BG_PRIMARY) +
      ANSI_CLEAR_SCREEN
    );
    this.fillBackground();
  }
}
