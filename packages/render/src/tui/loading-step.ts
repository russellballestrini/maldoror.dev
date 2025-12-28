/**
 * Loading Step Widget
 *
 * Renders a loading step with status icon and message.
 * Used for boot screens and loading progress displays.
 */

import {
  type RGB,
  rgbToAnsiFg,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
} from './types.js';

/**
 * Status of a loading step.
 */
export type LoadingStepStatus = 'pending' | 'loading' | 'done' | 'error';

/**
 * Icons for each status.
 */
export const STATUS_ICONS: Record<LoadingStepStatus, string> = {
  pending: '○',
  loading: '◦',
  done: '✓',
  error: '✗',
};

/**
 * Default colors for each status.
 */
export const STATUS_COLORS: Record<LoadingStepStatus, RGB> = {
  pending: { r: 60, g: 55, b: 65 },
  loading: { r: 180, g: 140, b: 100 },
  done: { r: 120, g: 180, b: 120 },
  error: { r: 180, g: 80, b: 80 },
};

/**
 * Text colors for each status.
 */
export const TEXT_COLORS: Record<LoadingStepStatus, RGB> = {
  pending: { r: 90, g: 85, b: 95 },
  loading: { r: 160, g: 150, b: 155 },
  done: { r: 100, g: 95, b: 100 },
  error: { r: 180, g: 80, b: 80 },
};

export interface LoadingStepConfig {
  x: number;
  y: number;
  message: string;
  status: LoadingStepStatus;
  statusColor?: RGB;
  textColor?: RGB;
  backgroundColor?: RGB;
  maxWidth?: number;
}

/**
 * Render a loading step to a stream.
 */
export function renderLoadingStepToStream(
  write: (s: string) => void,
  config: LoadingStepConfig
): void {
  const {
    x,
    y,
    message,
    status,
    statusColor = STATUS_COLORS[status],
    textColor = TEXT_COLORS[status],
    backgroundColor,
    maxWidth,
  } = config;

  const icon = STATUS_ICONS[status];
  const displayMessage = maxWidth && message.length > maxWidth - 4
    ? message.slice(0, maxWidth - 7) + '...'
    : message;

  let output = ansiMoveTo(y, x);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }

  // Icon with color
  output += '  ' + rgbToAnsiFg(statusColor) + icon;

  // Message with color
  output += ' ' + rgbToAnsiFg(textColor) + displayMessage;

  // Pad to maxWidth if specified
  if (maxWidth) {
    const currentLen = 4 + displayMessage.length; // "  X message"
    const padding = maxWidth - currentLen;
    if (padding > 0) {
      output += ' '.repeat(padding);
    }
  }

  output += ANSI_RESET;
  write(output);
}

/**
 * Update just the icon of a loading step (for spinner animation).
 */
export function updateLoadingStepIconToStream(
  write: (s: string) => void,
  x: number,
  y: number,
  icon: string,
  color: RGB,
  backgroundColor?: RGB
): void {
  let output = ansiMoveTo(y, x + 2);
  if (backgroundColor) {
    output += rgbToAnsiBg(backgroundColor);
  }
  output += rgbToAnsiFg(color) + icon + ANSI_RESET;
  write(output);
}

/**
 * Loading step manager for managing multiple steps.
 */
export interface LoadingStep {
  message: string;
  status: LoadingStepStatus;
}

export class LoadingStepsController {
  private steps: LoadingStep[] = [];
  private x: number;
  private startY: number;
  private maxWidth: number;
  private write: (s: string) => void;
  private backgroundColor?: RGB;
  private currentSpinnerStep: number = -1;
  private spinnerFrame: number = 0;
  private spinnerInterval: ReturnType<typeof setInterval> | null = null;
  private spinnerChars = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(
    write: (s: string) => void,
    x: number,
    startY: number,
    maxWidth: number = 50,
    backgroundColor?: RGB
  ) {
    this.write = write;
    this.x = x;
    this.startY = startY;
    this.maxWidth = maxWidth;
    this.backgroundColor = backgroundColor;
  }

  /**
   * Add a new step.
   */
  addStep(message: string, status: LoadingStepStatus = 'pending'): number {
    const index = this.steps.length;
    this.steps.push({ message, status });
    this.renderStep(index);
    return index;
  }

  /**
   * Update a step's status.
   */
  updateStep(index: number, status: LoadingStepStatus): void {
    if (index >= 0 && index < this.steps.length) {
      this.steps[index]!.status = status;

      // Stop spinner if step is no longer loading
      if (status !== 'loading' && this.currentSpinnerStep === index) {
        this.stopSpinner();
      }

      // Start spinner if step is loading
      if (status === 'loading') {
        this.startSpinner(index);
      }

      this.renderStep(index);
    }
  }

  /**
   * Start a step (mark as loading).
   */
  startStep(message: string): number {
    const index = this.addStep(message, 'loading');
    this.startSpinner(index);
    return index;
  }

  /**
   * Complete the current loading step and start the next one.
   */
  completeAndNext(nextMessage: string): number {
    if (this.currentSpinnerStep >= 0) {
      this.updateStep(this.currentSpinnerStep, 'done');
    }
    return this.startStep(nextMessage);
  }

  /**
   * Mark a step as done.
   */
  completeStep(index: number): void {
    this.updateStep(index, 'done');
  }

  /**
   * Mark a step as error.
   */
  errorStep(index: number): void {
    this.updateStep(index, 'error');
  }

  /**
   * Render a specific step.
   */
  private renderStep(index: number): void {
    const step = this.steps[index];
    if (!step) return;

    renderLoadingStepToStream(this.write, {
      x: this.x,
      y: this.startY + index,
      message: step.message,
      status: step.status,
      backgroundColor: this.backgroundColor,
      maxWidth: this.maxWidth,
    });
  }

  /**
   * Render all steps.
   */
  renderAll(): void {
    for (let i = 0; i < this.steps.length; i++) {
      this.renderStep(i);
    }
  }

  /**
   * Start spinner animation for a step.
   */
  private startSpinner(index: number): void {
    this.stopSpinner();
    this.currentSpinnerStep = index;
    this.spinnerFrame = 0;

    this.spinnerInterval = setInterval(() => {
      this.spinnerFrame = (this.spinnerFrame + 1) % this.spinnerChars.length;
      updateLoadingStepIconToStream(
        this.write,
        this.x,
        this.startY + index,
        this.spinnerChars[this.spinnerFrame]!,
        STATUS_COLORS.loading,
        this.backgroundColor
      );
    }, 80);
  }

  /**
   * Stop spinner animation.
   */
  private stopSpinner(): void {
    if (this.spinnerInterval) {
      clearInterval(this.spinnerInterval);
      this.spinnerInterval = null;
    }
    this.currentSpinnerStep = -1;
  }

  /**
   * Get current step count.
   */
  getStepCount(): number {
    return this.steps.length;
  }

  /**
   * Destroy the controller.
   */
  destroy(): void {
    this.stopSpinner();
  }
}
