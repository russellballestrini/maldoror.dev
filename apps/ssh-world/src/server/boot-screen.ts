import type { Duplex } from 'stream';
import {
  renderFullLogoToStream,
  renderBoxToStream,
  renderTextToStream,
  LoadingStepsController,
  LOGO_HEIGHT,
  ANSI_ALTERNATE_SCREEN_ON,
  ANSI_HIDE_CURSOR,
  ANSI_CLEAR_SCREEN,
  ansiMoveTo,
  rgbToAnsiBg,
  ANSI_RESET,
} from '@maldoror/render';

interface OnlinePlayer {
  username: string;
}

// Brand background colors
const BG_PRIMARY = { r: 15, g: 12, b: 18 };
const BORDER_DIM = { r: 80, g: 60, b: 70 };
const TEXT_DIM = { r: 90, g: 75, b: 85 };
const TEXT_MUTED = { r: 100, g: 80, b: 90 };
const TEXT_PLAYERS = { r: 140, g: 110, b: 125 };

/**
 * Boot screen that shows loading progress during connection
 */
export class BootScreen {
  private stream: Duplex;
  private cols: number;
  private rows: number;
  private stepsController: LoadingStepsController | null = null;

  constructor(stream: Duplex, cols: number, rows: number) {
    this.stream = stream;
    this.cols = cols;
    this.rows = rows;
  }

  private write(s: string): void {
    this.stream.write(s);
  }

  /**
   * Show the initial boot screen
   */
  show(): void {
    const write = (s: string) => this.write(s);

    // Enter alternate screen, hide cursor
    write(ANSI_ALTERNATE_SCREEN_ON + ANSI_HIDE_CURSOR);

    // Fill entire screen with brand dark background
    write(rgbToAnsiBg(BG_PRIMARY) + ANSI_CLEAR_SCREEN);
    this.fillBackground();

    // Render logo centered
    renderFullLogoToStream(write, {
      x: 1,
      y: 3,
      centered: true,
      screenWidth: this.cols,
      backgroundColor: BG_PRIMARY,
    });

    // Render progress box
    this.renderProgressBox();
  }

  /**
   * Fill entire screen with brand dark background
   */
  private fillBackground(): void {
    const bg = rgbToAnsiBg(BG_PRIMARY);
    for (let row = 1; row <= Math.max(this.rows, 50); row++) {
      this.write(ansiMoveTo(row, 1) + bg + ' '.repeat(this.cols));
    }
    this.write(ANSI_RESET);
  }

  /**
   * Render the progress box
   */
  private renderProgressBox(): void {
    const boxWidth = 50;
    const boxHeight = 8;
    const startX = Math.floor((this.cols - boxWidth) / 2);
    const startY = 3 + LOGO_HEIGHT + 4; // Below logo and subtitle

    renderBoxToStream((s) => this.write(s), {
      x: startX,
      y: startY,
      width: boxWidth,
      height: boxHeight,
      borderColor: BORDER_DIM,
      backgroundColor: BG_PRIMARY,
    });

    // Create steps controller positioned inside the box
    this.stepsController = new LoadingStepsController(
      (s) => this.write(s),
      startX + 2,
      startY + 1,
      boxWidth - 4,
      BG_PRIMARY
    );
  }

  /**
   * Update loading step with progress message
   */
  updateStep(message: string, status: 'loading' | 'done' | 'error' = 'loading'): void {
    if (!this.stepsController) return;

    if (status === 'loading') {
      this.stepsController.startStep(message);
    } else {
      const index = this.stepsController.getStepCount() - 1;
      if (index >= 0) {
        this.stepsController.updateStep(
          index,
          status === 'done' ? 'done' : 'error'
        );
      }
      // Add the new step with status
      this.stepsController.addStep(message, status);
    }
  }

  /**
   * Mark the previous step as done
   */
  markPreviousDone(): void {
    if (!this.stepsController) return;
    const index = this.stepsController.getStepCount() - 1;
    if (index >= 0) {
      this.stepsController.completeStep(index);
    }
  }

  /**
   * Render the honourable mentions footer with online players
   */
  renderHonourableMentions(players: OnlinePlayer[]): void {
    const startY = 3 + LOGO_HEIGHT + 4 + 10; // Below progress box
    const write = (s: string) => this.write(s);

    // Header
    const header = '─── Honourable Mentions ───';
    renderTextToStream(write, {
      x: 1,
      y: startY,
      text: header,
      color: TEXT_MUTED,
      backgroundColor: BG_PRIMARY,
      align: 'center',
      maxWidth: this.cols,
    });

    if (players.length === 0) {
      renderTextToStream(write, {
        x: 1,
        y: startY + 2,
        text: 'No wanderers currently in the abyss',
        color: TEXT_DIM,
        backgroundColor: BG_PRIMARY,
        align: 'center',
        maxWidth: this.cols,
      });
    } else {
      // Show online players
      const names = players.map(p => p.username).join('  ·  ');
      const truncated = names.length > this.cols - 10
        ? names.slice(0, this.cols - 13) + '...'
        : names;

      renderTextToStream(write, {
        x: 1,
        y: startY + 2,
        text: truncated,
        color: TEXT_PLAYERS,
        backgroundColor: BG_PRIMARY,
        align: 'center',
        maxWidth: this.cols,
      });
    }
  }

  /**
   * Start the spinner animation for current step
   * (Now handled by LoadingStepsController automatically)
   */
  startSpinner(): void {
    // Spinner is automatically started by LoadingStepsController
  }

  /**
   * Stop the spinner
   */
  stopSpinner(): void {
    // Handled by stepsController when status changes
  }

  /**
   * Hide the boot screen and transition to game
   */
  hide(): void {
    this.stepsController?.destroy();
  }

  /**
   * Clean up resources
   */
  destroy(): void {
    this.stepsController?.destroy();
    this.stepsController = null;
  }
}
