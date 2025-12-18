import type { Rect, Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { ScreenBuffer } from '../buffer/screen-buffer.js';

/**
 * Component lifecycle states
 */
export type ComponentState = 'unmounted' | 'mounted' | 'focused' | 'destroyed';

/**
 * Result of input handling
 */
export type InputResult =
  | { handled: true; stopPropagation?: boolean }
  | { handled: false };

/**
 * Component configuration
 */
export interface ComponentConfig {
  id: string;
  bounds: Rect;
  zIndex?: number;
  visible?: boolean;
  modal?: boolean;
  focusable?: boolean;
}

/**
 * Event callbacks for component lifecycle
 */
export interface ComponentEvents {
  onShow?: () => void;
  onHide?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onDestroy?: () => void;
  onResize?: (bounds: Rect) => void;
}

/**
 * Abstract base class for all UI components
 *
 * Components have a proper lifecycle:
 * - init(): Called when added to ComponentManager
 * - show()/hide(): Called when visibility changes
 * - focus()/blur(): Called when focus changes
 * - destroy(): Called when removed
 *
 * Components can handle input via handleInput() and return
 * whether they consumed the event.
 */
export abstract class Component {
  public readonly id: string;
  protected bounds: Rect;
  protected zIndex: number;
  protected buffer: ScreenBuffer;
  protected visible: boolean;
  protected modal: boolean;
  protected focusable: boolean;
  protected state: ComponentState = 'unmounted';
  protected needsRedraw: boolean = true;
  protected children: Component[] = [];
  protected parent: Component | null = null;
  protected events: ComponentEvents = {};

  constructor(config: ComponentConfig) {
    this.id = config.id;
    this.bounds = { ...config.bounds };
    this.zIndex = config.zIndex ?? 0;
    this.visible = config.visible ?? false;
    this.modal = config.modal ?? false;
    this.focusable = config.focusable ?? true;
    this.buffer = new ScreenBuffer(config.bounds.width, config.bounds.height);
  }

  // === Lifecycle Methods ===

  /**
   * Called when component is added to the tree.
   * Override to perform one-time setup.
   */
  init(): void {
    this.state = 'mounted';
    for (const child of this.children) {
      child.init();
    }
  }

  /**
   * Called when component becomes visible.
   */
  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.needsRedraw = true;
    this.events.onShow?.();
  }

  /**
   * Called when component is hidden.
   */
  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.events.onHide?.();
  }

  /**
   * Called when component receives focus.
   */
  focus(): void {
    if (this.state === 'focused') return;
    this.state = 'focused';
    this.needsRedraw = true;
    this.events.onFocus?.();
  }

  /**
   * Called when component loses focus.
   */
  blur(): void {
    if (this.state !== 'focused') return;
    this.state = 'mounted';
    this.needsRedraw = true;
    this.events.onBlur?.();
  }

  /**
   * Called when component is being removed.
   * Override to perform cleanup.
   */
  destroy(): void {
    this.state = 'destroyed';
    for (const child of this.children) {
      child.destroy();
    }
    this.children = [];
    this.events.onDestroy?.();
  }

  // === Update and Render ===

  /**
   * Update component state. Called every tick.
   * Override for animations, data polling, etc.
   */
  update(_deltaMs: number): void {
    for (const child of this.children) {
      if (child.isVisible()) {
        child.update(_deltaMs);
      }
    }
  }

  /**
   * Render component to its internal buffer.
   * Must be implemented by subclasses.
   */
  abstract render(): void;

  /**
   * Composite children onto this component's buffer.
   * Called after render() if component has children.
   */
  protected compositeChildren(): void {
    const sorted = [...this.children]
      .filter(c => c.isVisible())
      .sort((a, b) => a.getZIndex() - b.getZIndex());

    for (const child of sorted) {
      const localX = child.bounds.x - this.bounds.x;
      const localY = child.bounds.y - this.bounds.y;
      this.buffer.blit(child.getBuffer(), localX, localY);
    }
  }

  // === Input Handling ===

  /**
   * Handle input event.
   * Return { handled: true } to consume the event.
   * Return { handled: true, stopPropagation: true } to also prevent
   * the event from reaching other components.
   */
  handleInput(_event: ParsedKey): InputResult {
    return { handled: false };
  }

  // === Child Management ===

  /**
   * Add a child component.
   */
  addChild(child: Component): void {
    child.parent = this;
    this.children.push(child);
    if (this.state !== 'unmounted') {
      child.init();
    }
  }

  /**
   * Remove a child component.
   */
  removeChild(child: Component): void {
    const index = this.children.indexOf(child);
    if (index >= 0) {
      this.children.splice(index, 1);
      child.destroy();
      child.parent = null;
    }
  }

  /**
   * Get all children.
   */
  getChildren(): Component[] {
    return [...this.children];
  }

  // === Event Registration ===

  /**
   * Register lifecycle event callbacks.
   */
  on(events: ComponentEvents): void {
    this.events = { ...this.events, ...events };
  }

  // === Accessors ===

  getBuffer(): ScreenBuffer {
    return this.buffer;
  }

  getBounds(): Rect {
    return { ...this.bounds };
  }

  getZIndex(): number {
    return this.zIndex;
  }

  isVisible(): boolean {
    return this.visible;
  }

  isModal(): boolean {
    return this.modal;
  }

  isFocusable(): boolean {
    return this.focusable;
  }

  getState(): ComponentState {
    return this.state;
  }

  setZIndex(z: number): void {
    this.zIndex = z;
  }

  /**
   * Resize component and reallocate buffer.
   */
  resize(bounds: Rect): void {
    this.bounds = { ...bounds };
    this.buffer = new ScreenBuffer(bounds.width, bounds.height);
    this.needsRedraw = true;
    this.events.onResize?.(bounds);
  }

  /**
   * Mark component as needing redraw.
   */
  markDirty(): void {
    this.needsRedraw = true;
  }

  /**
   * Check if component needs redraw.
   */
  isDirty(): boolean {
    return this.needsRedraw;
  }

  /**
   * Clear dirty flag after rendering.
   */
  clearDirty(): void {
    this.needsRedraw = false;
  }

  // === Utility Methods ===

  /**
   * Draw a box border around the component.
   */
  protected drawBorder(title?: string, fg?: Cell['fg'], bg?: Cell['bg']): void {
    const { width, height } = this.bounds;
    const color = fg ?? { type: 'default' as const };
    const bgColor = bg ?? { type: 'default' as const };

    // Top border
    this.buffer.setCell(0, 0, { char: '┌', fg: color, bg: bgColor });
    for (let x = 1; x < width - 1; x++) {
      this.buffer.setCell(x, 0, { char: '─', fg: color, bg: bgColor });
    }
    this.buffer.setCell(width - 1, 0, { char: '┐', fg: color, bg: bgColor });

    // Side borders
    for (let y = 1; y < height - 1; y++) {
      this.buffer.setCell(0, y, { char: '│', fg: color, bg: bgColor });
      this.buffer.setCell(width - 1, y, { char: '│', fg: color, bg: bgColor });
    }

    // Bottom border
    this.buffer.setCell(0, height - 1, { char: '└', fg: color, bg: bgColor });
    for (let x = 1; x < width - 1; x++) {
      this.buffer.setCell(x, height - 1, { char: '─', fg: color, bg: bgColor });
    }
    this.buffer.setCell(width - 1, height - 1, { char: '┘', fg: color, bg: bgColor });

    // Title
    if (title) {
      const titleText = ` ${title} `;
      const startX = Math.floor((width - titleText.length) / 2);
      this.buffer.writeText(startX, 0, titleText, color, bgColor);
    }
  }

  /**
   * Fill the entire buffer with a character and colors.
   */
  protected fill(char: string = ' ', fg?: Cell['fg'], bg?: Cell['bg']): void {
    const cell: Partial<Cell> = { char };
    if (fg) cell.fg = fg;
    if (bg) cell.bg = bg;

    this.buffer.fillRect(
      { x: 0, y: 0, width: this.bounds.width, height: this.bounds.height },
      cell
    );
  }
}
