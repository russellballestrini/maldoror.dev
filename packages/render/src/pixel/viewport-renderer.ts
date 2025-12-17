import type {
  PixelGrid,
  PlayerVisualState,
  RGB,
  WorldDataProvider
} from '@maldoror/protocol';
import { TILE_SIZE, RESOLUTIONS } from '@maldoror/protocol';
import {
  createEmptyGrid,
  renderPixelRow,
} from './pixel-renderer.js';

/**
 * Viewport configuration
 */
export interface ViewportConfig {
  widthTiles: number;   // Viewport width in tiles
  heightTiles: number;  // Viewport height in tiles
  tileRenderSize?: number;  // Tile screen render size in pixels (default: TILE_SIZE)
  dataResolution?: number;  // Resolution to fetch from pre-computed data (default: auto-select)
}

/**
 * Text overlay to render on top of the pixel buffer
 */
export interface TextOverlay {
  text: string;
  pixelX: number;  // X position in pixels (will be converted to terminal chars)
  pixelY: number;  // Y position in pixels (will be converted to terminal rows)
  bgColor: RGB;
  fgColor: RGB;
}

/**
 * Result of rendering the viewport
 */
export interface ViewportRenderResult {
  buffer: PixelGrid;
  overlays: TextOverlay[];
}

// Re-export for convenience
export type { WorldDataProvider } from '@maldoror/protocol';

/**
 * Render the game viewport to ANSI strings
 */
export class ViewportRenderer {
  private config: ViewportConfig;
  private cameraX: number = 0;  // Camera position in tiles
  private cameraY: number = 0;
  private pendingOverlays: TextOverlay[] = [];  // Collected during render
  private tileRenderSize: number;  // Tile screen render size in pixels
  private dataResolution: number;  // Resolution to fetch from pre-computed data

  constructor(config: ViewportConfig) {
    this.config = config;
    this.tileRenderSize = config.tileRenderSize ?? TILE_SIZE;
    this.dataResolution = config.dataResolution ?? this.getBestResolution(this.tileRenderSize);
  }

  /**
   * Get current tile render size
   */
  getTileRenderSize(): number {
    return this.tileRenderSize;
  }

  /**
   * Set tile render size and auto-select data resolution
   */
  setTileRenderSize(size: number): void {
    this.tileRenderSize = size;
    this.dataResolution = this.getBestResolution(size);
  }

  /**
   * Get current data resolution being used
   */
  getDataResolution(): number {
    return this.dataResolution;
  }

  /**
   * Set camera position (centered on player)
   */
  setCamera(tileX: number, tileY: number): void {
    this.cameraX = tileX - Math.floor(this.config.widthTiles / 2);
    this.cameraY = tileY - Math.floor(this.config.heightTiles / 2);
  }

  /**
   * Render the viewport and return array of ANSI strings (one per terminal row)
   */
  render(world: WorldDataProvider, tick: number): string[] {
    const result = this.renderToBuffer(world, tick);
    return this.bufferToAnsi(result.buffer);
  }

  // Sprite overflow padding - sprites are now scaled to tile size, so no overflow needed
  // Keep small padding for safety
  private spriteOverflowX = 0;
  private spriteOverflowY = 0;

  /**
   * Render the viewport to a raw pixel buffer with text overlays
   */
  renderToBuffer(world: WorldDataProvider, tick: number): ViewportRenderResult {
    // Reset overlays for this frame
    this.pendingOverlays = [];

    // Calculate pixel dimensions using current tile render size
    const pixelWidth = this.config.widthTiles * this.tileRenderSize;
    const pixelHeight = this.config.heightTiles * this.tileRenderSize;

    // Create the pixel buffer
    const buffer = createEmptyGrid(pixelWidth, pixelHeight);

    // 1. Render tiles (offset by sprite overflow padding)
    this.renderTiles(buffer, world, tick);

    // 2. Render players (sorted by Y for proper overlap)
    this.renderPlayers(buffer, world, tick);

    return {
      buffer,
      overlays: this.pendingOverlays,
    };
  }

