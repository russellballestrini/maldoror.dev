import type { InputMode, Cell } from '@maldoror/protocol';
import type { ParsedKey } from '../input/key-parser.js';
import { Component } from './component.js';
import { ScreenBuffer } from '../buffer/screen-buffer.js';

const ESC = '\x1b';

/**
 * ComponentManager manages the component tree, focus stack, and rendering.
 *
 * Key features:
 * - Focus stack for modal management (modals block input to components behind)
 * - Input mode derived from focus state (fixes the ? ESC ? bug)
 * - Efficient rendering with damage tracking
 */
export class ComponentManager {
  private rootComponents: Component[] = [];
  private focusStack: Component[] = [];
  private screenBuffer: ScreenBuffer;
  private cols: number;
  private rows: number;
  private inputModeCallback: ((mode: InputMode) => void) | null = null;

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.screenBuffer = new ScreenBuffer(cols, rows);
  }

  // === Component Tree Management ===

  /**
   * Add a root-level component.
   */
  addComponent(component: Component): void {
    this.rootComponents.push(component);
    component.init();
  }

  /**
   * Remove a root-level component.
   */
  removeComponent(component: Component): void {
    const index = this.rootComponents.indexOf(component);
    if (index >= 0) {
      this.rootComponents.splice(index, 1);
      component.destroy();
      this.removeFocus(component);
    }
  }

  /**
   * Get component by ID (searches entire tree).
   */
  getComponent(id: string): Component | null {
    const search = (components: Component[]): Component | null => {
      for (const c of components) {
        if (c.id === id) return c;
        const found = search(c.getChildren());
        if (found) return found;
      }
      return null;
    };
    return search(this.rootComponents);
  }

  /**
   * Get all root components.
   */
  getRootComponents(): Component[] {
    return [...this.rootComponents];
  }

  // === Focus Stack Management ===

  /**
   * Push component onto focus stack.
   * Shows the component and makes it receive input.
   * Modal components block input to components behind them.
   */
  pushFocus(component: Component): void {
    // Blur current focus
    const current = this.getFocusedComponent();
    if (current) {
      current.blur();
    }

    // Add to stack, show, and focus
    this.focusStack.push(component);
    component.show();
    component.focus();

    // Notify input mode change
    this.notifyModeChange();
  }

  /**
   * Pop component from focus stack.
   * Hides the component and returns focus to the previous one.
   */
  popFocus(): Component | null {
    const component = this.focusStack.pop();
    if (component) {
      component.blur();
      component.hide();
    }

    // Focus the new top of stack
    const newFocus = this.getFocusedComponent();
    if (newFocus) {
      newFocus.focus();
    }

    this.notifyModeChange();
    return component ?? null;
  }

  /**
   * Remove specific component from focus stack (if present).
   */
  removeFocus(component: Component): void {
    const index = this.focusStack.indexOf(component);
    if (index >= 0) {
      this.focusStack.splice(index, 1);
      component.blur();
      component.hide();

      // Re-focus top of stack
      const current = this.getFocusedComponent();
      if (current) {
        current.focus();
      }
      this.notifyModeChange();
    }
  }

  /**
   * Get currently focused component (top of stack).
   */
  getFocusedComponent(): Component | null {
    return this.focusStack.length > 0
      ? this.focusStack[this.focusStack.length - 1]!
      : null;
  }

  /**
   * Check if any modal component is currently focused.
   */
  hasModalFocus(): boolean {
    return this.focusStack.some(c => c.isModal());
  }

  /**
   * Get the focus stack (for debugging).
   */
  getFocusStack(): Component[] {
    return [...this.focusStack];
  }

  // === Input Mode (KEY FOR BUG FIX) ===

  /**
   * Get input mode derived from focus state.
   * This is the key fix: mode is derived, not managed separately.
   */
  getInputMode(): InputMode {
    const focused = this.getFocusedComponent();
    if (!focused) return 'game';

    // Modal components use 'dialog' mode
    if (focused.isModal()) return 'dialog';

    return 'game';
  }

  /**
   * Register callback for input mode changes.
   */
  onInputModeChange(callback: (mode: InputMode) => void): void {
    this.inputModeCallback = callback;
  }

  private notifyModeChange(): void {
    this.inputModeCallback?.(this.getInputMode());
  }

  // === Input Routing ===

  /**
   * Route input through the component tree.
   * Respects focus stack and modal blocking.
   * Returns true if input was handled.
   */
  handleInput(event: ParsedKey): boolean {
    const focused = this.getFocusedComponent();

    // If there's a modal focus, only route to the focused component
    if (focused && focused.isModal()) {
      const result = focused.handleInput(event);
      return result.handled;
    }

    // Otherwise, route through focus stack (top to bottom)
    for (let i = this.focusStack.length - 1; i >= 0; i--) {
      const component = this.focusStack[i]!;
      const result = component.handleInput(event);
      if (result.handled) {
        return true;
      }
    }

    return false;
  }

  // === Update and Render ===

  /**
   * Update all visible components.
   */
  update(deltaMs: number): void {
    for (const component of this.rootComponents) {
      if (component.isVisible()) {
        component.update(deltaMs);
      }
    }

    // Update focus stack components (may not be in root)
    for (const component of this.focusStack) {
      if (component.isVisible()) {
        component.update(deltaMs);
      }
    }
  }

  /**
   * Render all visible components to an ANSI string.
   * Returns the string to be appended to stream output.
   */
  renderToString(): string {
    // Render focus stack components (modals/overlays)
    let output = '';

    for (const component of this.focusStack) {
      if (component.isVisible()) {
        component.render();
        output += this.componentToAnsi(component);
      }
    }

    return output;
  }

  /**
   * Convert a component's buffer to ANSI escape sequences.
   */
  private componentToAnsi(component: Component): string {
    const buffer = component.getBuffer();
    const bounds = component.getBounds();
    let output = '';

    for (let y = 0; y < bounds.height; y++) {
      // Move cursor to start of row
      output += `${ESC}[${bounds.y + y + 1};${bounds.x + 1}H`;

      let currentFg: Cell['fg'] | null = null;
      let currentBg: Cell['bg'] | null = null;

      for (let x = 0; x < bounds.width; x++) {
        const cell = buffer.getCell(x, y);
        if (!cell) continue;

        // Apply colors if changed
        if (!this.colorsEqual(cell.fg, currentFg)) {
          output += this.fgToAnsi(cell.fg);
          currentFg = cell.fg;
        }
        if (!this.colorsEqual(cell.bg, currentBg)) {
          output += this.bgToAnsi(cell.bg);
          currentBg = cell.bg;
        }

        output += cell.char;
      }
    }

    // Reset colors
    output += `${ESC}[0m`;

    return output;
  }

  private fgToAnsi(color: Cell['fg']): string {
    if (color.type === 'default') {
      return `${ESC}[39m`;
    }
    if (color.type === 'rgb' && Array.isArray(color.value)) {
      const [r, g, b] = color.value;
      return `${ESC}[38;2;${r};${g};${b}m`;
    }
    if (color.type === '256' && typeof color.value === 'number') {
      return `${ESC}[38;5;${color.value}m`;
    }
    if (color.type === '16' && typeof color.value === 'number') {
      return `${ESC}[${30 + color.value}m`;
    }
    return '';
  }

  private bgToAnsi(color: Cell['bg']): string {
    if (color.type === 'default') {
      return `${ESC}[49m`;
    }
    if (color.type === 'rgb' && Array.isArray(color.value)) {
      const [r, g, b] = color.value;
      return `${ESC}[48;2;${r};${g};${b}m`;
    }
    if (color.type === '256' && typeof color.value === 'number') {
      return `${ESC}[48;5;${color.value}m`;
    }
    if (color.type === '16' && typeof color.value === 'number') {
      return `${ESC}[${40 + color.value}m`;
    }
    return '';
  }

  private colorsEqual(a: Cell['fg'] | null, b: Cell['fg'] | null): boolean {
    if (a === null || b === null) return a === b;
    if (a.type !== b.type) return false;
    if (a.type === 'default') return true;
    if (Array.isArray(a.value) && Array.isArray(b.value)) {
      return a.value[0] === b.value[0] &&
             a.value[1] === b.value[1] &&
             a.value[2] === b.value[2];
    }
    return a.value === b.value;
  }

  // === Screen Management ===

  /**
   * Force a full redraw on next render.
   */
  invalidate(): void {
    this.screenBuffer.markAllDirty();
  }

  /**
   * Resize the screen buffer.
   */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;
    this.screenBuffer = new ScreenBuffer(cols, rows);
  }

  /**
   * Get screen dimensions.
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Check if any components need rendering.
   */
  hasVisibleComponents(): boolean {
    return this.focusStack.some(c => c.isVisible());
  }

  /**
   * Cleanup all components.
   */
  destroy(): void {
    for (const component of this.rootComponents) {
      component.destroy();
    }
    this.rootComponents = [];
    this.focusStack = [];
  }
}
