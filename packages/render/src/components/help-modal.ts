import type { Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { ModalComponent } from './modal-component.js';
import type { InputResult } from './component.js';

/**
 * Help command entry
 */
interface HelpCommand {
  key: string;
  desc: string;
}

/**
 * Help modal component showing keyboard controls.
 */
export class HelpModalComponent extends ModalComponent {
  private commands: HelpCommand[] = [
    { key: '← ↑ → ↓ / WASD', desc: 'Move your character' },
    { key: '+ / -', desc: 'Zoom in / out' },
    { key: '[ / ]', desc: 'Rotate camera' },
    { key: 'V', desc: 'Cycle render mode' },
    { key: 'C', desc: 'Toggle camera mode' },
    { key: 'H / Home', desc: 'Snap camera to player' },
    { key: 'Shift + Arrows', desc: 'Pan camera (free mode)' },
    { key: 'Tab', desc: 'Show player list' },
    { key: 'R', desc: 'Edit your avatar' },
    { key: 'B', desc: 'Place a building' },
    { key: 'Q', desc: 'Quit game' },
    { key: '?', desc: 'Show this help' },
  ];

  private keyColor: Cell['fg'] = { type: 'rgb', value: [120, 200, 255] };
  private descColor: Cell['fg'] = { type: 'rgb', value: [200, 200, 210] };
  private hintColor: Cell['fg'] = { type: 'rgb', value: [150, 150, 170] };

  constructor(screenCols: number, screenRows: number) {
    const width = 56;
    const height = 18; // commands.length + 6

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

    // Empty row after title
    // (border is at y=0, title area is handled by renderFrame)

    // Command list starts at y=2 (after border + title)
    const startY = 2;

    for (let i = 0; i < this.commands.length; i++) {
      const cmd = this.commands[i]!;
      const y = startY + i;

      // Key column (padded to 18 chars)
      const keyText = cmd.key.padEnd(18);
      this.buffer.writeText(2, y, keyText, this.keyColor, this.backgroundColor);

      // Description column
      this.buffer.writeText(20, y, cmd.desc, this.descColor, this.backgroundColor);
    }

    // Footer hint
    const hintY = this.bounds.height - 2;
    this.writeCentered(hintY, 'Press ESC or ? to close', this.hintColor);

    this.clearDirty();
  }

  /**
   * Handle input - ESC or ? closes the modal.
   */
  handleInput(event: ParsedKey): InputResult {
    if (event.type === 'key') {
      // ESC or ? closes the help modal
      if (event.key === 'Escape' || event.key === '?') {
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
