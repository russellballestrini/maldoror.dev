/**
 * Chat Component
 *
 * A sidebar chat panel for the SSH terminal game that displays:
 * - Chat messages with username, position, and badges
 * - NPC actions (configurable)
 * - System events (births, deaths, etc.)
 *
 * Features:
 * - Input mode for typing messages
 * - Scrolling support
 * - Color-coded usernames
 * - Badge system for player/NPC distinction
 */

import type { ParsedKey } from '../input/key-parser.js';
import { Component, type ComponentConfig, type InputResult } from './component.js';

/**
 * Entry in the chat timeline
 */
export interface ChatEntry {
  id: string;
  actorId: string;
  actorName: string;
  actorType: 'player' | 'npc' | 'bot';
  type: 'chat' | 'action' | 'event';
  message: string;
  position?: { x: number; y: number };
  timestamp: Date;
}

/**
 * Configuration for ChatComponent
 */
export interface ChatComponentConfig extends ComponentConfig {
  /** Show NPC actions in the timeline (default: true) */
  showActions?: boolean;
  /** Current user's ID for highlighting own messages */
  currentUserId?: string;
  /** Max entries to keep in buffer (default: 100) */
  maxEntries?: number;
  /** Callback when user sends a message */
  onSendMessage?: (message: string) => void;
}

/**
 * Chat panel component for the game sidebar
 */
export class ChatComponent extends Component {
  private entries: ChatEntry[] = [];
  private scrollOffset: number = 0;
  private inputBuffer: string = '';
  private inputActive: boolean = false;
  private showActions: boolean;
  private currentUserId?: string;
  private maxEntries: number;
  private onSendMessage?: (message: string) => void;
  private lastSeenEntryId?: string;

  constructor(config: ChatComponentConfig) {
    super({
      ...config,
      visible: config.visible ?? true,
      focusable: true,
    });

    this.showActions = config.showActions ?? true;
    this.currentUserId = config.currentUserId;
    this.maxEntries = config.maxEntries ?? 100;
    this.onSendMessage = config.onSendMessage;
  }

