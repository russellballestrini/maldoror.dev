import type { Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { ModalComponent } from './modal-component.js';
import type { InputResult } from './component.js';

/**
 * Reload overlay component showing during hot reload.
 * This is a non-dismissible overlay that blocks all input.
 */
export class ReloadOverlayComponent extends ModalComponent {
  private spinnerFrames = ['◐', '◓', '◑', '◒'];
  private spinnerIndex = 0;
  private lastSpinnerUpdate = 0;
  private spinnerInterval = 200; // ms

  private textColor: Cell['fg'] = { type: 'rgb', value: [255, 200, 100] };
  private subTextColor: Cell['fg'] = { type: 'rgb', value: [150, 150, 170] };

  constructor(screenCols: number, screenRows: number) {
    const width = 40;
    const height = 7;

    super({
      id: 'reload-overlay',
      bounds: ModalComponent.createCentered('reload-overlay', width, height, screenCols, screenRows),
      zIndex: 2000, // Higher than other modals
      borderColor: { type: 'rgb', value: [100, 100, 150] },
      backgroundColor: { type: 'rgb', value: [20, 20, 35] },
    });
  }

  /**
   * Update spinner animation.
   */
  update(deltaMs: number): void {
    this.lastSpinnerUpdate += deltaMs;

    if (this.lastSpinnerUpdate >= this.spinnerInterval) {
      this.spinnerIndex = (this.spinnerIndex + 1) % this.spinnerFrames.length;
      this.lastSpinnerUpdate = 0;
      this.markDirty();
    }
  }

  /**
   * Render the reload overlay.
   */
  render(): void {
    // Render frame
    this.renderFrame();

    // Main message with spinner
    const spinner = this.spinnerFrames[this.spinnerIndex]!;
    const message = `${spinner} Updating Server...`;
    this.writeCentered(2, message, this.textColor);

    // Sub message
    this.writeCentered(4, 'Please wait...', this.subTextColor);

    this.clearDirty();
  }

  /**
   * Handle input - block everything during reload.
   */
  handleInput(_event: ParsedKey): InputResult {
    // Cannot dismiss reload overlay
    return { handled: true, stopPropagation: true };
  }

  /**
   * Update screen dimensions and recenter.
   */
  updateScreenSize(cols: number, rows: number): void {
    const newBounds = ModalComponent.createCentered(
      this.id,
      this.bounds.width,
      this.bounds.height,
      cols,
      rows
    );
    this.resize(newBounds);
  }
}
