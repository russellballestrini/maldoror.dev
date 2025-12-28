import type { Duplex } from 'stream';
import {
  BG_PRIMARY,
  type RGB,
  rgbToAnsiBg,
  ansiMoveTo,
  ANSI_RESET,
  ANSI_HIDE_CURSOR,
  ANSI_SHOW_CURSOR,
  ANSI_CLEAR_SCREEN,
  renderInputBoxToStream,
  updateInputValueToStream,
  renderKeyboardHintsToStream,
  renderListToStream,
  renderProgressBarToStream,
  renderTextToStream,
} from '@maldoror/render';
import { BaseModalScreen } from './base-modal-screen.js';

const GENERATION_TIMEOUT = 1200000; // 20 minutes

/**
 * Configuration for the generation modal
 */
export interface GenerationModalConfig {
  title: string;
  boxWidth: number;
  boxHeight: number;
  startX: number;
  startY: number;
  borderColor: RGB;
  titleColor: RGB;
  inputPromptText: string;
  examples: string[];
  maxInputLength: number;
  progressTotal: number;
  generatingMessage: string;
}

/**
 * Result from a generation modal
 */
export interface GenerationResult<T> {
  action: 'confirm' | 'cancel';
  result?: T;
  prompt?: string;
}

/**
 * Generation function result (from AI generation)
 */
export interface GenerationOutput<T> {
  success: boolean;
  result?: T;
  error?: string;
}

/**
 * Progress callback signature
 */
export type ProgressCallback = (step: string, current: number, total: number) => void;

/**
 * Abstract base class for generation modals (avatar, building, NPC)
 * Handles common patterns: input, progress, preview, error states
 */
export abstract class GenerationModalScreen<T> extends BaseModalScreen {
  protected prompt: string = '';
  protected generatedResult: T | null = null;
  private dataListener: ((data: Buffer) => void) | null = null;
  private resolvePromise: ((result: GenerationResult<T>) => void) | null = null;
  private spinnerX: number = 0;
  private spinnerY: number = 0;

  constructor(stream: Duplex, cols: number = 80, rows: number = 24) {
    super(stream, cols, rows);
  }

  /**
   * Get centered config with startX and startY calculated from screen dimensions.
   */
  protected getCenteredConfig(): GenerationModalConfig {
    const config = this.getConfig();
    return {
      ...config,
      startX: this.getCenteredX(config.boxWidth),
      startY: this.getCenteredY(config.boxHeight),
    };
  }

  /**
   * Get the configuration for this modal
   */
  protected abstract getConfig(): GenerationModalConfig;

  /**
   * Run the generation with the given prompt
   */
  protected abstract generate(prompt: string, onProgress: ProgressCallback): Promise<GenerationOutput<T>>;

  /**
   * Render the preview of the generated result
   */
  protected abstract renderPreview(): void;

  /**
   * Get additional info to show in input state (optional)
   */
  protected getAdditionalInputInfo(): string[] {
    return [];
  }

  /**
   * Get the confirm button text
   */
  protected getConfirmButtonText(): string {
    return 'Confirm';
  }

  /**
   * Run the modal and return the result
   */
  async run(): Promise<GenerationResult<T>> {
    this.enterScreen();
    this.render();

    return new Promise((resolve) => {
      this.resolvePromise = resolve;

      this.dataListener = async (data: Buffer) => {
        if (this.destroyed) return;

        // Skip escape sequences (arrow keys, etc)
        if (data[0] === 0x1b && data.length > 1) {
          return;
        }

        // Handle Escape key (single ESC byte)
        if (data[0] === 0x1b && data.length === 1) {
          this.finish({ action: 'cancel' });
          return;
        }

        // Handle Ctrl+C
        if (data[0] === 0x03) {
          this.finish({ action: 'cancel' });
          return;
        }

        const byte = data[0]!;
        const config = this.getCenteredConfig();

        if (this.state === 'input') {
          if (byte === 0x0d || byte === 0x0a) {
            // Enter - start generation
            if (this.inputBuffer.trim().length > 0) {
              this.prompt = this.inputBuffer.trim();
              await this.startGeneration();
            }
          } else if (byte === 0x7f || byte === 0x08) {
            // Backspace
            if (this.inputBuffer.length > 0) {
              this.inputBuffer = this.inputBuffer.slice(0, -1);
              this.renderInputOnly();
            }
          } else if (byte >= 0x20 && byte < 0x7f) {
            // Printable character
            if (this.inputBuffer.length < config.maxInputLength) {
              this.inputBuffer += String.fromCharCode(byte);
              this.renderInputOnly();
            }
          }
        } else if (this.state === 'preview') {
          if (byte === 0x0d || byte === 0x0a) {
            // Enter - confirm
            this.finish({
              action: 'confirm',
              result: this.generatedResult!,
              prompt: this.prompt,
            });
            return;
          }
        }
      };

      this.stream.on('data', this.dataListener);
    });
  }

