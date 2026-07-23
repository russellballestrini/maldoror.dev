import type { Duplex } from 'stream';
import type { RGB, WorldDataProvider } from '@maldoror/protocol';
import { ViewportRenderer, type ViewportConfig, type TextOverlay, type CameraMode, type CameraRotation } from './viewport-renderer.js';
import type { Direction } from '@maldoror/protocol';
import {
  quantizeGridDithered,
  renderNormalGridCells,
  renderHalfBlockGridCells,
  renderBrailleGridCells,
  renderOctantGridCells,
  cellsEqual,
  colorsEqual,
  renderCRLE,
  type CellGrid,
} from './pixel-renderer.js';
import { perfStats } from './perf-stats.js';
import { sgrCode } from './ansi-cache.js';
import {
  TerminalCodec,
  type TerminalCodecMetrics,
} from './terminal-codec.js';
import {
  osc4EntriesPacket,
  osc4Packet,
  osc4Query,
  osc104Restore,
  parseOsc4ColorResponse,
  PALETTE,
  PHASES,
  waterPalette,
} from './palette-cycle.js';
import { BG_PRIMARY, BG_TERTIARY, fg, bg, ACCENT_CYAN, ACCENT_GOLD, TEXT_SECONDARY, BORDER_DIM, RESET } from '../brand.js';

// Synchronized output (DEC private mode 2026). Supported by kitty, WezTerm,
// Ghostty, Alacritty, foot, iTerm2, Windows Terminal, contour; terminals that
// don't support it silently ignore the sequences. Wrapping each frame batch
// makes the terminal apply the whole update atomically — eliminates tearing
// and mid-frame flicker at zero cost.
const SYNC_BEGIN = '\x1b[?2026h';
const SYNC_END = '\x1b[?2026l';

// Re-export for convenience
export type { CameraMode } from './viewport-renderer.js';

const ESC = '\x1b';

// Build version - set dynamically by server from version.json
let BUILD_VERSION = 'vdev';

/**
 * Set the build version to display in stats bar
 * Called by server at startup with version from version.json
 */
export function setBuildVersion(version: string): void {
  BUILD_VERSION = version;
}

/**
 * Get the current build version
 */
export function getBuildVersion(): string {
  return BUILD_VERSION;
}

/**
 * Layout configuration for the game screen
 * Defines reserved space for UI elements around the viewport
 */
export interface LayoutConfig {
  headerRows: number;      // Rows reserved at top (default: 2 for stats bar)
  footerRows: number;      // Rows reserved at bottom (default: 0)
  leftSidebarCols: number; // Cols reserved on left (default: 0)
  rightSidebarCols: number; // Cols reserved on right (default: 0)
}

// Default layout with just the header
const DEFAULT_LAYOUT: LayoutConfig = {
  headerRows: 2,       // Stats bar + separator
  footerRows: 0,       // No footer by default
  leftSidebarCols: 0,  // No left sidebar
  rightSidebarCols: 0, // No right sidebar
};

/**
 * Render mode options
 * - 'normal': 2 chars per pixel width, 1 row per pixel height
 * - 'halfblock': 1 char per pixel width, 2 pixels per row (using ▀)
 * - 'braille': 2×4 pixels per char (Braille dots) — high res, but dot-gap texture
 * - 'octant': 2×4 pixels per char (Unicode 16 octant SOLID mosaics) — same
 *   resolution as braille but solid fills; best fidelity where supported
 *   (Ghostty, kitty, VTE). Falls back visually to braille geometry.
 */
export type RenderMode = 'normal' | 'halfblock' | 'braille' | 'octant';

/**
 * Foveated zone configuration
 */
export interface FoveatedConfig {
  zoneARadius: number;  // Tiles around player for Zone A (60Hz), default: 3
  zoneBRadius: number;  // Additional tiles for Zone B (15Hz), default: 6
  zoneBDivisor: number; // Update Zone B every N frames, default: 4 (15Hz at 60fps)
  zoneCDivisor: number; // Update Zone C every N frames, default: 15 (4Hz at 60fps)
}

const DEFAULT_FOVEATED: FoveatedConfig = {
  zoneARadius: 3,
  zoneBRadius: 6,
  zoneBDivisor: 4,
  zoneCDivisor: 15,
};

/**
 * Performance optimization options
 */
export interface PerfOptimizations {
  crle?: boolean;           // Chromatic Run-Length Encoding (default: true)
  foveated?: boolean;       // Foveated temporal rendering (default: false)
  foveatedConfig?: Partial<FoveatedConfig>;  // Zone configuration
  enablePerfStats?: boolean; // Enable performance logging (default: false)
}

/**
 * Configuration for PixelGameRenderer
 */
export interface PixelGameRendererConfig {
  stream: Duplex;
  cols: number;
  rows: number;
  username?: string;
  zoomLevel?: number;  // Zoom percentage: 100 = full resolution, 50 = half resolution (sees more world)
  renderMode?: RenderMode;  // Rendering mode (default: 'braille' for max resolution)
  layout?: Partial<LayoutConfig>;  // Optional layout configuration (reserves space for UI elements)
  optimizations?: PerfOptimizations;  // Performance optimizations
  paletteAnimation?: boolean; // OSC-4 material animation (Ghostty-first)
}

/**
 * Adapter to provide world data to the ViewportRenderer
 */
export interface GameWorldAdapter extends WorldDataProvider {}

/**
 * PixelGameRenderer - Renders the pixel-based game world to terminal
 *
 * Uses ViewportRenderer for the actual rendering, handles:
 * - Terminal initialization (alternate screen, cursor hiding)
 * - Frame timing
 * - Stream output
 */
export class PixelGameRenderer {
  private stream: Duplex;
  private cols: number;
  private rows: number;
  private viewportRenderer: ViewportRenderer;
  private tickCount: number = 0;
  private forceRedraw: boolean = true;
  private initialized: boolean = false;
  // Performance: Track previous overlay count to only force redraw when overlays change
  private previousOverlayCount: number = 0;
  private username: string;
  private playerX: number = 0;
  private playerY: number = 0;
  private zoomLevel: number;  // 100 = full resolution, 50 = half (zoomed out), etc.
  private zoomTargetLevel: number;
  private zoomFromLevel: number;
  private zoomAnimationStartedAt: number | null = null;
  private readonly ZOOM_ANIMATION_MS = 180;
  private renderMode: RenderMode;
  // Layout configuration (reserves space for UI elements around viewport)
  private layout: LayoutConfig;
  // FPS tracking
  private frameCount: number = 0;
  private fps: number = 0;
  private lastFpsUpdate: number = Date.now();
  private lastRenderTime: number = 0;
  private lastFrameBytes: number = 0;
  // Frame skip tracking - skip rendering when nothing changed
  private previousCameraX: number = -1;
  private previousCameraY: number = -1;
  private framesSkipped: number = 0;
  // Cell-level diffing - store previous frame as cell grid
  private previousCells: CellGrid = [];
  // Stats bar caching (1Hz update to reduce string formatting overhead)
  private statsBarCache: string = '';
  private statsBarLastRender: number = 0;
  private readonly STATS_BAR_TTL_MS = 1000;  // 1Hz update
  // Idle bandwidth throttle: last time the stats bar was written on a skipped frame
  private lastIdleStatsWrite: number = 0;
  // Performance optimizations
  private useCRLE: boolean = true;  // CRLE enabled by default
  private useFoveated: boolean = false;  // Foveated rendering disabled by default
  private foveatedConfig: FoveatedConfig = { ...DEFAULT_FOVEATED };
  // Foveated: Track last update tick for zones B and C
  private lastZoneBUpdate: number = 0;
  private lastZoneCUpdate: number = 0;
  // Foveated: Store previous cells for zones B and C (to avoid re-rendering)
  private zoneBCells: CellGrid = [];
  private zoneCCells: CellGrid = [];
  // Production transport: retained terminal framebuffer + motion compensation.
  private terminalCodec: TerminalCodec;
  private lastCodecMetrics: TerminalCodecMetrics | null = null;
  private previousStatsOutput: string = '';
  // The player can move inside this retained camera frame. Once they cross the
  // dead zone, the camera advances in whole terminal-cell increments so the
  // codec can express motion exactly with SU/SD/DCH/ICH.
  private cameraInitialized = false;
  private cameraTileX = 0;
  private cameraTileY = 0;
  private lastWorldRevision: number | null = null;
  private lastComposedCameraX = Number.NaN;
  private lastComposedCameraY = Number.NaN;
  private paletteAnimation: boolean;
  private readonly originalPalette = new Map<number, RGB>();
  private paletteResponseCarry = '';

