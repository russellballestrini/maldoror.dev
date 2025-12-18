import type { Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { ModalComponent } from './modal-component.js';
import type { InputResult } from './component.js';

/**
 * Player info for display in the list
 */
export interface PlayerInfo {
  userId: string;
  username: string;
  x: number;
  y: number;
  isOnline?: boolean;
}

/**
 * Player list modal component showing online players.
 */
export class PlayerListComponent extends ModalComponent {
  private players: PlayerInfo[] = [];
  private currentUserId: string | null = null;

  private headerColor: Cell['fg'] = { type: 'rgb', value: [255, 200, 100] };
  private textColor: Cell['fg'] = { type: 'rgb', value: [200, 200, 200] };
  private selfColor: Cell['fg'] = { type: 'rgb', value: [100, 255, 150] };
  private hintColor: Cell['fg'] = { type: 'rgb', value: [150, 150, 170] };

  constructor(screenCols: number, screenRows: number) {
    const width = 50;
    const height = 20;

    super({
      id: 'player-list',
      bounds: ModalComponent.createCentered('player-list', width, height, screenCols, screenRows),
      zIndex: 1000,
      title: ' PLAYERS ONLINE ',
      borderColor: { type: 'rgb', value: [100, 100, 150] },
      backgroundColor: { type: 'rgb', value: [20, 20, 35] },
    });
  }

  /**
   * Update the player list data.
   */
  setPlayers(players: PlayerInfo[], currentUserId: string | null): void {
    this.players = players;
    this.currentUserId = currentUserId;
    this.markDirty();
  }

  /**
   * Render the player list.
   */
  render(): void {
    // Render frame
    this.renderFrame();

    // Update title with count
    const titleText = ` PLAYERS ONLINE (${this.players.length}) `;
    this.writeCentered(0, titleText, this.headerColor);

    // Column headers at y=2
    const headerY = 2;
    this.writeText(2, headerY, 'Name'.padEnd(20), this.headerColor);
    this.writeText(22, headerY, 'Position'.padEnd(16), this.headerColor);

    // Divider
    this.drawDivider(3);

    // Player rows starting at y=4
    const maxPlayers = Math.min(this.players.length, this.bounds.height - 7);
    for (let i = 0; i < maxPlayers; i++) {
      const player = this.players[i]!;
      const isSelf = player.userId === this.currentUserId;
      const color = isSelf ? this.selfColor : this.textColor;

      const y = 4 + i;

      // Name with indicator for self
      const prefix = isSelf ? '► ' : '  ';
      const name = prefix + player.username.slice(0, 16).padEnd(18);
      this.writeText(1, y, name, color);

      // Position
      const pos = `(${player.x}, ${player.y})`.padEnd(16);
      this.writeText(21, y, pos, color);
    }

    // Fill remaining rows with empty space
    for (let i = maxPlayers; i < this.bounds.height - 7; i++) {
      const y = 4 + i;
      this.writeText(1, y, ' '.repeat(this.getInnerWidth()), this.textColor);
    }

    // Footer hint
    const hintY = this.bounds.height - 2;
    this.writeCentered(hintY, 'Press TAB or ESC to close', this.hintColor);

    this.clearDirty();
  }

  /**
   * Handle input - Tab or ESC closes the modal.
   */
  handleInput(event: ParsedKey): InputResult {
    if (event.type === 'key') {
      if (event.key === 'Escape' || event.key === 'Tab') {
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