  /**
   * Render tiles to buffer
   */
  private renderTiles(buffer: PixelGrid, world: WorldDataProvider, tick: number): void {
    // Use the pre-selected data resolution
    const resKey = String(this.dataResolution);

    for (let ty = 0; ty < this.config.heightTiles; ty++) {
      for (let tx = 0; tx < this.config.widthTiles; tx++) {
        const worldTileX = this.cameraX + tx;
        const worldTileY = this.cameraY + ty;
        const tile = world.getTile(worldTileX, worldTileY);

        if (tile) {
          // Get the right frame for animated tiles, using pre-computed resolution if available
          let tilePixels: PixelGrid;
          if (tile.animated && tile.animationFrames) {
            const frameIndex = Math.floor(tick / 15) % tile.animationFrames.length;
            // Try animation resolutions first
            if (tile.animationResolutions?.[resKey]) {
              tilePixels = tile.animationResolutions[resKey][frameIndex] ?? tile.pixels;
            } else {
              tilePixels = tile.animationFrames[frameIndex] ?? tile.pixels;
            }
          } else {
            // Use pre-computed resolution if available
            tilePixels = tile.resolutions?.[resKey] ?? tile.pixels;
          }

          // Scale to exact tile render size if needed
          const scaledPixels = this.scaleFrame(tilePixels, this.tileRenderSize, this.tileRenderSize);

          // Copy tile pixels to buffer
          const bufferX = tx * this.tileRenderSize;
          const bufferY = ty * this.tileRenderSize;

          for (let py = 0; py < this.tileRenderSize && py < scaledPixels.length; py++) {
            const tileRow = scaledPixels[py];
            if (!tileRow) continue;

            for (let px = 0; px < this.tileRenderSize && px < tileRow.length; px++) {
              const pixel = tileRow[px];
              if (pixel && buffer[bufferY + py]) {
                buffer[bufferY + py]![bufferX + px] = pixel;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Get the best resolution size for the current render size
   */
  private getBestResolution(targetSize: number): number {
    // Find the closest resolution that is >= targetSize
    for (const res of RESOLUTIONS) {
      if (res >= targetSize) return res;
    }
    // If target is larger than max, return max
    return RESOLUTIONS[RESOLUTIONS.length - 1] ?? 256;
  }

  /**
   * Scale a sprite frame to target size using nearest-neighbor sampling
   */
  private scaleFrame(frame: PixelGrid, targetWidth: number, targetHeight: number): PixelGrid {
    const srcHeight = frame.length;
    const srcWidth = frame[0]?.length ?? 0;

    // If already correct size, return as-is
    if (srcWidth === targetWidth && srcHeight === targetHeight) {
      return frame;
    }

    const result: PixelGrid = [];
    for (let y = 0; y < targetHeight; y++) {
      const row: (RGB | null)[] = [];
      const srcY = Math.floor(y * srcHeight / targetHeight);
      for (let x = 0; x < targetWidth; x++) {
        const srcX = Math.floor(x * srcWidth / targetWidth);
        row.push(frame[srcY]?.[srcX] ?? null);
      }
      result.push(row);
    }
    return result;
  }

  /**
   * Render players to buffer
   */
  private renderPlayers(buffer: PixelGrid, world: WorldDataProvider, _tick: number): void {
    const players = world.getPlayers();
    const localId = world.getLocalPlayerId();

    // Sort by Y position for proper layering (lower Y drawn first)
    const sortedPlayers = [...players].sort((a, b) => a.y - b.y);

    for (const player of sortedPlayers) {
      const sprite = world.getPlayerSprite(player.userId);
      if (!sprite) {
        // Render placeholder if no sprite
        this.renderPlaceholderPlayer(buffer, player);
        continue;
      }

      // Use the pre-selected data resolution
      const resKey = String(this.dataResolution);

      // Try to get pre-computed resolution, fall back to base frames
      let directionFrames = sprite.resolutions?.[resKey]?.[player.direction];
      if (!directionFrames) {
        directionFrames = sprite.frames[player.direction];
      }

      const rawFrame = directionFrames[player.animationFrame];
      if (!rawFrame) continue;

      // Scale to exact tile render size if needed
      const frame = this.scaleFrame(rawFrame, this.tileRenderSize, this.tileRenderSize);

      // Calculate screen position in pixels
      // Player position is in tiles, sprite is now tile-sized
      const screenTileX = player.x - this.cameraX;
      const screenTileY = player.y - this.cameraY;

      // Position sprite at the tile location
      const bufferX = screenTileX * this.tileRenderSize;
      const bufferY = screenTileY * this.tileRenderSize;

      // Composite sprite onto buffer
      for (let py = 0; py < frame.length; py++) {
        const spriteRow = frame[py];
        if (!spriteRow) continue;

        const targetY = bufferY + py;
        if (targetY < 0 || targetY >= buffer.length) continue;

        for (let px = 0; px < spriteRow.length; px++) {
          const pixel = spriteRow[px];
          if (pixel === null || pixel === undefined) continue;  // Transparent or undefined

          const targetX = bufferX + px;
          if (targetX < 0 || targetX >= (buffer[targetY]?.length ?? 0)) continue;

          buffer[targetY]![targetX] = pixel;
        }
      }

      // Add username overlay above sprite for other players
      if (player.userId !== localId) {
        // Center the username above the sprite
        const usernamePixelX = bufferX + Math.floor(this.tileRenderSize / 2);
        const usernamePixelY = bufferY - Math.max(6, Math.floor(this.tileRenderSize / 10));  // Scale overlay offset

        this.pendingOverlays.push({
          text: player.username,
          pixelX: usernamePixelX,
          pixelY: usernamePixelY,
          bgColor: { r: 40, g: 40, b: 60 },    // Dark blue-gray background
          fgColor: { r: 255, g: 255, b: 255 }, // White text
        });
      }
    }
  }

  /**
   * Render a placeholder for players without sprites
   * This is a small fallback marker - the actual placeholder sprite is generated separately
   */
  private renderPlaceholderPlayer(buffer: PixelGrid, player: PlayerVisualState): void {
    const screenTileX = player.x - this.cameraX;
    const screenTileY = player.y - this.cameraY;

    if (screenTileX < 0 || screenTileX >= this.config.widthTiles ||
        screenTileY < 0 || screenTileY >= this.config.heightTiles) {
      return;
    }

    // Marker is same size as current tile render size
    const markerSize = this.tileRenderSize;
    const bufferX = screenTileX * this.tileRenderSize + this.spriteOverflowX;
    const bufferY = screenTileY * this.tileRenderSize + this.spriteOverflowY;

    // Simple colored square placeholder
    const placeholderColor: RGB = { r: 255, g: 200, b: 50 };
    for (let py = 0; py < markerSize; py++) {
      for (let px = 0; px < markerSize; px++) {
        const targetY = bufferY + py;
        const targetX = bufferX + px;
        if (targetY >= 0 && targetY < buffer.length &&
            targetX >= 0 && targetX < (buffer[targetY]?.length ?? 0)) {
          buffer[targetY]![targetX] = placeholderColor;
        }
      }
    }
  }

  /**
   * Convert pixel buffer to ANSI strings
   */
  private bufferToAnsi(buffer: PixelGrid): string[] {
    return buffer.map(row => renderPixelRow(row));
  }

  /**
   * Get viewport dimensions in terminal characters
   */
  getTerminalDimensions(): { width: number; height: number } {
    return {
      width: this.config.widthTiles * this.tileRenderSize * 2,  // 2 chars per pixel
      height: this.config.heightTiles * this.tileRenderSize,     // 1 char per pixel row
    };
  }

  /**
   * Resize viewport
   */
  resize(widthTiles: number, heightTiles: number): void {
    this.config.widthTiles = widthTiles;
    this.config.heightTiles = heightTiles;
  }
}
