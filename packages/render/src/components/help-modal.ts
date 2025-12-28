import type { ParsedKey } from '../input/key-parser.js';
import { ModalComponent } from './modal-component.js';
import type { InputResult } from './component.js';
import {
  renderKeyValueListToBuffer,
  renderKeyboardHintsToBuffer,
  type KeyValuePair,
} from '../tui/index.js';

/**
 * Help modal component showing keyboard controls.
 */
export class HelpModalComponent extends ModalComponent {
  private commands: KeyValuePair[] = [
    { key: '← ↑ → ↓ / WASD', value: 'Move your character' },
    { key: '+ / -', value: 'Zoom in / out' },
    { key: '[ / ]', value: 'Rotate camera' },
    { key: 'V', value: 'Cycle render mode' },
    { key: 'C', value: 'Toggle camera mode' },
    { key: 'H / Home', value: 'Snap camera to player' },
    { key: 'Shift + Arrows', value: 'Pan camera (free mode)' },
    { key: 'Tab', value: 'Show player list' },
    { key: '`', value: 'Toggle chat panel' },
    { key: 'T / Enter', value: 'Start typing in chat' },
    { key: '.', value: 'Edit your avatar' },
    { key: 'B', value: 'Place a building' },
    { key: 'N', value: 'Create an NPC' },
    { key: 'Q', value: 'Quit game' },
    { key: '?', value: 'Show this help' },
  ];

  constructor(screenCols: number, screenRows: number) {
    const width = 56;
    const height = 21; // commands.length + 6

    super({
      id: 'help-modal',
      bounds: ModalComponent.createCentered('help-modal', width, height, screenCols, screenRows),
      zIndex: 1000,
      title: ' KEYBOARD CONTROLS ',
      borderColor: { type: 'rgb', value: [100, 120, 180] },
      backgroundColor: { type: 'rgb', value: [25, 25, 35] },
    });
  }

  /**
   * Render the help modal content.
   */
  render(): void {
    // Render frame (background + border)
    this.renderFrame();

    // Command list starts at y=2 (after border + title)
    renderKeyValueListToBuffer(this.buffer, {
      x: 2,
      y: 2,
      pairs: this.commands,
      keyWidth: 18,
      keyColor: { r: 120, g: 200, b: 255 },
      valueColor: { r: 200, g: 200, b: 210 },
      backgroundColor: { r: 25, g: 25, b: 35 },
    });

    // Footer hint using TUI widget
    const hintY = this.bounds.height - 2;
    const hintText = 'Press ESC or ? to close';
    const hintX = Math.floor((this.bounds.width - hintText.length) / 2);

    renderKeyboardHintsToBuffer(this.buffer, {
      x: hintX,
      y: hintY,
      hints: [
        { key: 'ESC', action: 'or', type: 'secondary' },
        { key: '?', action: 'to close', type: 'secondary' },
      ],
      keyColor: { r: 150, g: 150, b: 170 },
      primaryActionColor: { r: 150, g: 150, b: 170 },
      secondaryActionColor: { r: 150, g: 150, b: 170 },
      backgroundColor: { r: 25, g: 25, b: 35 },
    });

    this.clearDirty();
  }

  /**
   * Handle input - ESC or ? closes the modal.
   */
  handleInput(event: ParsedKey): InputResult {
    console.log('[HelpModal] handleInput:', event.type, event.key);
    if (event.type === 'key') {
      // ESC or ? closes the help modal
      if (event.key === 'Escape' || event.key === '?') {
        console.log('[HelpModal] Closing via', event.key);
        this.requestClose();
        return { handled: true, stopPropagation: true };
      }
    }
    // Block all other input (modal behavior)
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