  constructor(config: PixelGameRendererConfig) {
    this.stream = config.stream;
    this.cols = config.cols;
    this.rows = config.rows;
    this.username = config.username ?? 'Unknown';
    this.renderMode = config.renderMode ?? 'halfblock';  // Default to halfblock for good balance
    this.zoomLevel = config.zoomLevel ?? 100;  // Default to 100% zoom (most zoomed in)
    this.zoomTargetLevel = this.zoomLevel;
    this.zoomFromLevel = this.zoomLevel;
    this.paletteAnimation = config.paletteAnimation ?? this.renderMode === 'octant';
    this.layout = { ...DEFAULT_LAYOUT, ...config.layout };  // Merge with defaults

    // Initialize performance optimizations
    const opts = config.optimizations ?? {};
    this.useCRLE = opts.crle !== false;  // CRLE enabled by default
    this.useFoveated = opts.foveated === true;  // Foveated disabled by default
    if (opts.foveatedConfig) {
      this.foveatedConfig = { ...DEFAULT_FOVEATED, ...opts.foveatedConfig };
    }
    if (opts.enablePerfStats) {
      perfStats.enable();
    }

    // Calculate viewport size based on terminal size minus layout reservations
    const { availableCols, availableRows } = this.getViewportArea();
    const currentTileSize = this.getCurrentTileSize();
    const { widthTiles, heightTiles } = this.calculateViewportTiles(availableCols, availableRows);
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(availableCols, availableRows);

    const viewportConfig: ViewportConfig = {
      widthTiles: Math.max(1, widthTiles),
      heightTiles: Math.max(1, heightTiles),
      pixelWidth,  // Actual pixel dimensions to fill entire screen
      pixelHeight,
      tileRenderSize: currentTileSize,
    };

    this.viewportRenderer = new ViewportRenderer(viewportConfig);
    this.terminalCodec = new TerminalCodec({
      headerRows: this.layout.headerRows,
      terminalCols: availableCols,
      terminalRows: this.rows,
    });
  }

  /**
   * Get the available viewport area after subtracting layout reservations
   */
  private getViewportArea(): { availableCols: number; availableRows: number } {
    const availableCols = this.cols - this.layout.leftSidebarCols - this.layout.rightSidebarCols;
    const availableRows = this.rows - this.layout.headerRows - this.layout.footerRows;
    return {
      availableCols: Math.max(1, availableCols),
      availableRows: Math.max(1, availableRows),
    };
  }

  /**
   * Get the starting position for the viewport (accounting for header and left sidebar)
   * Note: Used when rendering sidebar/footer layouts
   */
  getViewportOrigin(): { startCol: number; startRow: number } {
    return {
      startCol: this.layout.leftSidebarCols + 1,  // 1-based terminal columns
      startRow: this.layout.headerRows + 1,        // 1-based terminal rows
    };
  }

  /**
   * Get the current tile SCREEN render size based on zoom level
   * This determines how big tiles appear on screen (in pixels)
   * At 0% zoom: small tiles (see lots of world) = 4px per tile
   * At 100% zoom: large tiles that fill viewport height (see full character detail)
   *
   * Uses exponential scaling so each zoom step feels perceptually even
   */
  private getCurrentTileSize(): number {
    const MIN_TILE_SIZE = 4;   // At 0% zoom, tiles are 4 pixels on screen

    // Calculate max tile size to fill viewport height (so character is fully visible at 100%)
    const { availableRows } = this.getViewportArea();
    let maxTileSize: number;
    switch (this.renderMode) {
      case 'octant':
      case 'braille':
        maxTileSize = availableRows * 4;  // 4 pixels per row in braille
        break;
      case 'halfblock':
        maxTileSize = availableRows * 2;  // 2 pixels per row in halfblock
        break;
      case 'normal':
      default:
        maxTileSize = availableRows;      // 1 pixel per row in normal
        break;
    }

    // Exponential interpolation for perceptually even zoom steps
    // Each 10% step multiplies tile size by constant factor
    // Formula: min * (max/min)^(zoom/100)
    const ratio = maxTileSize / MIN_TILE_SIZE;
    const exponent = this.zoomLevel / 100;
    return Math.round(MIN_TILE_SIZE * Math.pow(ratio, exponent));
  }

  /**
   * Calculate actual pixel dimensions available for rendering based on render mode
   */
  private calculatePixelDimensions(cols: number, availableRows: number): { pixelWidth: number; pixelHeight: number } {
    switch (this.renderMode) {
      case 'octant':
      case 'braille':
        // Braille: 1 char = 2 pixels wide, 1 row = 4 pixels tall
        return { pixelWidth: cols * 2, pixelHeight: availableRows * 4 };
      case 'halfblock':
        // Half-block: 1 char = 1 pixel wide, 1 row = 2 pixels tall
        return { pixelWidth: cols, pixelHeight: availableRows * 2 };
      case 'normal':
      default:
        // Normal: 2 chars = 1 pixel wide, 1 row = 1 pixel tall
        return { pixelWidth: Math.floor(cols / 2), pixelHeight: availableRows };
    }
  }

  private getCellGeometry(): {
    cellPixelWidth: number;
    cellPixelHeight: number;
    terminalCellWidth: number;
  } {
    switch (this.renderMode) {
      case 'octant':
      case 'braille':
        return { cellPixelWidth: 2, cellPixelHeight: 4, terminalCellWidth: 1 };
      case 'halfblock':
        return { cellPixelWidth: 1, cellPixelHeight: 2, terminalCellWidth: 1 };
      case 'normal':
      default:
        return { cellPixelWidth: 1, cellPixelHeight: 1, terminalCellWidth: 2 };
    }
  }

  /**
   * Calculate viewport size in tiles based on render mode and current tile size
   * At higher zoom levels, tiles are bigger so fewer fit on screen
   */
  private calculateViewportTiles(cols: number, availableRows: number): { widthTiles: number; heightTiles: number } {
    const tileSize = this.getCurrentTileSize();
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(cols, availableRows);

    return {
      widthTiles: Math.floor(pixelWidth / tileSize),
      heightTiles: Math.floor(pixelHeight / tileSize),
    };
  }

  /**
   * Initialize terminal (alternate screen, hide cursor)
   * IMPORTANT: Always uses brand dark background - no system theme override
   */
  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    // Brand dark background - ALWAYS enforced
    const brandBg = bg(BG_PRIMARY);

    const init = [
      `${ESC}[?1049h`,      // Enter alternate screen
      `${ESC}[?25l`,         // Hide cursor
      `${ESC}[?7l`,          // Disable line wrap
      brandBg,               // Set brand dark background
      `${ESC}[2J`,           // Clear screen (with dark bg)
      `${ESC}[H`,            // Move to home
      this.paletteAnimation
        ? Array.from({ length: PHASES }, (_, i) => osc4Query(PALETTE.WATER + i)).join('')
        : '',
    ].join('');