  /**
   * Clean finish - remove only our listener and resolve
   */
  protected finish(result: GenerationResult<T>): void {
    if (this.dataListener) {
      this.stream.removeListener('data', this.dataListener);
      this.dataListener = null;
    }
    this.cleanup();
    this.resolvePromise?.(result);
    this.resolvePromise = null;
  }

  /**
   * Start the generation process
   */
  private async startGeneration(): Promise<void> {
    if (this.isGenerating) return;
    this.isGenerating = true;

    const config = this.getCenteredConfig();
    const startTime = Date.now();

    this.state = 'generating';
    this.progressTotal = config.progressTotal;

    // Calculate spinner position
    this.spinnerX = config.startX + 3;
    this.spinnerY = config.startY + 13;
    this.startSpinner(this.spinnerX, this.spinnerY);

    this.render();

    try {
      const output = await Promise.race([
        this.generate(this.prompt, (step, current, total) => {
          this.progressStep = step;
          this.progressCurrent = current;
          this.progressTotal = total;
          this.renderGeneratingState();
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Generation timed out after 20 minutes')), GENERATION_TIMEOUT)
        ),
      ]);

      const elapsed = Math.round((Date.now() - startTime) / 1000);

      if (output.success && output.result) {
        this.generatedResult = output.result;
        this.state = 'preview';
        console.log(`[${config.title}] Generation complete in ${elapsed}s`);
        this.stopSpinner();
        this.isGenerating = false;
        this.render();
      } else {
        const errorMsg = output.error || 'Unknown error occurred';
        console.log(`[${config.title}] Generation failed after ${elapsed}s:`, errorMsg);
        this.stopSpinner();
        this.isGenerating = false;
        this.finish({ action: 'cancel' });
      }
    } catch (error) {
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[${config.title}] Generation exception after ${elapsed}s:`, errorMsg);
      this.stopSpinner();
      this.isGenerating = false;
      this.finish({ action: 'cancel' });
    }
  }

  protected renderSpinnerOnly(): void {
    // Spinner is handled by SpinnerController now
  }

  private render(): void {
    this.write(
      rgbToAnsiBg(BG_PRIMARY) +
      ANSI_CLEAR_SCREEN +
      ansiMoveTo(0, 0)
    );
    this.fillBackground();
    this.drawModalBox();
    this.clearModalContent();

    switch (this.state) {
      case 'input':
        this.renderInputState();
        break;
      case 'generating':
        this.renderGeneratingState();
        break;
      case 'preview':
        this.renderPreviewState();
        break;
      case 'error':
        this.renderErrorState();
        break;
    }
  }

  private drawModalBox(): void {
    const config = this.getCenteredConfig();
    super.drawBox({
      width: config.boxWidth,
      height: config.boxHeight,
      startX: config.startX,
      startY: config.startY,
      title: config.title,
      borderColor: config.borderColor,
      titleColor: config.titleColor,
    });
  }

  private clearModalContent(): void {
    const config = this.getCenteredConfig();
    const contentWidth = config.boxWidth - 4;
    const bg = rgbToAnsiBg(BG_PRIMARY);
    for (let y = config.startY + 1; y < config.startY + config.boxHeight - 1; y++) {
      this.write(ansiMoveTo(y, config.startX + 2) + bg + ' '.repeat(contentWidth));
    }
    this.write(ANSI_RESET);
  }

  private renderInputState(): void {
    const config = this.getCenteredConfig();
    const x = config.startX + 3;
    const inputWidth = config.boxWidth - 10;

    // Instructions
    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 3,
      text: config.inputPromptText,
      color: { r: 180, g: 180, b: 180 },
      backgroundColor: BG_PRIMARY,
    });

    // Input box
    renderInputBoxToStream((s) => this.write(s), {
      x,
      y: config.startY + 5,
      width: inputWidth + 2,
      value: this.inputBuffer,
      placeholder: 'Type your description...',
      borderColor: { r: 80, g: 80, b: 100 },
      backgroundColor: BG_PRIMARY,
      textColor: { r: 255, g: 255, b: 255 },
      placeholderColor: { r: 80, g: 80, b: 100 },
      cursorVisible: true,
    });

    // Examples
    renderListToStream((s) => this.write(s), {
      x,
      y: config.startY + 10,
      items: config.examples,
      style: 'dash',
      headerText: 'Examples:',
      headerColor: { r: 100, g: 100, b: 120 },
      bulletColor: { r: 100, g: 100, b: 120 },
      itemColor: { r: 100, g: 100, b: 120 },
      backgroundColor: BG_PRIMARY,
    });

    // Additional info
    const additionalInfo = this.getAdditionalInputInfo();
    if (additionalInfo.length > 0) {
      const infoStartY = config.startY + 11 + config.examples.length + 1;
      renderListToStream((s) => this.write(s), {
        x,
        y: infoStartY,
        items: additionalInfo,
        style: 'none',
        itemColor: { r: 150, g: 150, b: 100 },
        backgroundColor: BG_PRIMARY,
        indent: 0,
      });
    }

    // Controls
    renderKeyboardHintsToStream((s) => this.write(s), {
      x,
      y: config.startY + config.boxHeight - 3,
      hints: [
        { key: 'Enter', action: 'Generate', type: 'primary' },
        { key: 'Esc', action: 'Cancel', type: 'danger' },
      ],
      backgroundColor: BG_PRIMARY,
    });

    // Show cursor in input
    const displayLen = Math.min(this.inputBuffer.length, inputWidth - 4);
    this.write(ansiMoveTo(config.startY + 6, x + 1 + displayLen) + ANSI_SHOW_CURSOR);
  }

  private renderInputOnly(): void {
    const config = this.getCenteredConfig();
    const x = config.startX + 3;
    const inputWidth = config.boxWidth - 10;

    updateInputValueToStream(
      (s) => this.write(s),
      x,
      config.startY + 5,
      inputWidth,
      this.inputBuffer,
      { r: 255, g: 255, b: 255 },
      BG_PRIMARY
    );
  }

  protected renderGeneratingState(): void {
    const config = this.getCenteredConfig();
    const x = config.startX + 3;

    const progressText = this.progressCurrent > 0
      ? `Generating [${this.progressCurrent}/${this.progressTotal}]`
      : 'Generating...';

    // Progress text
    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 4,
      text: progressText.padEnd(40),
      color: { r: 180, g: 180, b: 180 },
      backgroundColor: BG_PRIMARY,
    });

    // Current step
    if (this.progressStep) {
      renderTextToStream((s) => this.write(s), {
        x,
        y: config.startY + 6,
        text: this.progressStep.padEnd(50),
        color: { r: 255, g: 200, b: 100 },
        backgroundColor: BG_PRIMARY,
      });
    }

    // Progress bar
    const barWidth = Math.min(config.boxWidth - 12, 50);
    renderProgressBarToStream((s) => this.write(s), {
      x,
      y: config.startY + 8,
      width: barWidth + 2,
      progress: this.progressTotal > 0 ? this.progressCurrent / this.progressTotal : 0,
      style: 'block',
      filledColor: { r: 100, g: 180, b: 100 },
      emptyColor: { r: 60, g: 55, b: 65 },
      backgroundColor: BG_PRIMARY,
      brackets: true,
      bracketColor: { r: 100, g: 180, b: 100 },
    });

    // Prompt display
    const maxPromptLen = config.boxWidth - 15;
    const truncatedPrompt = this.prompt.length > maxPromptLen
      ? this.prompt.slice(0, maxPromptLen - 3) + '...'
      : this.prompt;

    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 11,
      text: `"${truncatedPrompt}"`,
      color: { r: 100, g: 100, b: 120 },
      backgroundColor: BG_PRIMARY,
    });

    // Generating message
    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 15,
      text: config.generatingMessage,
      color: { r: 100, g: 100, b: 120 },
      backgroundColor: BG_PRIMARY,
    });

    this.write(ANSI_HIDE_CURSOR);
  }

  private renderPreviewState(): void {
    const config = this.getCenteredConfig();
    const x = config.startX + 3;

    // Success message
    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 2,
      text: 'Generated successfully!',
      color: { r: 100, g: 200, b: 100 },
      backgroundColor: BG_PRIMARY,
    });

    // Call abstract preview rendering
    this.renderPreview();

    // Controls
    renderKeyboardHintsToStream((s) => this.write(s), {
      x,
      y: config.startY + config.boxHeight - 3,
      hints: [
        { key: 'Enter', action: this.getConfirmButtonText(), type: 'primary' },
        { key: 'Esc', action: 'Cancel', type: 'danger' },
      ],
      backgroundColor: BG_PRIMARY,
    });

    this.write(ANSI_HIDE_CURSOR);
  }

  private renderErrorState(): void {
    const config = this.getCenteredConfig();
    const x = config.startX + 3;

    renderTextToStream((s) => this.write(s), {
      x,
      y: config.startY + 8,
      text: 'Generation failed',
      color: { r: 255, g: 100, b: 100 },
      backgroundColor: BG_PRIMARY,
    });

    const errorLines = this.wrapText(this.errorMessage, config.boxWidth - 10);
    for (let i = 0; i < Math.min(errorLines.length, 3); i++) {
      renderTextToStream((s) => this.write(s), {
        x,
        y: config.startY + 10 + i,
        text: errorLines[i]!,
        color: { r: 180, g: 100, b: 100 },
        backgroundColor: BG_PRIMARY,
      });
    }

    // Controls
    renderKeyboardHintsToStream((s) => this.write(s), {
      x,
      y: config.startY + config.boxHeight - 3,
      hints: [
        { key: 'Esc', action: 'Cancel', type: 'danger' },
      ],
      backgroundColor: BG_PRIMARY,
    });

    this.write(ANSI_HIDE_CURSOR);
  }
}