  /**
   * Set the current user ID for highlighting
   */
  setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
    this.needsRedraw = true;
  }

  /**
   * Add a single entry to the chat
   */
  addEntry(entry: ChatEntry): void {
    // Skip actions if showActions is false
    if (!this.showActions && entry.type === 'action') {
      return;
    }

    this.entries.push(entry);

    // Trim to max size
    while (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    // Auto-scroll to bottom if we're already near the bottom
    const contentHeight = this.getContentHeight();
    const viewHeight = this.bounds.height - 4; // -2 border, -2 input area
    const maxScroll = Math.max(0, contentHeight - viewHeight);

    if (this.scrollOffset >= maxScroll - 2) {
      this.scrollOffset = Math.max(0, contentHeight - viewHeight);
    }

    this.needsRedraw = true;
  }

  /**
   * Bulk update entries (for polling from server)
   */
  updateEntries(entries: ChatEntry[]): void {
    // Find new entries we haven't seen
    const lastSeen = this.lastSeenEntryId;
    let foundNew = false;

    for (const entry of entries) {
      if (lastSeen && entry.id <= lastSeen) continue;

      // Skip actions if disabled
      if (!this.showActions && entry.type === 'action') continue;

      // Check if we already have this entry
      const exists = this.entries.some(e => e.id === entry.id);
      if (!exists) {
        this.entries.push(entry);
        foundNew = true;
      }
    }

    if (entries.length > 0) {
      this.lastSeenEntryId = entries[entries.length - 1]!.id;
    }

    if (foundNew) {
      // Trim to max size
      while (this.entries.length > this.maxEntries) {
        this.entries.shift();
      }

      // Auto-scroll to bottom
      const contentHeight = this.getContentHeight();
      const viewHeight = this.bounds.height - 4;
      const maxScroll = Math.max(0, contentHeight - viewHeight);
      if (this.scrollOffset >= maxScroll - 2) {
        this.scrollOffset = Math.max(0, contentHeight - viewHeight);
      }

      this.needsRedraw = true;
    }
  }

  /**
   * Toggle action visibility
   */
  toggleShowActions(): void {
    this.showActions = !this.showActions;
    this.needsRedraw = true;
  }

  /**
   * Check if input mode is active
   */
  isInputActive(): boolean {
    return this.inputActive;
  }

  /**
   * Activate input mode
   */
  activateInput(): void {
    this.inputActive = true;
    this.needsRedraw = true;
  }

  /**
   * Deactivate input mode
   */
  deactivateInput(): void {
    this.inputActive = false;
    this.inputBuffer = '';
    this.needsRedraw = true;
  }

  /**
   * Get current input buffer
   */
  getInputBuffer(): string {
    return this.inputBuffer;
  }

  /**
   * Scroll up by given number of lines
   */
  scrollUp(lines: number = 3): void {
    this.scrollOffset = Math.max(0, this.scrollOffset - lines);
    this.needsRedraw = true;
  }

  /**
   * Scroll down by given number of lines
   */
  scrollDown(lines: number = 3): void {
    const contentHeight = this.getContentHeight();
    const viewHeight = this.bounds.height - 4;
    const maxScroll = Math.max(0, contentHeight - viewHeight);
    this.scrollOffset = Math.min(maxScroll, this.scrollOffset + lines);
    this.needsRedraw = true;
  }

  /**
   * Calculate total content height (in lines)
   */
  private getContentHeight(): number {
    let height = 0;
    const maxWidth = this.bounds.width - 4; // -2 borders, -2 padding

    for (const entry of this.entries) {
      if (!this.showActions && entry.type === 'action') continue;
      // Header line (badge, name, position)
      height += 1;
      // Message lines (wrapped)
      const msgLines = this.wrapText(entry.message, maxWidth - 2);
      height += msgLines.length;
    }

    return height;
  }

  /**
   * Wrap text to fit within given width
   */
  private wrapText(text: string, maxWidth: number): string[] {
    if (text.length <= maxWidth) {
      return [text];
    }

    const lines: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxWidth) {
        lines.push(remaining);
        break;
      }

      // Find last space within maxWidth
      let splitAt = maxWidth;
      for (let i = maxWidth; i > maxWidth / 2; i--) {
        if (remaining[i] === ' ') {
          splitAt = i;
          break;
        }
      }

      lines.push(remaining.slice(0, splitAt));
      remaining = remaining.slice(splitAt).trimStart();
    }

    return lines;
  }

  /**
   * Handle input events
   */
  handleInput(event: ParsedKey): InputResult {
    // When input is active, capture all keys
    if (this.inputActive) {
      return this.handleInputMode(event);
    }

    // When focused but not in input mode
    if (this.state === 'focused') {
      switch (event.key) {
        case 'Enter':
        case 't':
          this.activateInput();
          return { handled: true, stopPropagation: true };

        case 'PageUp':
          this.scrollUp(5);
          return { handled: true };

        case 'PageDown':
          this.scrollDown(5);
          return { handled: true };

        case 'ArrowUp':
          this.scrollUp(1);
          return { handled: true };

        case 'ArrowDown':
          this.scrollDown(1);
          return { handled: true };

        case 'a':
          this.toggleShowActions();
          return { handled: true };

        case 'Escape':
          // Blur the component
          this.blur();
          return { handled: true };
      }
    }

    return { handled: false };
  }

  /**
   * Handle input in typing mode
   */
  private handleInputMode(event: ParsedKey): InputResult {
    switch (event.key) {
      case 'Escape':
        this.deactivateInput();
        return { handled: true, stopPropagation: true };

      case 'Enter':
        if (this.inputBuffer.trim()) {
          this.onSendMessage?.(this.inputBuffer.trim());
        }
        this.deactivateInput();
        return { handled: true, stopPropagation: true };

      case 'Backspace':
        if (this.inputBuffer.length > 0) {
          this.inputBuffer = this.inputBuffer.slice(0, -1);
          this.needsRedraw = true;
        }
        return { handled: true, stopPropagation: true };

      default:
        // Add printable characters
        if (event.char && event.char.length === 1 && event.char.charCodeAt(0) >= 32) {
          this.inputBuffer += event.char;
          this.needsRedraw = true;
        }
        return { handled: true, stopPropagation: true };
    }
  }

  /**
   * Render the chat component
   */
  render(): void {
    // Clear buffer with dark background
    this.fill(' ', { type: 'default' }, { type: 'rgb', value: [15, 15, 20] });

    // Draw border with title
    const borderColor = this.state === 'focused'
      ? { type: 'rgb' as const, value: [100, 200, 100] as [number, number, number] }
      : { type: 'rgb' as const, value: [60, 60, 80] as [number, number, number] };

    this.drawBorder(
      this.inputActive ? 'Chat (typing)' : 'Chat',
      borderColor,
      { type: 'rgb', value: [15, 15, 20] }
    );

    // Render messages
    this.renderMessages();

    // Render input area
    this.renderInputArea();

    this.needsRedraw = false;
  }

  /**
   * Render chat messages
   */
  private renderMessages(): void {
    const maxWidth = this.bounds.width - 4;
    const viewHeight = this.bounds.height - 4; // -2 border, -2 input area

    // Collect visible entries with their line positions
    const lines: Array<{
      type: 'header' | 'message';
      entry: ChatEntry;
      text: string;
    }> = [];

    for (const entry of this.entries) {
      if (!this.showActions && entry.type === 'action') continue;

      // Header line
      lines.push({ type: 'header', entry, text: '' });

      // Message lines
      const msgLines = this.wrapText(entry.message, maxWidth - 2);
      for (const line of msgLines) {
        lines.push({ type: 'message', entry, text: line });
      }
    }

    // Apply scroll offset and render visible lines
    const visibleLines = lines.slice(this.scrollOffset, this.scrollOffset + viewHeight);

    let y = 1;
    for (const line of visibleLines) {
      if (y > viewHeight) break;

      if (line.type === 'header') {
        this.renderEntryHeader(1, y, line.entry);
      } else {
        this.renderMessageLine(3, y, line.text, line.entry);
      }
      y++;
    }
  }

  /**
   * Render entry header with badge, name, and position
   */
  private renderEntryHeader(x: number, y: number, entry: ChatEntry): void {
    const maxWidth = this.bounds.width - 2;
    let col = x;

    // Badge
    const badge = this.getBadge(entry);
    const badgeColor = this.getBadgeColor(entry);

    for (let i = 0; i < badge.length && col < maxWidth; i++) {
      this.buffer.setCell(col++, y, {
        char: badge[i]!,
        fg: badgeColor,
        attrs: { bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, strikethrough: false },
      });
    }

    // Space
    if (col < maxWidth) {
      this.buffer.setCell(col++, y, { char: ' ' });
    }

    // Name (color-coded)
    const nameColor = this.getNameColor(entry.actorName);
    const isMe = entry.actorId === this.currentUserId;
    const displayName = isMe ? entry.actorName : entry.actorName;

    for (let i = 0; i < displayName.length && col < maxWidth; i++) {
      this.buffer.setCell(col++, y, {
        char: displayName[i]!,
        fg: isMe ? { type: 'rgb', value: [150, 255, 150] } : nameColor,
        attrs: { bold: true, dim: false, italic: false, underline: false, blink: false, inverse: false, strikethrough: false },
      });
    }

    // Position
    if (entry.position && col < maxWidth - 8) {
      const posStr = ` (${entry.position.x},${entry.position.y})`;
      for (let i = 0; i < posStr.length && col < maxWidth; i++) {
        this.buffer.setCell(col++, y, {
          char: posStr[i]!,
          fg: { type: 'rgb', value: [80, 80, 100] },
        });
      }
    }
  }

  /**
   * Render a message line
   */
  private renderMessageLine(x: number, y: number, text: string, entry: ChatEntry): void {
    const maxWidth = this.bounds.width - 2;
    const isAction = entry.type === 'action';
    const isEvent = entry.type === 'event';

    // Determine text style
    const fg = isAction
      ? { type: 'rgb' as const, value: [120, 120, 140] as [number, number, number] }
      : isEvent
        ? { type: 'rgb' as const, value: [180, 140, 100] as [number, number, number] }
        : { type: 'rgb' as const, value: [200, 200, 200] as [number, number, number] };

    const displayText = isAction ? `*${text}*` : text;

    for (let i = 0; i < displayText.length && x + i < maxWidth; i++) {
      this.buffer.setCell(x + i, y, {
        char: displayText[i]!,
        fg,
        attrs: {
          bold: false,
          dim: isAction,
          italic: isAction,
          underline: false,
          blink: false,
          inverse: false,
          strikethrough: false,
        },
      });
    }
  }

  /**
   * Render input area at bottom
   */
  private renderInputArea(): void {
    const y = this.bounds.height - 2;
    const maxWidth = this.bounds.width - 2;

    // Draw separator line
    for (let x = 1; x < maxWidth; x++) {
      this.buffer.setCell(x, y - 1, {
        char: '─',
        fg: { type: 'rgb', value: [40, 40, 50] },
      });
    }

    // Prompt
    const prompt = this.inputActive ? '> ' : '  ';
    const promptColor = this.inputActive
      ? { type: 'rgb' as const, value: [100, 255, 100] as [number, number, number] }
      : { type: 'rgb' as const, value: [60, 60, 80] as [number, number, number] };

    for (let i = 0; i < prompt.length; i++) {
      this.buffer.setCell(1 + i, y, {
        char: prompt[i]!,
        fg: promptColor,
      });
    }

    // Input buffer (scroll if too long)
    const maxInput = maxWidth - 4;
    const visibleInput = this.inputBuffer.slice(-maxInput);

    for (let i = 0; i < visibleInput.length; i++) {
      this.buffer.setCell(3 + i, y, {
        char: visibleInput[i]!,
        fg: { type: 'rgb', value: [255, 255, 255] },
      });
    }

    // Cursor when active
    if (this.inputActive) {
      const cursorX = 3 + visibleInput.length;
      if (cursorX < maxWidth) {
        this.buffer.setCell(cursorX, y, {
          char: '█',
          fg: { type: 'rgb', value: [100, 255, 100] },
          attrs: {
            bold: false,
            dim: false,
            italic: false,
            underline: false,
            blink: true,
            inverse: false,
            strikethrough: false,
          },
        });
      }
    }

    // Hint text when not typing
    if (!this.inputActive && this.state === 'focused') {
      const hint = 'Press t or Enter to type';
      const hintStart = Math.min(3, maxWidth - hint.length - 1);
      for (let i = 0; i < hint.length && hintStart + i < maxWidth; i++) {
        this.buffer.setCell(hintStart + i, y, {
          char: hint[i]!,
          fg: { type: 'rgb', value: [60, 60, 80] },
        });
      }
    }
  }

  /**
   * Get badge text for entry type
   */
  private getBadge(entry: ChatEntry): string {
    if (entry.actorId === this.currentUserId) {
      return '[YOU]';
    }
    switch (entry.actorType) {
      case 'npc':
        return '[NPC]';
      case 'bot':
        return '[BOT]';
      case 'player':
        return '';
      default:
        return '';
    }
  }

  /**
   * Get badge color based on type
   */
  private getBadgeColor(entry: ChatEntry): { type: 'rgb'; value: [number, number, number] } {
    if (entry.actorId === this.currentUserId) {
      return { type: 'rgb', value: [100, 255, 100] };
    }
    switch (entry.actorType) {
      case 'npc':
        return { type: 'rgb', value: [255, 153, 0] };
      case 'bot':
        return { type: 'rgb', value: [255, 100, 170] };
      case 'player':
        return { type: 'rgb', value: [100, 200, 255] };
      default:
        return { type: 'rgb', value: [150, 150, 150] };
    }
  }

  /**
   * Generate consistent color for a username (based on hash)
   */
  private getNameColor(name: string): { type: 'rgb'; value: [number, number, number] } {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Generate pastel-ish colors
    const h = Math.abs(hash) % 360;
    const s = 60 + (Math.abs(hash >> 8) % 30);
    const l = 60 + (Math.abs(hash >> 16) % 20);

    const rgb = this.hslToRgb(h, s, l);
    return { type: 'rgb', value: rgb };
  }

  /**
   * Convert HSL to RGB
   */
  private hslToRgb(h: number, s: number, l: number): [number, number, number] {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
      const k = (n + h / 30) % 12;
      return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
  }
}