    this.stream.write(init);

    // Fill entire screen with brand background to prevent any light bleed
    this.fillScreenBackground();
    this.forceRedraw = true;
  }

  /**
   * Fill entire screen with brand dark background
   * Prevents any system theme from bleeding through
   */
  private fillScreenBackground(): void {
    const brandBg = bg(BG_PRIMARY);
    for (let row = 1; row <= this.rows; row++) {
      this.stream.write(`${ESC}[${row};1H${brandBg}${' '.repeat(this.cols)}`);
    }
  }

  /**
   * Cleanup terminal state
   */
  cleanup(): void {
    if (!this.initialized) return;

    // Disable performance stats
    perfStats.disable();

    const reservedPalette = Array.from({ length: PHASES }, (_, i) => PALETTE.WATER + i);
    const exactRestores = reservedPalette
      .filter((index) => this.originalPalette.has(index))
      .map((index) => [index, this.originalPalette.get(index)!] as const);
    const defaultRestores = reservedPalette.filter((index) => !this.originalPalette.has(index));
    const cleanup = [
      exactRestores.length > 0 ? osc4EntriesPacket(exactRestores) : '',
      defaultRestores.length > 0 ? osc104Restore(defaultRestores) : '',
      `${ESC}[?69l`,        // Disable left/right margin mode
      `${ESC}[r`,           // Reset top/bottom scroll margins
      `${ESC}[?1049l`,      // Exit alternate screen
      `${ESC}[?25h`,        // Show cursor
      `${ESC}[?7h`,         // Enable line wrap
      `${ESC}[0m`,          // Reset attributes
    ].join('');

    this.stream.write(cleanup);
    this.originalPalette.clear();
    this.paletteResponseCarry = '';
    this.initialized = false;
  }

  /** Consume OSC-4 query replies before the input router sees them as keys.
   * Any user bytes interleaved in the same SSH packet are returned unchanged. */
  consumeTerminalResponses(data: Buffer): Buffer {
    if (!this.paletteAnimation && this.paletteResponseCarry.length === 0) return data;
    const source = this.paletteResponseCarry + data.toString('utf8');
    this.paletteResponseCarry = '';
    const responsePattern = /\x1b\]4;\d+;rgb:[0-9a-f]{2,4}\/[0-9a-f]{2,4}\/[0-9a-f]{2,4}(?:\x1b\\|\x07)/gi;
    let remaining = '';
    let cursor = 0;
    for (const match of source.matchAll(responsePattern)) {
      const index = match.index ?? cursor;
      remaining += source.slice(cursor, index);
      const parsed = parseOsc4ColorResponse(match[0]);
      if (parsed && parsed.index >= PALETTE.WATER && parsed.index < PALETTE.WATER + PHASES) {
        this.originalPalette.set(parsed.index, parsed.color);
      } else {
        remaining += match[0];
      }
      cursor = index + match[0].length;
    }
    remaining += source.slice(cursor);

    const incomplete = remaining.lastIndexOf(`${ESC}]4;`);
    if (incomplete >= 0 && !/[\x07]|\x1b\\/.test(remaining.slice(incomplete))) {
      this.paletteResponseCarry = remaining.slice(incomplete, incomplete + 256);
      remaining = remaining.slice(0, incomplete);
    }
    return Buffer.from(remaining, 'utf8');
  }

  /**
   * Enable or disable CRLE (Chromatic Run-Length Encoding)
   */
  setCRLE(enabled: boolean): void {
    this.useCRLE = enabled;
    console.log(`[PerfOpt] CRLE ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Check if CRLE is enabled
   */
  isCRLEEnabled(): boolean {
    return this.useCRLE;
  }

  /**
   * Enable performance stats logging
   */
  enablePerfStats(intervalMs: number = 10000): void {
    perfStats.enable(intervalMs);
  }

  /**
   * Disable performance stats logging
   */
  disablePerfStats(): void {
    perfStats.disable();
  }

  /**
   * Enable or disable foveated temporal rendering
   */
  setFoveated(enabled: boolean): void {
    this.useFoveated = enabled;
    console.log(`[PerfOpt] Foveated rendering ${enabled ? 'enabled' : 'disabled'}`);
    if (enabled) {
      console.log(`[PerfOpt] Zones: A=${this.foveatedConfig.zoneARadius} tiles (60Hz), B=${this.foveatedConfig.zoneBRadius} tiles (${60/this.foveatedConfig.zoneBDivisor}Hz), C=rest (${60/this.foveatedConfig.zoneCDivisor}Hz)`);
    }
  }

  /**
   * Check if foveated rendering is enabled
   */
  isFoveatedEnabled(): boolean {
    return this.useFoveated;
  }

  /**
   * Calculate which zone a cell belongs to based on player position
   * Returns 'A' (foveal), 'B' (parafoveal), or 'C' (peripheral)
   */
  private getCellZone(cellX: number, cellY: number): 'A' | 'B' | 'C' {
    // Convert cell position to tile position based on render mode
    let tileX: number, tileY: number;
    const tileSize = this.getCurrentTileSize();

    switch (this.renderMode) {
      case 'octant':
      case 'braille':
        // Braille: 2 pixels per cell width, 4 pixels per cell height
        tileX = Math.floor((cellX * 2) / tileSize);
        tileY = Math.floor((cellY * 4) / tileSize);
        break;
      case 'halfblock':
        // Halfblock: 1 pixel per cell width, 2 pixels per cell height
        tileX = Math.floor(cellX / tileSize);
        tileY = Math.floor((cellY * 2) / tileSize);
        break;
      case 'normal':
      default:
        // Normal: 2 chars per pixel = 1 cell per pixel
        tileX = Math.floor((cellX * 2) / tileSize);
        tileY = Math.floor(cellY / tileSize);
        break;
    }

    // Calculate distance from player (Manhattan distance for performance)
    const { availableCols, availableRows } = this.getViewportArea();
    const { widthTiles, heightTiles } = this.calculateViewportTiles(availableCols, availableRows);

    // Player is at center of viewport
    const centerTileX = Math.floor(widthTiles / 2);
    const centerTileY = Math.floor(heightTiles / 2);

    const distX = Math.abs(tileX - centerTileX);
    const distY = Math.abs(tileY - centerTileY);
    const dist = Math.max(distX, distY);  // Chebyshev distance for square zones

    if (dist <= this.foveatedConfig.zoneARadius) {
      return 'A';
    } else if (dist <= this.foveatedConfig.zoneBRadius) {
      return 'B';
    } else {
      return 'C';
    }
  }

  /**
   * Apply foveated rendering to cell grid
   * Only updates cells in zones that should update this tick
   */
  private applyFoveatedRendering(cells: CellGrid): CellGrid {
    const tick = this.tickCount;
    const shouldUpdateZoneB = (tick - this.lastZoneBUpdate) >= this.foveatedConfig.zoneBDivisor;
    const shouldUpdateZoneC = (tick - this.lastZoneCUpdate) >= this.foveatedConfig.zoneCDivisor;

    if (shouldUpdateZoneB) {
      this.lastZoneBUpdate = tick;
    }
    if (shouldUpdateZoneC) {
      this.lastZoneCUpdate = tick;
    }

    // Track stats
    let zoneACount = 0;
    let zoneBCount = 0;
    let zoneCCount = 0;
    let skippedCount = 0;

    // Create result grid, copying from cached zones where appropriate
    const result: CellGrid = [];

    for (let y = 0; y < cells.length; y++) {
      const row = cells[y];
      if (!row) {
        result.push([]);
        continue;
      }

      const resultRow: CellGrid[number] = [];
      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;

        const zone = this.getCellZone(x, y);

        if (zone === 'A') {
          // Zone A: Always update (60Hz)
          resultRow.push(cell);
          zoneACount++;
        } else if (zone === 'B') {
          if (shouldUpdateZoneB) {
            // Zone B: Update this tick
            resultRow.push(cell);
            zoneBCount++;
          } else {
            // Zone B: Use cached value or current if no cache
            const cached = this.zoneBCells[y]?.[x];
            resultRow.push(cached ?? cell);
            skippedCount++;
          }
        } else {
          if (shouldUpdateZoneC) {
            // Zone C: Update this tick
            resultRow.push(cell);
            zoneCCount++;
          } else {
            // Zone C: Use cached value or current if no cache
            const cached = this.zoneCCells[y]?.[x];
            resultRow.push(cached ?? cell);
            skippedCount++;
          }
        }
      }
      result.push(resultRow);
    }

    // Update cached cells for zones B and C
    if (shouldUpdateZoneB || shouldUpdateZoneC) {
      for (let y = 0; y < cells.length; y++) {
        const row = cells[y];
        if (!row) continue;

        if (!this.zoneBCells[y]) this.zoneBCells[y] = [];
        if (!this.zoneCCells[y]) this.zoneCCells[y] = [];

        for (let x = 0; x < row.length; x++) {
          const cell = row[x];
          if (!cell) continue;

          const zone = this.getCellZone(x, y);
          if (zone === 'B' && shouldUpdateZoneB) {
            this.zoneBCells[y]![x] = cell;
          } else if (zone === 'C' && shouldUpdateZoneC) {
            this.zoneCCells[y]![x] = cell;
          }
        }
      }
    }

    // Record foveated stats
    perfStats.recordFoveated(zoneACount, zoneBCount, zoneCCount, skippedCount);

    return result;
  }

  /**
   * Handle terminal resize
   */
  resize(cols: number, rows: number): void {
    this.cols = cols;
    this.rows = rows;

    const { availableCols, availableRows } = this.getViewportArea();
    const { widthTiles, heightTiles } = this.calculateViewportTiles(availableCols, availableRows);
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(availableCols, availableRows);

    this.viewportRenderer.resize(
      Math.max(1, widthTiles),
      Math.max(1, heightTiles)
    );
    this.viewportRenderer.setPixelDimensions(pixelWidth, pixelHeight);

    // Re-center camera after resize. A resize changes the terminal framebuffer
    // geometry, so it is an I-frame boundary.
    this.cameraInitialized = false;
    this.updateFollowCamera(this.playerX, this.playerY);
    this.terminalCodec.resize(availableCols, rows);

    this.forceRedraw = true;
    this.previousStatsOutput = '';
    this.invalidateStatsBar();
  }

  /**
   * Set camera position (center on player)
   */
  setCamera(tileX: number, tileY: number): void {
    this.playerX = tileX;
    this.playerY = tileY;
    this.updateFollowCamera(tileX, tileY);
  }

  /**
   * Establish the first camera position without animating from the renderer's
   * default origin. Sessions call this after their final zoom/layout restore
   * and before initialize(), so a returning player receives one keyframe at
   * the saved location instead of a long sequence of synthetic scroll deltas.
   */
  primeCamera(tileX: number, tileY: number): void {
    this.playerX = tileX;
    this.playerY = tileY;
    this.cameraTileX = tileX;
    this.cameraTileY = tileY;
    this.cameraInitialized = true;
    this.viewportRenderer.setCamera(tileX, tileY);
    // setCamera() only moves the center in follow mode. Startup must also be
    // exact when a hot-reloaded session restores free-camera mode.
    this.viewportRenderer.snapToTarget();
    this.lastComposedCameraX = Number.NaN;
    this.lastComposedCameraY = Number.NaN;
    this.forceRedraw = true;
  }

  /**
   * Follow the player with a small dead zone and cell-quantized camera motion.
   * The actor remains free to move at sub-cell precision inside the zone; only
   * the retained world framebuffer scrolls, in exact terminal-cell steps, when
   * the boundary is crossed.
   */
  private updateFollowCamera(playerX: number, playerY: number): void {
    if (this.viewportRenderer.getCameraMode() === 'free') {
      // Keep the follow target current without moving the free camera.
      this.viewportRenderer.setCamera(playerX, playerY);
      return;
    }

    if (!this.cameraInitialized) {
      this.cameraTileX = playerX;
      this.cameraTileY = playerY;
      this.cameraInitialized = true;
      this.viewportRenderer.setCamera(this.cameraTileX, this.cameraTileY);
      return;
    }

    const tileSize = this.getCurrentTileSize();
    const { cellPixelWidth, cellPixelHeight } = this.getCellGeometry();
    const { availableCols, availableRows } = this.getViewportArea();
    const deadZoneCols = Math.max(2, Math.floor(availableCols * 0.06));
    const deadZoneRows = Math.max(1, Math.floor(availableRows * 0.08));
    const deadZoneX = deadZoneCols * cellPixelWidth / tileSize;
    const deadZoneY = deadZoneRows * cellPixelHeight / tileSize;

    let desiredX = this.cameraTileX;
    let desiredY = this.cameraTileY;
    if (playerX > this.cameraTileX + deadZoneX) desiredX = playerX - deadZoneX;
    else if (playerX < this.cameraTileX - deadZoneX) desiredX = playerX + deadZoneX;
    if (playerY > this.cameraTileY + deadZoneY) desiredY = playerY - deadZoneY;
    else if (playerY < this.cameraTileY - deadZoneY) desiredY = playerY + deadZoneY;

    const cellWorldX = cellPixelWidth / tileSize;
    const cellWorldY = cellPixelHeight / tileSize;
    // Cap catch-up per 67ms render tick. This makes a camera pan visibly smooth
    // while bounding each horizontal row shift and newly exposed edge.
    const stepX = clamp(Math.round((desiredX - this.cameraTileX) / cellWorldX), -4, 4);
    const stepY = clamp(Math.round((desiredY - this.cameraTileY) / cellWorldY), -2, 2);
    this.cameraTileX += stepX * cellWorldX;
    this.cameraTileY += stepY * cellWorldY;
    this.viewportRenderer.setCamera(this.cameraTileX, this.cameraTileY);
  }

  /**
   * Set username for stats display
   */
  setUsername(username: string): void {
    this.username = username;
  }

  /**
   * Render a frame
   */
  render(world: WorldDataProvider): void {
    const renderStart = Date.now();
    this.tickCount++;

    // Update FPS tracking
    this.frameCount++;
    const now = Date.now();
    this.advanceAnimations(now);
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // Check if camera (player position) has changed
    const cameraChanged = this.playerX !== this.previousCameraX ||
                          this.playerY !== this.previousCameraY;
    this.previousCameraX = this.playerX;
    this.previousCameraY = this.playerY;

    // Skip expensive rendering if nothing changed
    if (!cameraChanged && !this.forceRedraw && this.previousCells.length > 0) {
      this.framesSkipped++;
      // Refresh the stats bar at most 1Hz while idle — rewriting it every
      // tick (15Hz) wasted ~2KB/s per idle session for a bar that only
      // changes once a second anyway.
      if (now - this.lastIdleStatsWrite >= this.STATS_BAR_TTL_MS) {
        this.lastIdleStatsWrite = now;
        const statsBar = this.renderStatsBar();
        const output = `${ESC}[1;1H${statsBar}${ESC}[0m`;
        this.lastFrameBytes = Buffer.byteLength(output, 'utf8');
        this.stream.write(output);
      }
      this.lastRenderTime = Date.now() - renderStart;
      return;
    }

    // Reset skipped counter on actual render
    this.framesSkipped = 0;

    // Generate stats bar
    const statsBar = this.renderStatsBar();
    // Render viewport to raw pixel buffer with overlays and brightness grid
    const { buffer, overlays, brightnessGrid } = this.viewportRenderer.renderToBuffer(world, this.tickCount);

    // Apply color quantization with ordered dithering at high zoom levels
    // Dithering reduces visible banding in gradients while still reducing ANSI codes
    // At zoom > 50%, use 5-bit color (32 levels per channel)
    // At zoom > 70%, use 4-bit color (16 levels per channel)
    let quantizedBuffer = buffer;
    if (this.zoomLevel > 70) {
      quantizedBuffer = quantizeGridDithered(buffer, 4);
    } else if (this.zoomLevel > 50) {
      quantizedBuffer = quantizeGridDithered(buffer, 5);
    }

    // Convert to cell grid for cell-level diffing
    // Pass brightness grid for cell-level lighting (braille/halfblock modes)
    let viewportCells: CellGrid;
    switch (this.renderMode) {
      case 'octant':
        viewportCells = renderOctantGridCells(quantizedBuffer, brightnessGrid);
        break;
      case 'braille':
        viewportCells = renderBrailleGridCells(quantizedBuffer, brightnessGrid);
        break;
      case 'halfblock':
        viewportCells = renderHalfBlockGridCells(quantizedBuffer, brightnessGrid);
        break;
      case 'normal':
      default:
        viewportCells = renderNormalGridCells(quantizedBuffer);
        break;
    }

    // Apply foveated rendering if enabled (reduces updates for peripheral zones)
    if (this.useFoveated) {
      viewportCells = this.applyFoveatedRendering(viewportCells);
    }

    // Output using cell-level diffing for minimal bandwidth
    this.outputFrameCellDiff(statsBar, viewportCells, overlays);

    // Track render time for next frame's display
    this.lastRenderTime = Date.now() - renderStart;
  }

  /**
   * Convert pixel position to terminal position based on render mode
   */
  private pixelToTerminal(pixelX: number, pixelY: number): { row: number; col: number } {
    let row: number;
    let col: number;

    switch (this.renderMode) {
      case 'octant':
      case 'braille':
        // Braille: 4 pixels per row, 2 pixels per char
        row = Math.floor(pixelY / 4);
        col = Math.floor(pixelX / 2);
        break;
      case 'halfblock':
        // Half-block: 2 pixels per row, 1 pixel per char
        row = Math.floor(pixelY / 2);
        col = pixelX;
        break;
      case 'normal':
      default:
        // Normal: 1 pixel per row, 2 chars per pixel
        row = pixelY;
        col = pixelX * 2;
        break;
    }

    return { row, col };
  }

  /**
   * Render the stats bar with 1Hz caching to reduce string formatting overhead
   * Returns cached value if less than 1000ms has passed
   */
  private renderStatsBar(): string {
    const now = Date.now();
    if (now - this.statsBarLastRender < this.STATS_BAR_TTL_MS && this.statsBarCache) {
      return this.statsBarCache;
    }
    this.statsBarLastRender = now;
    this.statsBarCache = this.buildStatsBar();
    return this.statsBarCache;
  }

  /**
   * Invalidate stats bar cache (call on resize, zoom change, mode change)
   */
  invalidateStatsBar(): void {
    this.statsBarLastRender = 0;
  }

  /**
   * Build the stats bar showing username, coordinates, zoom, render mode, camera mode, rotation, and debug info
   * Returns 2 lines: main header bar + separator line
   * Uses brand colors - always dark
   */
  private buildStatsBar(): string {
    const tileSize = this.getCurrentTileSize();
    const { availableCols, availableRows } = this.getViewportArea();
    const { widthTiles, heightTiles } = this.calculateViewportTiles(availableCols, availableRows);

    // Brand colors - always dark, high contrast
    const bgHeader = bg(BG_TERTIARY);
    const bgSep = `${ESC}[48;2;35;30;45m`;     // Slightly lighter separator
    const fgName = fg(ACCENT_CYAN);
    const fgLabel = fg(TEXT_SECONDARY);
    const fgValue = fg(ACCENT_GOLD);
    const fgCoord = `${ESC}[38;2;160;180;200m`; // Blue-gray for coordinates
    const fgSep = fg(BORDER_DIM);
    const reset = RESET;

    // Build header content with generous padding
    const fgVersion = `${ESC}[38;2;100;100;120m`; // Dim gray for version
    const leftSection = `  ${fgName}${this.username} ${fgVersion}${BUILD_VERSION}${fgLabel}`;

    // Mode info
    const modeStr = this.renderMode === 'octant' ? 'OCTANT' :
                    this.renderMode === 'braille' ? 'BRAILLE' :
                    this.renderMode === 'halfblock' ? 'HALF' : 'NORMAL';
    const cameraMode = this.viewportRenderer.getCameraMode();
    const cameraRotation = this.viewportRenderer.getCameraRotation();
    const camStr = cameraMode === 'free' ? '  FREE CAM' : '';
    const rotStr = cameraRotation !== 0 ? `  ROT ${cameraRotation}°` : '';

    // Performance info
    const bytesStr = this.lastFrameBytes >= 1024
      ? `${(this.lastFrameBytes / 1024).toFixed(0)}KB`
      : `${this.lastFrameBytes}B`;
    const skipStr = this.framesSkipped > 0 ? `  skip:${this.framesSkipped}` : '';

    // Center content with clear sections
    const centerSection = `${fgLabel}Mode: ${fgValue}${modeStr}${fgLabel}  Zoom: ${fgValue}${this.zoomLevel}%${fgValue}${rotStr}${camStr}`;

    // Right content
    const rightSection = `${fgLabel}Pos: ${fgCoord}(${this.playerX}, ${this.playerY})  `;

    // Debug info (only shown if there's space)
    const debugStr = `${fgLabel}${this.fps}fps ${this.lastRenderTime}ms ${bytesStr}${skipStr}  ${tileSize}px ${widthTiles}×${heightTiles}`;

    // Calculate spacing
    const leftLen = this.stripAnsi(leftSection).length;
    const centerLen = this.stripAnsi(centerSection).length;
    const rightLen = this.stripAnsi(rightSection).length;
    const debugLen = this.stripAnsi(debugStr).length;

    // Calculate viewport width (excluding right sidebar)
    const viewportWidth = this.cols - this.layout.rightSidebarCols;

    // Try to fit debug info, otherwise skip it
    const availableCenter = viewportWidth - leftLen - rightLen;
    const showDebug = availableCenter >= centerLen + debugLen + 4;

    const actualCenter = showDebug ? `${centerSection}  ${debugStr}` : centerSection;
    const actualCenterLen = showDebug ? centerLen + debugLen + 2 : centerLen;

    const leftPad = Math.max(2, Math.floor((viewportWidth - actualCenterLen) / 2) - leftLen);
    const rightPad = Math.max(2, viewportWidth - leftLen - leftPad - actualCenterLen - rightLen);

    // Line 1: Main header bar (viewport width only)
    const line1 = `${bgHeader}${leftSection}${' '.repeat(leftPad)}${actualCenter}${' '.repeat(rightPad)}${rightSection}${reset}`;

    // Line 2: Subtle separator line (viewport width only)
    const sepChar = '─';
    const line2 = `${bgSep}${fgSep}${sepChar.repeat(viewportWidth)}${reset}`;

    return `${line1}\n${ESC}[2;1H${line2}`;
  }

  /**
   * Strip ANSI codes from string for length calculation
   */
  private stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
  }

  /**
   * Output frame using cell-level diffing for minimal bandwidth
   * Only emits ANSI codes for cells that changed since last frame
   * OPTIMIZED: Uses array chunks and reference swap instead of deep copy
   * CRLE: When enabled, groups cells by color before rendering
   */
  private outputFrameCellDiff(
    statsBar: string,
    viewportCells: CellGrid,
    overlays: TextOverlay[] = []
  ): void {
    const chunks: string[] = [];

    // Performance: Only force full redraw when overlay count changes or dimensions change
    const overlayCountChanged = overlays.length !== this.previousOverlayCount;
    this.previousOverlayCount = overlays.length;

    const needsFullRedraw = this.forceRedraw ||
      this.previousCells.length !== viewportCells.length ||
      overlayCountChanged;

    // Begin synchronized update — the terminal buffers everything until
    // SYNC_END and applies it atomically (no tearing on big diffs)
    chunks.push(SYNC_BEGIN);

    // Always write stats bar (it changes every frame with FPS/bytes counter)
    chunks.push(`${ESC}[1;1H${statsBar}${ESC}[0m`);

    if (needsFullRedraw) {
      // Full redraw - write all cells
      chunks.push(this.renderAllCells(viewportCells));
      this.forceRedraw = false;
    } else if (this.useCRLE) {
      // CRLE: Group cells by color for minimal escape code overhead
      const crleResult = renderCRLE(
        viewportCells,
        this.previousCells,
        this.layout.headerRows,
        this.renderMode
      );
      chunks.push(crleResult.output);

      // Record CRLE stats
      perfStats.recordCRLE(
        crleResult.colorGroups,
        crleResult.bytesWithoutCRLE,
        crleResult.bytesWithCRLE
      );
    } else {
      // Cell-level diff - only write changed cells
      chunks.push(this.renderChangedCells(viewportCells));
    }

    // Render text overlays (usernames above players)
    for (const overlay of overlays) {
      const { row, col } = this.pixelToTerminal(overlay.pixelX, overlay.pixelY);
      const terminalRow = row + this.layout.headerRows + 1;

      if (terminalRow < 1 || terminalRow > this.rows) continue;

      const textLen = overlay.text.length + 2;
      const startCol = Math.max(1, col - Math.floor(textLen / 2) + 1);

      const overlayBg = `${ESC}[48;2;${overlay.bgColor.r};${overlay.bgColor.g};${overlay.bgColor.b}m`;
      const overlayFg = `${ESC}[38;2;${overlay.fgColor.r};${overlay.fgColor.g};${overlay.fgColor.b}m`;

      chunks.push(`${ESC}[${terminalRow};${startCol}H${overlayBg}${overlayFg} ${overlay.text} ${ESC}[0m`);
    }

    // End synchronized update
    chunks.push(SYNC_END);

    const output = chunks.join('');
    if (output) {
      this.lastFrameBytes = Buffer.byteLength(output, 'utf8');
      this.stream.write(output);
    }

    // OPTIMIZED: Swap reference instead of deep copy
    // The viewportCells is freshly created each frame, so we can take ownership
    this.previousCells = viewportCells;
  }

  /**
   * Render all cells (for full redraw)
   * OPTIMIZED: Uses array.push + join instead of string concatenation
   */
  private renderAllCells(cells: CellGrid): string {
    const chunks: string[] = [];
    let lastFg: { r: number; g: number; b: number } | null = null;
    let lastBg: { r: number; g: number; b: number } | null = null;

    for (let y = 0; y < cells.length; y++) {
      const row = cells[y];
      if (!row) continue;

      // Move to start of viewport row (after stats bar)
      chunks.push(`${ESC}[${y + this.layout.headerRows + 1};1H`);

      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        if (!cell) continue;

        // Emit color changes — merged into ONE SGR sequence when both change
        const fgChanged = cell.fgColor && (!lastFg || !colorsEqual(cell.fgColor, lastFg));
        const bgChanged = cell.bgColor && (!lastBg || !colorsEqual(cell.bgColor, lastBg));
        if (fgChanged || bgChanged) {
          chunks.push(sgrCode(fgChanged ? cell.fgColor : null, bgChanged ? cell.bgColor : null));
          if (fgChanged) lastFg = cell.fgColor;
          if (bgChanged) lastBg = cell.bgColor;
        }

        chunks.push(cell.char);
      }
    }

    chunks.push(`${ESC}[0m`);
    return chunks.join('');
  }

  /**
   * Render only changed cells (for incremental update)
   * OPTIMIZED: Uses array.push + join instead of string concatenation
   * DELTA COMPRESSION: Tracks stats and uses efficient cursor movement
   */
  private renderChangedCells(cells: CellGrid): string {
    const chunks: string[] = [];
    let lastX = -2;
    let lastY = -1;
    let lastFg: { r: number; g: number; b: number } | null = null;
    let lastBg: { r: number; g: number; b: number } | null = null;

    // Stats tracking
    let changedCells = 0;
    let totalCells = 0;
    let contiguousRuns = 0;
    let cursorJumps = 0;

    for (let y = 0; y < cells.length; y++) {
      const row = cells[y];
      const prevRow = this.previousCells[y];
      if (!row) continue;

      // Quick row-level check: if row references are identical, skip entirely
      // This is a cheap pointer comparison before expensive cell comparison
      if (row === prevRow) {
        totalCells += row.length;
        continue;
      }

      for (let x = 0; x < row.length; x++) {
        const cell = row[x];
        const prevCell = prevRow?.[x];
        totalCells++;

        if (!cell || cellsEqual(cell, prevCell)) continue;

        changedCells++;

        // Move cursor only if not contiguous with last cell
        if (lastY !== y || lastX !== x - 1) {
          // Account for multi-char cells in normal mode
          const termCol = this.renderMode === 'normal' ? x * 2 + 1 : x + 1;

          // Use relative cursor movement when more efficient (same row, small gap)
          if (lastY === y && x > lastX && x - lastX <= 4) {
            // Cursor right is shorter than absolute for small gaps
            const spaces = this.renderMode === 'normal' ? (x - lastX - 1) * 2 : x - lastX - 1;
            if (spaces > 0) {
              chunks.push(`${ESC}[${spaces}C`);
            }
          } else {
            chunks.push(`${ESC}[${y + this.layout.headerRows + 1};${termCol}H`);
          }
          cursorJumps++;
        } else {
          contiguousRuns++;
        }

        // Emit color changes — merged into ONE SGR sequence when both change
        const fgChanged = cell.fgColor && (!lastFg || !colorsEqual(cell.fgColor, lastFg));
        const bgChanged = cell.bgColor && (!lastBg || !colorsEqual(cell.bgColor, lastBg));
        if (fgChanged || bgChanged) {
          chunks.push(sgrCode(fgChanged ? cell.fgColor : null, bgChanged ? cell.bgColor : null));
          if (fgChanged) lastFg = cell.fgColor;
          if (bgChanged) lastBg = cell.bgColor;
        }

        chunks.push(cell.char);
        lastX = x;
        lastY = y;
      }
    }

    if (chunks.length > 0) {
      chunks.push(`${ESC}[0m`);
    }

    // Record cell diff stats
    perfStats.recordCellDiff(changedCells, totalCells);

    return chunks.join('');
  }

  /**
   * Get current tick count
   */
  getTick(): number {
    return this.tickCount;
  }

  /**
   * Force full redraw on next render
   */
  invalidate(): void {
    this.forceRedraw = true;
    this.previousCells = [];
    this.previousStatsOutput = '';
    this.lastWorldRevision = null;
    this.lastComposedCameraX = Number.NaN;
    this.lastComposedCameraY = Number.NaN;
    this.terminalCodec.requestKeyframe();
    this.invalidateStatsBar();
  }

  /** Request an independently decodable transport frame after packet loss or
   * backpressure dropping. */
  requestKeyframe(): void {
    this.invalidate();
  }

  getCodecMetrics(): TerminalCodecMetrics | null {
    return this.lastCodecMetrics ? { ...this.lastCodecMetrics } : null;
  }

  /**
   * Get terminal dimensions
   */
  getDimensions(): { cols: number; rows: number } {
    return { cols: this.cols, rows: this.rows };
  }

  /**
   * Get viewport dimensions in tiles
   */
  getViewportTiles(): { widthTiles: number; heightTiles: number } {
    const availableRows = this.rows - this.layout.headerRows;
    return this.calculateViewportTiles(this.cols, availableRows);
  }

  /**
   * Get current zoom level (percentage)
   */
  getZoomLevel(): number {
    return this.zoomLevel;
  }

  getTargetZoomLevel(): number {
    return this.zoomTargetLevel;
  }

  /**
   * Set zoom level and recalculate viewport
   * @param level Zoom percentage (0-100). 0 = base view (sprite = 1 tile), 100 = max zoom (256px tiles)
   */
  setZoomLevel(level: number): void {
    const snapped = Math.round(clamp(level, 0, 100) / 10) * 10;
    this.zoomAnimationStartedAt = null;
    this.zoomFromLevel = snapped;
    this.zoomTargetLevel = snapped;
    this.zoomLevel = snapped;
    this.reconfigureZoomViewport();
  }

  /** Advance time-based renderer animations. Kept public so simulations and
   * deterministic tests can step the exact production zoom curve. */
  advanceAnimations(now: number = Date.now()): void {
    if (this.zoomAnimationStartedAt === null) return;
    const progress = clamp((now - this.zoomAnimationStartedAt) / this.ZOOM_ANIMATION_MS, 0, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const previousTileSize = this.viewportRenderer.getTileRenderSize();
    this.zoomLevel = this.zoomFromLevel + (this.zoomTargetLevel - this.zoomFromLevel) * eased;
    const nextTileSize = this.getCurrentTileSize();
    if (nextTileSize !== previousTileSize) this.reconfigureZoomViewport();
    if (progress >= 1) {
      this.zoomLevel = this.zoomTargetLevel;
      this.zoomAnimationStartedAt = null;
    }
  }

  private animateZoomTo(level: number): void {
    const target = Math.round(clamp(level, 0, 100) / 10) * 10;
    if (target === this.zoomTargetLevel && this.zoomAnimationStartedAt !== null) return;
    this.zoomFromLevel = this.zoomLevel;
    this.zoomTargetLevel = target;
    this.zoomAnimationStartedAt = Date.now();
  }

  private reconfigureZoomViewport(): void {
    this.viewportRenderer.setTileRenderSize(this.getCurrentTileSize());
    const availableRows = this.rows - this.layout.headerRows;
    const { widthTiles, heightTiles } = this.calculateViewportTiles(this.cols, availableRows);
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(this.cols, availableRows);
    this.viewportRenderer.resize(Math.max(1, widthTiles), Math.max(1, heightTiles));
    this.viewportRenderer.setPixelDimensions(pixelWidth, pixelHeight);
    this.cameraInitialized = false;
    this.updateFollowCamera(this.playerX, this.playerY);
    this.invalidate();
  }

  /**
   * Get current scale factor (for backwards compatibility)
   * @deprecated Use getZoomLevel() instead
   */
  getScale(): number {
    // Return 1 at 100% zoom (256px), 10 at 0% zoom (26px)
    return 10 - (this.zoomLevel / 100) * 9;
  }

  /**
   * Set scale factor (for backwards compatibility)
   * @deprecated Use setZoomLevel() instead
   */
  setScale(scale: number): void {
    // Convert scale to zoom level: scale 1 = 100%, scale 10 = 0%
    const zoomLevel = ((10 - scale) / 9) * 100;
    this.setZoomLevel(zoomLevel);
  }

  /**
   * Get current render mode
   */
  getRenderMode(): RenderMode {
    return this.renderMode;
  }

  /**
   * Set render mode and recalculate viewport
   */
  setRenderMode(mode: RenderMode): void {
    this.renderMode = mode;

    // Update tile size for new render mode
    const currentTileSize = this.getCurrentTileSize();
    this.viewportRenderer.setTileRenderSize(currentTileSize);

    const availableRows = this.rows - this.layout.headerRows;
    const { widthTiles, heightTiles } = this.calculateViewportTiles(this.cols, availableRows);
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(this.cols, availableRows);

    this.viewportRenderer.resize(
      Math.max(1, widthTiles),
      Math.max(1, heightTiles)
    );
    this.viewportRenderer.setPixelDimensions(pixelWidth, pixelHeight);

    this.cameraInitialized = false;
    this.updateFollowCamera(this.playerX, this.playerY);

    this.invalidate();
  }

  /**
   * Cycle through render modes
   */
  cycleRenderMode(): void {
    const modes: RenderMode[] = ['octant', 'braille', 'halfblock', 'normal'];
    const currentIndex = modes.indexOf(this.renderMode);
    const nextIndex = (currentIndex + 1) % modes.length;
    this.setRenderMode(modes[nextIndex]!);
  }

  /**
   * Zoom in by 10% (increase zoom level = more zoomed in, less world visible)
   */
  zoomIn(): void {
    this.animateZoomTo(this.zoomTargetLevel + 10);
  }

  /**
   * Zoom out by 10% (decrease zoom level = more zoomed out, more world visible)
   */
  zoomOut(): void {
    this.animateZoomTo(this.zoomTargetLevel - 10);
  }

  /**
   * Render a frame and return the output string without writing
   * Use this for batching multiple outputs together
   */
  renderToString(world: WorldDataProvider): string {
    const renderStart = Date.now();
    this.tickCount++;

    this.frameCount++;
    const now = Date.now();
    this.advanceAnimations(now);
    if (now - this.lastFpsUpdate >= 1000) {
      this.fps = this.frameCount;
      this.frameCount = 0;
      this.lastFpsUpdate = now;
    }

    // Generate stats bar
    const statsBar = this.renderStatsBar();
    const palettePacket = this.paletteAnimation
      ? osc4Packet(PALETTE.WATER, waterPalette(this.tickCount % PHASES))
      : '';
    const precomposeCamera = this.viewportRenderer.getCameraCenter();
    const worldRevision = world.getVisualRevision?.();
    const canSkipComposition =
      worldRevision !== undefined &&
      this.lastWorldRevision === worldRevision &&
      precomposeCamera.x === this.lastComposedCameraX &&
      precomposeCamera.y === this.lastComposedCameraY &&
      !this.forceRedraw;

    if (canSkipComposition) {
      if (statsBar === this.previousStatsOutput && !palettePacket) {
        this.lastFrameBytes = 0;
        this.lastRenderTime = Date.now() - renderStart;
        return '';
      }
      const statsOutput = statsBar === this.previousStatsOutput
        ? ''
        : `${ESC}[1;1H${statsBar}${ESC}[0m`;
      const output = `${SYNC_BEGIN}${statsOutput}${palettePacket}${SYNC_END}`;
      if (statsOutput) this.previousStatsOutput = statsBar;
      this.lastFrameBytes = Buffer.byteLength(output, 'utf8');
      this.lastRenderTime = Date.now() - renderStart;
      return output;
    }

    // Render viewport to a structured cell grid. Production used to stringify
    // whole ANSI lines here; any camera movement changed every line and forced
    // a near-full-frame repaint. Keeping structure is what lets TerminalCodec
    // motion-compensate the retained terminal framebuffer.
    const { buffer, overlays, brightnessGrid, materialGrid } = this.viewportRenderer.renderToBuffer(world, this.tickCount);

    // Apply color quantization with dithering at high zoom levels to reduce ANSI codes
    let quantizedBuffer = buffer;
    if (this.zoomLevel > 70) {
      quantizedBuffer = quantizeGridDithered(buffer, 4);
    } else if (this.zoomLevel > 50) {
      quantizedBuffer = quantizeGridDithered(buffer, 5);
    }

    let viewportCells: CellGrid;
    switch (this.renderMode) {
      case 'octant':
        viewportCells = renderOctantGridCells(quantizedBuffer, brightnessGrid, materialGrid);
        break;
      case 'braille':
        viewportCells = renderBrailleGridCells(quantizedBuffer, brightnessGrid);
        break;
      case 'halfblock':
        viewportCells = renderHalfBlockGridCells(quantizedBuffer, brightnessGrid);
        break;
      case 'normal':
      default:
        viewportCells = renderNormalGridCells(quantizedBuffer);
        break;
    }

    this.applyTextOverlays(viewportCells, overlays);

    const cameraCenter = this.viewportRenderer.getCameraCenter();
    const geometry = this.getCellGeometry();
    const encoded = this.terminalCodec.encode(viewportCells, {
      x: cameraCenter.x,
      y: cameraCenter.y,
      rotation: this.viewportRenderer.getCameraRotation(),
      ...geometry,
    });
    this.lastCodecMetrics = encoded.metrics;
    this.lastWorldRevision = worldRevision ?? null;
    this.lastComposedCameraX = cameraCenter.x;
    this.lastComposedCameraY = cameraCenter.y;

    const chunks: string[] = [];
    // The HUD is outside the scroll margins and changes at most once per second.
    if (statsBar !== this.previousStatsOutput || encoded.metrics.keyframe) {
      chunks.push(`${ESC}[1;1H${statsBar}${ESC}[0m`);
      this.previousStatsOutput = statsBar;
    }
    chunks.push(encoded.output);
    chunks.push(palettePacket);

    let output = chunks.join('');
    if (output) output = SYNC_BEGIN + output + SYNC_END;
    this.lastFrameBytes = Buffer.byteLength(output, 'utf8');
    this.lastRenderTime = Date.now() - renderStart;
    this.forceRedraw = false;
    return output;
  }

  /** Fold text overlays into the retained CellGrid so old labels are repaired
   * by the same dirty-cell pass instead of leaving ANSI trails behind. */
  private applyTextOverlays(cells: CellGrid, overlays: TextOverlay[]): void {
    if (this.renderMode === 'normal') return;
    for (const overlay of overlays) {
      const { row, col } = this.pixelToTerminal(overlay.pixelX, overlay.pixelY);
      if (row < 0 || row >= cells.length) continue;
      const text = ` ${overlay.text} `;
      const start = Math.max(0, col - Math.floor(text.length / 2));
      for (let i = 0; i < text.length; i++) {
        const x = start + i;
        if (x >= (cells[row]?.length ?? 0)) break;
        cells[row]![x] = {
          char: text[i]!,
          fgColor: overlay.fgColor,
          bgColor: overlay.bgColor,
        };
      }
    }
  }

  /**
   * Write output directly to stream (for standalone use)
   */
  writeOutput(output: string): void {
    if (output) {
      this.stream.write(output);
    }
  }

  // ========================================
  // Camera Control Methods
  // ========================================

  /**
   * Get current camera mode ('follow' or 'free')
   */
  getCameraMode(): CameraMode {
    return this.viewportRenderer.getCameraMode();
  }

  /**
   * Set camera mode
   */
  setCameraMode(mode: CameraMode): void {
    this.viewportRenderer.setCameraMode(mode);
  }

  /**
   * Toggle between 'follow' and 'free' camera modes
   * Returns the new mode
   */
  toggleCameraMode(): CameraMode {
    return this.viewportRenderer.toggleCameraMode();
  }

  /**
   * Pan the camera by pixel offset (for free camera mode)
   * In follow mode, this has no effect until mode is changed
   */
  panCamera(deltaX: number, deltaY: number): void {
    this.viewportRenderer.panCamera(deltaX, deltaY);
  }

  /**
   * Pan the camera by tile offset (more convenient for keyboard controls)
   * Pans by the current tile render size
   */
  panCameraByTiles(deltaTilesX: number, deltaTilesY: number): void {
    this.viewportRenderer.panCameraByTiles(deltaTilesX, deltaTilesY);
  }

  /**
   * Get current camera rotation (0, 90, 180, or 270 degrees)
   */
  getCameraRotation(): CameraRotation {
    return this.viewportRenderer.getCameraRotation();
  }

  /**
   * Rotate camera clockwise by 90 degrees
   * Returns the new rotation
   */
  rotateCameraClockwise(): CameraRotation {
    return this.viewportRenderer.rotateCameraClockwise();
  }

  /**
   * Rotate camera counter-clockwise by 90 degrees
   * Returns the new rotation
   */
  rotateCameraCounterClockwise(): CameraRotation {
    return this.viewportRenderer.rotateCameraCounterClockwise();
  }

  /**
   * Get the world direction for a screen direction based on camera rotation
   * Used for screen-relative movement controls
   */
  getWorldDirection(screenDirection: Direction): Direction {
    return this.viewportRenderer.getWorldDirection(screenDirection);
  }

  /**
   * Snap camera back to follow target (player position)
   * Useful after panning in free mode
   */
  snapCameraToPlayer(): void {
    this.cameraTileX = this.playerX;
    this.cameraTileY = this.playerY;
    this.cameraInitialized = true;
    this.viewportRenderer.setCamera(this.playerX, this.playerY);
    this.viewportRenderer.snapToTarget();
    this.lastComposedCameraX = Number.NaN;
    this.lastComposedCameraY = Number.NaN;
    this.forceRedraw = true;
  }

  /**
   * Get camera center in world pixels
   */
  getCameraCenter(): { x: number; y: number } {
    return this.viewportRenderer.getCameraCenter();
  }

  /**
   * Get camera center in tile coordinates
   */
  getCameraTilePosition(): { x: number; y: number } {
    return this.viewportRenderer.getCameraTilePosition();
  }

  // ========================================
  // Layout Configuration Methods
  // ========================================

  /**
   * Get current layout configuration
   */
  getLayout(): LayoutConfig {
    return { ...this.layout };
  }

  /**
   * Update layout configuration
   * Use this to reserve space for UI elements (chat, sidebar, footer)
   */
  setLayout(newLayout: Partial<LayoutConfig>): void {
    this.layout = { ...this.layout, ...newLayout };

    // Recalculate viewport
    const { availableCols, availableRows } = this.getViewportArea();
    const { widthTiles, heightTiles } = this.calculateViewportTiles(availableCols, availableRows);
    const { pixelWidth, pixelHeight } = this.calculatePixelDimensions(availableCols, availableRows);

    this.viewportRenderer.setTileRenderSize(this.getCurrentTileSize());
    this.viewportRenderer.resize(
      Math.max(1, widthTiles),
      Math.max(1, heightTiles)
    );
    this.viewportRenderer.setPixelDimensions(pixelWidth, pixelHeight);
    this.cameraInitialized = false;
    this.updateFollowCamera(this.playerX, this.playerY);
    this.terminalCodec = new TerminalCodec({
      headerRows: this.layout.headerRows,
      terminalCols: availableCols,
      terminalRows: this.rows,
    });

    this.invalidate();
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
