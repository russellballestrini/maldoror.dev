import type {
  PixelGrid,
  PlayerVisualState,
  NPCVisualState,
  RGB,
  WorldDataProvider,
  Direction,
  BuildingDirection
} from '@maldoror/protocol';
import { materialPhase } from './palette-cycle.js';
import { resamplePixelGrid } from './pixel-resampler.js';
import { TILE_SIZE, RESOLUTIONS } from '@maldoror/protocol';
import {
  createEmptyGrid,
  renderPixelRow,
} from './pixel-renderer.js';

/**
 * Viewport configuration
 */
export interface ViewportConfig {
  widthTiles: number;   // Viewport width in tiles (used for tile count calculation)
  heightTiles: number;  // Viewport height in tiles (used for tile count calculation)
  pixelWidth?: number;  // Actual pixel width of viewport (fills screen, allows partial tiles)
  pixelHeight?: number; // Actual pixel height of viewport (fills screen, allows partial tiles)
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
  brightnessGrid?: number[][];  // Cell-level brightness for lighting
  /** 0 = truecolor/default, 1 = water palette band. */
  materialGrid?: Uint8Array[];
}

// Re-export for convenience
export type { WorldDataProvider } from '@maldoror/protocol';

/**
 * Camera mode
 */
export type CameraMode = 'follow' | 'free';

/**
 * Camera rotation angle (90° increments)
 */
export type CameraRotation = 0 | 90 | 180 | 270;

/**
 * Direction remapping for camera rotation
 * Maps world direction → visual direction based on camera angle
 */
const DIRECTION_REMAP: Record<CameraRotation, Record<Direction, Direction>> = {
  0:   { up: 'up',    down: 'down',  left: 'left',  right: 'right' },
  90:  { up: 'right', down: 'left',  left: 'up',    right: 'down'  },
  180: { up: 'down',  down: 'up',    left: 'right', right: 'left'  },
  270: { up: 'left',  down: 'right', left: 'down',  right: 'up'    },
};

/**
 * Movement remapping for screen-relative controls
 * Maps screen direction → world direction based on camera angle
 */
export const MOVEMENT_REMAP: Record<CameraRotation, Record<Direction, Direction>> = {
  0:   { up: 'up',    down: 'down',  left: 'left',  right: 'right' },
  90:  { up: 'left',  down: 'right', left: 'down',  right: 'up'    },
  180: { up: 'down',  down: 'up',    left: 'right', right: 'left'  },
  270: { up: 'right', down: 'left',  left: 'up',    right: 'down'  },
};

/**
 * Camera rotation to building direction mapping
 * When camera rotates, we show the building from a different direction
 */
const CAMERA_TO_BUILDING_DIRECTION: Record<CameraRotation, BuildingDirection> = {
  0:   'north',
  90:  'east',
  180: 'south',
  270: 'west',
};

// Characters are bottom-centre anchored and intentionally exceed one terrain
// tile. At exactly one tile, a naturally proportioned figure is only six
// source pixels wide at the reference zoom and loses its face/limbs during
// octant reconstruction. This modest semantic LOD preserves recognition while
// keeping feet and collision on the authoritative world tile.
const ENTITY_RENDER_SCALE = 1.25;

/**
 * Rotate a point around the origin by camera angle
 * Used to transform world coordinates to screen-relative coordinates
 */
function rotatePoint(x: number, y: number, angle: CameraRotation): { x: number; y: number } {
  switch (angle) {
    case 0:   return { x, y };
    case 90:  return { x: -y, y: x };
    case 180: return { x: -x, y: -y };
    case 270: return { x: y, y: -x };
  }
}

/**
 * Render the game viewport to ANSI strings
 */
export class ViewportRenderer {
  private config: ViewportConfig;
  // Camera center position in WORLD PIXELS (sub-tile precision)
  private cameraCenterX: number = 0;
  private cameraCenterY: number = 0;
  // Target position for smooth camera (when following player)
  private targetCenterX: number = 0;
  private targetCenterY: number = 0;
  // Camera mode
  private cameraMode: CameraMode = 'follow';
  // Camera rotation (0°, 90°, 180°, 270°)
  private cameraRotation: CameraRotation = 0;
  private pendingOverlays: TextOverlay[] = [];  // Collected during render
  private tileRenderSize: number;  // Tile screen render size in pixels
  private dataResolution: number;  // Resolution to fetch from pre-computed data
  // Performance: Cache scaled frames to avoid repeated scaling
  private scaledFrameCache: Map<string, PixelGrid> = new Map();
  private scaledFrameCacheOrder: string[] = []; // LRU order tracking
  private scaledMaterialMaskCache: Map<string, Uint8Array[]> = new Map();
  private scaledMaterialMaskCacheOrder: string[] = [];
  private readonly MAX_CACHE_SIZE = 500; // Max cached frames to prevent memory explosion
  private lastCacheClearSize: number = 0;
  // Performance: Reused frame buffer — allocating W*H pixel rows every frame
  // was a major GC pressure source. Recreated only when dimensions change.
  private frameBuffer: PixelGrid | null = null;
  private materialBuffer: Uint8Array[] | null = null;

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
    const oldSize = this.tileRenderSize;
    this.tileRenderSize = size;
    this.dataResolution = this.getBestResolution(size);
    // Scale camera position to maintain world position when tile size changes
    if (oldSize > 0) {
      const scale = size / oldSize;
      this.cameraCenterX *= scale;
      this.cameraCenterY *= scale;
      this.targetCenterX *= scale;
      this.targetCenterY *= scale;
    }
  }

  /**
   * Get current data resolution being used
   */
  getDataResolution(): number {
    return this.dataResolution;
  }

  /**
   * Get camera mode
   */
  getCameraMode(): CameraMode {
    return this.cameraMode;
  }

  /**
   * Set camera mode
   */
  setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
  }

  /**
   * Toggle between follow and free camera modes
   */
  toggleCameraMode(): CameraMode {
    this.cameraMode = this.cameraMode === 'follow' ? 'free' : 'follow';
    return this.cameraMode;
  }

  /**
   * Get camera rotation
   */
  getCameraRotation(): CameraRotation {
    return this.cameraRotation;
  }

  /**
   * Rotate camera clockwise by 90°
   */
  rotateCameraClockwise(): CameraRotation {
    this.cameraRotation = ((this.cameraRotation + 90) % 360) as CameraRotation;
    return this.cameraRotation;
  }

  /**
   * Rotate camera counter-clockwise by 90°
   */
  rotateCameraCounterClockwise(): CameraRotation {
    this.cameraRotation = ((this.cameraRotation + 270) % 360) as CameraRotation;
    return this.cameraRotation;
  }

  /**
   * Get the visual direction for a world direction based on camera rotation
   */
  getVisualDirection(worldDirection: Direction): Direction {
    return DIRECTION_REMAP[this.cameraRotation][worldDirection];
  }

  /**
   * Get the world direction for a screen direction based on camera rotation
   * Used for screen-relative movement controls
   */
  getWorldDirection(screenDirection: Direction): Direction {
    return MOVEMENT_REMAP[this.cameraRotation][screenDirection];
  }

  /**
   * Get the building direction for current camera rotation
   * Used to select which building sprite rotation to render
   */
  getBuildingDirection(): BuildingDirection {
    return CAMERA_TO_BUILDING_DIRECTION[this.cameraRotation];
  }

  /**
   * Transform world pixel coordinates to screen pixel coordinates
   * Applies camera rotation around the camera center point
   */
  private worldToScreen(worldX: number, worldY: number, cameraX: number, cameraY: number): { x: number; y: number } {
    // Get offset from camera center in world coordinates
    const offsetX = worldX - cameraX;
    const offsetY = worldY - cameraY;
    // Rotate the offset
    const rotated = rotatePoint(offsetX, offsetY, this.cameraRotation);
    return rotated;  // Returns offset from screen center
  }

  /**
   * Set camera to center on a tile position (used when following player)
   * Camera tracks the CENTER of the given tile in world pixels
   */
  setCamera(tileX: number, tileY: number): void {
    // Target is the CENTER of the player's tile (in world pixels)
    this.targetCenterX = (tileX + 0.5) * this.tileRenderSize;
    this.targetCenterY = (tileY + 0.5) * this.tileRenderSize;

    // In follow mode, snap to target (or could lerp for smooth follow)
    if (this.cameraMode === 'follow') {
      this.cameraCenterX = this.targetCenterX;
      this.cameraCenterY = this.targetCenterY;
    }
  }

  /**
   * Pan the camera by pixel offset (for free camera mode)
   */
  panCamera(deltaX: number, deltaY: number): void {
    this.cameraCenterX += deltaX;
    this.cameraCenterY += deltaY;
  }

  /**
   * Pan the camera by tile offset
   */
  panCameraByTiles(deltaTilesX: number, deltaTilesY: number): void {
    this.cameraCenterX += deltaTilesX * this.tileRenderSize;
    this.cameraCenterY += deltaTilesY * this.tileRenderSize;
  }

  /**
   * Snap camera back to follow target (player position)
   */
  snapToTarget(): void {
    this.cameraCenterX = this.targetCenterX;
    this.cameraCenterY = this.targetCenterY;
  }

  /**
   * Get camera center in world pixels
   */
  getCameraCenter(): { x: number; y: number } {
    return { x: this.cameraCenterX, y: this.cameraCenterY };
  }

  /**
   * Get camera center in tile coordinates
   */
  getCameraTilePosition(): { x: number; y: number } {
    return {
      x: this.cameraCenterX / this.tileRenderSize - 0.5,
      y: this.cameraCenterY / this.tileRenderSize - 0.5,
    };
  }

  /**
   * Get the top-left world pixel coordinate of the viewport
   */
  private getViewportOrigin(): { x: number; y: number } {
    // Use explicit pixel dimensions if set, otherwise calculate from tiles
    const viewportPixelWidth = this.config.pixelWidth ?? (this.config.widthTiles * this.tileRenderSize);
    const viewportPixelHeight = this.config.pixelHeight ?? (this.config.heightTiles * this.tileRenderSize);
    return {
      x: this.cameraCenterX - viewportPixelWidth / 2,
      y: this.cameraCenterY - viewportPixelHeight / 2,
    };
  }

  /**
   * Render the viewport and return array of ANSI strings (one per terminal row)
   */
  render(world: WorldDataProvider, tick: number): string[] {
    const result = this.renderToBuffer(world, tick);
    return this.bufferToAnsi(result.buffer);
  }

  /**
   * Render the viewport to a raw pixel buffer with text overlays
   */
  renderToBuffer(world: WorldDataProvider, tick: number): ViewportRenderResult {
    // Reset overlays for this frame
    this.pendingOverlays = [];

    // Use explicit pixel dimensions if set, otherwise calculate from tiles
    // This allows filling the entire screen with partial tiles at edges
    const pixelWidth = this.config.pixelWidth ?? (this.config.widthTiles * this.tileRenderSize);
    const pixelHeight = this.config.pixelHeight ?? (this.config.heightTiles * this.tileRenderSize);

    // Reuse the frame buffer across frames (clear-in-place instead of realloc)
    // NOTE: callers consume the buffer synchronously (pixels -> cells) before
    // the next renderToBuffer call, so in-place reuse is safe.
    if (!this.frameBuffer ||
        this.frameBuffer.length !== pixelHeight ||
        (this.frameBuffer[0]?.length ?? 0) !== pixelWidth) {
      this.frameBuffer = createEmptyGrid(pixelWidth, pixelHeight);
    } else {
      for (const row of this.frameBuffer) row.fill(null);
    }
    const buffer = this.frameBuffer;
    if (!this.materialBuffer ||
        this.materialBuffer.length !== pixelHeight ||
        (this.materialBuffer[0]?.length ?? 0) !== pixelWidth) {
      this.materialBuffer = Array.from({ length: pixelHeight }, () => new Uint8Array(pixelWidth));
    } else {
      for (const row of this.materialBuffer) row.fill(0);
    }
    const materialGrid = this.materialBuffer;

    // Get viewport origin in world pixels
    const origin = this.getViewportOrigin();

    // 1. Render terrain tiles with sub-pixel offset
    this.renderTiles(buffer, materialGrid, world, tick, origin);

    // 2. Render road tiles on top of terrain (with transparency)
    this.renderRoads(buffer, materialGrid, world, origin);

    // 3. Render building tiles on top of roads (with transparency)
    this.renderBuildings(buffer, materialGrid, world, origin);

    // 4. Render players and NPCs together (sorted by Y for proper overlap)
    this.renderEntities(buffer, materialGrid, world, tick, origin);

    // 5. Generate brightness grid if world supports it
    let brightnessGrid: number[][] | undefined;
    if (world.generateBrightnessGrid) {
      // Calculate cell dimensions based on render mode
      // For braille: 2 pixels wide, 4 pixels tall per cell
      // For halfblock: 1 pixel wide, 2 pixels tall per cell
      // We'll use braille dimensions as the default
      const cellWidth = 2;
      const cellHeight = 4;
      const cellsWide = Math.ceil(pixelWidth / cellWidth);
      const cellsHigh = Math.ceil(pixelHeight / cellHeight);

      // Convert viewport origin from pixels to tiles
      const originTileX = Math.floor(this.cameraCenterX / this.tileRenderSize) - Math.floor(this.config.widthTiles / 2);
      const originTileY = Math.floor(this.cameraCenterY / this.tileRenderSize) - Math.floor(this.config.heightTiles / 2);

      // Tiles per cell (approximate, based on zoom level)
      const tilesPerCellX = (cellWidth / this.tileRenderSize) || 1;
      const tilesPerCellY = (cellHeight / this.tileRenderSize) || 1;

      brightnessGrid = world.generateBrightnessGrid(
        originTileX,
        originTileY,
        cellsWide,
        cellsHigh,
        tilesPerCellX,
        tilesPerCellY
      );
    }

    return {
      buffer,
      overlays: this.pendingOverlays,
      brightnessGrid,
      materialGrid,
    };
  }

  /**
   * Compute the EXACT world-tile bounds visible in the viewport.
   *
   * Camera rotation is restricted to 90° increments, so the visible world
   * region is always an axis-aligned rectangle: for 0°/180° it spans
   * (±bufW/2, ±bufH/2) around the camera; for 90°/270° width/height swap.
   * The old code scanned a SQUARE of radius max(bufW,bufH)/tileSize + 2 on
   * both axes — 4-10x more tiles than visible at low zoom levels.
   */
  private getVisibleTileBounds(bufW: number, bufH: number): {
    startTileX: number; startTileY: number; endTileX: number; endTileY: number;
  } {
    const swap = this.cameraRotation === 90 || this.cameraRotation === 270;
    const worldHalfX = (swap ? bufH : bufW) / 2;
    const worldHalfY = (swap ? bufW : bufH) / 2;
    const ts = this.tileRenderSize;
    return {
      startTileX: Math.floor((this.cameraCenterX - worldHalfX) / ts) - 1,
      endTileX: Math.floor((this.cameraCenterX + worldHalfX) / ts) + 1,
      startTileY: Math.floor((this.cameraCenterY - worldHalfY) / ts) - 1,
      endTileY: Math.floor((this.cameraCenterY + worldHalfY) / ts) + 1,
    };
  }

  /**
   * Render tiles to buffer with sub-pixel camera positioning and camera rotation
   */
  private renderTiles(buffer: PixelGrid, materialGrid: Uint8Array[], world: WorldDataProvider, tick: number, _origin: { x: number; y: number }): void {
    // Use the pre-selected data resolution
    const resKey = String(this.dataResolution);

    // Screen center in buffer coordinates
    const screenCenterX = buffer[0]!.length / 2;
    const screenCenterY = buffer.length / 2;

    // Exact visible tile range (rotation-aware, axis-aligned)
    const { startTileX, startTileY, endTileX, endTileY } =
      this.getVisibleTileBounds(buffer[0]!.length, buffer.length);

    for (let worldTileY = startTileY; worldTileY <= endTileY; worldTileY++) {
      for (let worldTileX = startTileX; worldTileX <= endTileX; worldTileX++) {
        const tile = world.getTileAtResolution?.(
          worldTileX,
          worldTileY,
          this.tileRenderSize,
        ) ?? world.getTile(worldTileX, worldTileY);

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

          // Scale to exact tile render size if needed (with caching)
          const frameId = tile.animated
            ? `tile:${tile.id}:${Math.floor(tick / 15) % (tile.animationFrames?.length ?? 1)}`
            : `tile:${tile.id}`;
          const scaledPixels = this.scaleFrame(tilePixels, this.tileRenderSize, this.tileRenderSize, frameId);
          const scaledMaterialMask = tile.materialMask
            ? this.scaleMaterialMask(
                tile.materialMask,
                this.tileRenderSize,
                this.tileRenderSize,
                frameId,
              )
            : undefined;

          // Calculate screen position with rotation
          // World pixel position of tile center
          const worldPixelX = (worldTileX + 0.5) * this.tileRenderSize;
          const worldPixelY = (worldTileY + 0.5) * this.tileRenderSize;
          // Transform to screen coordinates (offset from screen center)
          const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
          // Convert to buffer coordinates (top-left of tile)
          // Use Math.floor for consistent alignment of adjacent tiles
          const screenX = Math.floor(screenCenterX + screenOffset.x - this.tileRenderSize / 2);
          const screenY = Math.floor(screenCenterY + screenOffset.y - this.tileRenderSize / 2);

          // Copy tile pixels to buffer (handling partial tiles at edges)
          for (let py = 0; py < scaledPixels.length; py++) {
            const tileRow = scaledPixels[py];
            if (!tileRow) continue;

            const bufferY = screenY + py;
            if (bufferY < 0 || bufferY >= buffer.length) continue;

            for (let px = 0; px < tileRow.length; px++) {
              const bufferX = screenX + px;
              if (bufferX < 0 || bufferX >= buffer[bufferY]!.length) continue;

              const pixel = tileRow[px];
              if (pixel) {
                buffer[bufferY]![bufferX] = pixel;
                // Store the palette phase in world space (1..PHASES), not
                // merely a material flag. Screen-space phase fields repaint
                // the entire canal when the camera scrolls; world anchoring
                // lets the terminal codec shift those indexed cells intact.
                const isWater = scaledMaterialMask
                  ? ((scaledMaterialMask[py]?.[px] ?? 0) & 1) === 1
                  : tile.material === 'water';
                materialGrid[bufferY]![bufferX] = isWater
                  ? materialPhase(
                      Math.floor((worldTileX * this.tileRenderSize + px) / 2),
                      Math.floor((worldTileY * this.tileRenderSize + py) / 4),
                    ) + 1
                  : 0;
              }
            }
          }
        }
      }
    }
  }

  /**
   * Render road tiles on top of terrain (with transparency support and camera rotation)
   */
  private renderRoads(buffer: PixelGrid, materialGrid: Uint8Array[], world: WorldDataProvider, _origin: { x: number; y: number }): void {
    // Skip if world doesn't support roads
    if (!world.getRoadTileAt) return;

    const resKey = String(this.dataResolution);

    // Screen center in buffer coordinates
    const screenCenterX = buffer[0]!.length / 2;
    const screenCenterY = buffer.length / 2;

    // Exact visible tile range (rotation-aware, axis-aligned)
    const { startTileX, startTileY, endTileX, endTileY } =
      this.getVisibleTileBounds(buffer[0]!.length, buffer.length);

    for (let worldTileY = startTileY; worldTileY <= endTileY; worldTileY++) {
      for (let worldTileX = startTileX; worldTileX <= endTileX; worldTileX++) {
        const roadTile = world.getRoadTileAt(worldTileX, worldTileY);
        if (!roadTile) continue;

        // Get the appropriate resolution
        const tilePixels = roadTile.resolutions?.[resKey] ?? roadTile.pixels;

        // Scale to exact tile render size if needed (with caching by position)
        const frameId = `road:${worldTileX},${worldTileY}`;
        const scaledPixels = this.scaleFrame(tilePixels, this.tileRenderSize, this.tileRenderSize, frameId);

        // Calculate screen position with rotation
        // World pixel position of tile center
        const worldPixelX = (worldTileX + 0.5) * this.tileRenderSize;
        const worldPixelY = (worldTileY + 0.5) * this.tileRenderSize;
        // Transform to screen coordinates (offset from screen center)
        const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
        // Convert to buffer coordinates (top-left of tile)
        // Use Math.floor for consistent alignment of adjacent tiles
        const screenX = Math.floor(screenCenterX + screenOffset.x - this.tileRenderSize / 2);
        const screenY = Math.floor(screenCenterY + screenOffset.y - this.tileRenderSize / 2);

        // Copy road pixels to buffer (only non-transparent pixels)
        for (let py = 0; py < scaledPixels.length; py++) {
          const tileRow = scaledPixels[py];
          if (!tileRow) continue;

          const bufferY = screenY + py;
          if (bufferY < 0 || bufferY >= buffer.length) continue;

          for (let px = 0; px < tileRow.length; px++) {
            const bufferX = screenX + px;
            if (bufferX < 0 || bufferX >= buffer[bufferY]!.length) continue;

            const pixel = tileRow[px];
            if (pixel) {
              // Only overwrite if pixel is not transparent
              buffer[bufferY]![bufferX] = pixel;
              materialGrid[bufferY]![bufferX] = 0;
            }
          }
        }
      }
    }
  }

  /**
   * Render building tiles on top of terrain (with transparency support and camera rotation)
   */
  private renderBuildings(buffer: PixelGrid, materialGrid: Uint8Array[], world: WorldDataProvider, _origin: { x: number; y: number }): void {
    // Skip if world doesn't support buildings
    if (!world.getBuildingTileAt) return;

    const resKey = String(this.dataResolution);
    const buildingDirection = this.getBuildingDirection();

    // Screen center in buffer coordinates
    const screenCenterX = buffer[0]!.length / 2;
    const screenCenterY = buffer.length / 2;

    // Exact visible tile range (rotation-aware, axis-aligned)
    const { startTileX, startTileY, endTileX, endTileY } =
      this.getVisibleTileBounds(buffer[0]!.length, buffer.length);

    for (let worldTileY = startTileY; worldTileY <= endTileY; worldTileY++) {
      for (let worldTileX = startTileX; worldTileX <= endTileX; worldTileX++) {
        const buildingTile = world.getBuildingTileAt(worldTileX, worldTileY, buildingDirection);
        if (!buildingTile) continue;

        // Get the appropriate resolution
        const tilePixels = buildingTile.resolutions?.[resKey] ?? buildingTile.pixels;

        // Scale to exact tile render size if needed (with caching by position)
        const frameId = `building:${worldTileX},${worldTileY}:${buildingDirection}`;
        const scaledPixels = this.scaleFrame(tilePixels, this.tileRenderSize, this.tileRenderSize, frameId);

        // Calculate screen position with rotation
        // World pixel position of tile center
        const worldPixelX = (worldTileX + 0.5) * this.tileRenderSize;
        const worldPixelY = (worldTileY + 0.5) * this.tileRenderSize;
        // Transform to screen coordinates (offset from screen center)
        const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
        // Convert to buffer coordinates (top-left of tile)
        // Use Math.floor for consistent alignment of adjacent tiles
        const screenX = Math.floor(screenCenterX + screenOffset.x - this.tileRenderSize / 2);
        const screenY = Math.floor(screenCenterY + screenOffset.y - this.tileRenderSize / 2);

        // Copy building pixels to buffer (only non-transparent pixels)
        for (let py = 0; py < scaledPixels.length; py++) {
          const tileRow = scaledPixels[py];
          if (!tileRow) continue;

          const bufferY = screenY + py;
          if (bufferY < 0 || bufferY >= buffer.length) continue;

          for (let px = 0; px < tileRow.length; px++) {
            const bufferX = screenX + px;
            if (bufferX < 0 || bufferX >= buffer[bufferY]!.length) continue;

            const pixel = tileRow[px];
            if (pixel) {
              // Only overwrite if pixel is not transparent
              buffer[bufferY]![bufferX] = pixel;
              materialGrid[bufferY]![bufferX] = 0;
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
   * Uses caching when frameId is provided for performance
   */
  private scaleFrame(frame: PixelGrid, targetWidth: number, targetHeight: number, frameId?: string): PixelGrid {
    const srcHeight = frame.length;
    const srcWidth = frame[0]?.length ?? 0;

    // If already correct size, return as-is
    if (srcWidth === targetWidth && srcHeight === targetHeight) {
      return frame;
    }

    // Clear cache if tile size changed
    if (this.lastCacheClearSize !== this.tileRenderSize) {
      this.scaledFrameCache.clear();
      this.scaledFrameCacheOrder = [];
      this.scaledMaterialMaskCache.clear();
      this.scaledMaterialMaskCacheOrder = [];
      this.lastCacheClearSize = this.tileRenderSize;
    }

    // Check cache if we have an ID
    if (frameId) {
      const cacheKey = `${frameId}:${targetWidth}x${targetHeight}`;
      const cached = this.scaledFrameCache.get(cacheKey);
      if (cached) {
        return cached;
      }

      // Evict oldest entries if cache is full
      while (this.scaledFrameCacheOrder.length >= this.MAX_CACHE_SIZE) {
        const oldestKey = this.scaledFrameCacheOrder.shift();
        if (oldestKey) {
          this.scaledFrameCache.delete(oldestKey);
        }
      }

      // Scale and cache
      const result = this.scaleFrameUncached(frame, targetWidth, targetHeight);
      this.scaledFrameCache.set(cacheKey, result);
      this.scaledFrameCacheOrder.push(cacheKey);
      return result;
    }

    // No ID, scale without caching
    return this.scaleFrameUncached(frame, targetWidth, targetHeight);
  }

  /** Scale a frame without caching using area/bilinear reconstruction. */
  private scaleFrameUncached(frame: PixelGrid, targetWidth: number, targetHeight: number): PixelGrid {
    return resamplePixelGrid(frame, targetWidth, targetHeight);
  }

  /** Material ownership is categorical, so nearest-neighbour scaling is
   * deliberate even though colour uses area/bilinear reconstruction. */
  private scaleMaterialMask(
    mask: Uint8Array[],
    targetWidth: number,
    targetHeight: number,
    frameId: string,
  ): Uint8Array[] {
    const sourceHeight = mask.length;
    const sourceWidth = mask[0]?.length ?? 0;
    if (sourceWidth === targetWidth && sourceHeight === targetHeight) return mask;

    const cacheKey = `${frameId}:material:${targetWidth}x${targetHeight}`;
    const cached = this.scaledMaterialMaskCache.get(cacheKey);
    if (cached) return cached;

    const result = Array.from({ length: targetHeight }, (_, y) => {
      const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / targetHeight));
      const row = new Uint8Array(targetWidth);
      for (let x = 0; x < targetWidth; x++) {
        const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / targetWidth));
        row[x] = mask[sourceY]?.[sourceX] ?? 0;
      }
      return row;
    });

    while (this.scaledMaterialMaskCacheOrder.length >= this.MAX_CACHE_SIZE) {
      const oldestKey = this.scaledMaterialMaskCacheOrder.shift();
      if (oldestKey) this.scaledMaterialMaskCache.delete(oldestKey);
    }
    this.scaledMaterialMaskCache.set(cacheKey, result);
    this.scaledMaterialMaskCacheOrder.push(cacheKey);
    return result;
  }

  /**
   * Entity type union for combined player/NPC rendering
   */
  private isPlayer(entity: PlayerVisualState | NPCVisualState): entity is PlayerVisualState {
    return 'userId' in entity;
  }

  /**
   * Render players and NPCs to buffer with sub-pixel camera positioning and camera rotation
   * Both entity types are combined and Y-sorted for proper overlap rendering
   */
  private renderEntities(buffer: PixelGrid, materialGrid: Uint8Array[], world: WorldDataProvider, _tick: number, _origin: { x: number; y: number }): void {
    const players = world.getPlayers();
    const npcs = world.getNPCs?.() ?? [];
    const localId = world.getLocalPlayerId();

    // Screen center in buffer coordinates
    const screenCenterX = buffer[0]!.length / 2;
    const screenCenterY = buffer.length / 2;

    // Combine players and NPCs, precompute each entity's SCREEN Y once, then
    // sort numerically (the old comparator recomputed the rotation transform
    // for both operands on every comparison — O(n log n) transforms per frame)
    const sortable = [...players, ...npcs].map(e => ({
      e,
      sy: this.worldToScreen(
        e.x * this.tileRenderSize, e.y * this.tileRenderSize,
        this.cameraCenterX, this.cameraCenterY
      ).y,
    }));
    sortable.sort((a, b) => a.sy - b.sy);
    const sortedEntities = sortable.map(s => s.e);

    // Ground every actor before any sprite is painted. Keeping this as a
    // renderer-owned layer makes one transparent sprite work on paving,
    // bridges, grass, and future biomes while preserving correct occlusion.
    for (const entity of sortedEntities) {
      const worldPixelX = (entity.x + 0.5) * this.tileRenderSize;
      const worldPixelY = (entity.y + 0.5) * this.tileRenderSize;
      const screenOffset = this.worldToScreen(
        worldPixelX,
        worldPixelY,
        this.cameraCenterX,
        this.cameraCenterY,
      );
      this.renderEntityShadow(
        buffer,
        materialGrid,
        screenCenterX + screenOffset.x,
        screenCenterY + screenOffset.y + this.tileRenderSize / 2,
      );
    }

    for (const entity of sortedEntities) {
      const isPlayerEntity = this.isPlayer(entity);
      const entityId = isPlayerEntity ? entity.userId : entity.npcId;
      const entityName = isPlayerEntity ? entity.username : entity.name;

      // Get sprite based on entity type
      const sprite = isPlayerEntity
        ? world.getPlayerSprite(entity.userId)
        : world.getNPCSprite?.(entity.npcId);

      if (!sprite) {
        // Render placeholder if no sprite
        if (isPlayerEntity) {
          this.renderPlaceholderPlayer(buffer, materialGrid, entity, screenCenterX, screenCenterY);
        } else {
          this.renderPlaceholderNPC(buffer, materialGrid, entity, screenCenterX, screenCenterY);
        }
        continue;
      }

      // Use the pre-selected data resolution
      const resKey = String(this.dataResolution);

      // Remap direction based on camera rotation (world direction → visual direction)
      const visualDirection = this.getVisualDirection(entity.direction);

      // Try to get pre-computed resolution, fall back to base frames
      let directionFrames = sprite.resolutions?.[resKey]?.[visualDirection];
      if (!directionFrames) {
        directionFrames = sprite.frames[visualDirection];
      }

      const rawFrame = directionFrames[entity.animationFrame];
      if (!rawFrame) continue;

      // Scale to exact tile render size if needed (with caching)
      // Use visual direction in cache key since same world direction shows different sprite when rotated
      const entityType = isPlayerEntity ? 'player' : 'npc';
      const frameId = `${entityType}:${entityId}:${visualDirection}:${entity.animationFrame}`;
      const entityRenderSize = Math.max(
        this.tileRenderSize,
        Math.round(this.tileRenderSize * ENTITY_RENDER_SCALE),
      );
      const frame = this.scaleFrame(rawFrame, entityRenderSize, entityRenderSize, frameId);

      // Calculate screen position with rotation
      // World pixel position of entity (center of their tile)
      const worldPixelX = (entity.x + 0.5) * this.tileRenderSize;
      const worldPixelY = (entity.y + 0.5) * this.tileRenderSize;
      // Transform to screen coordinates (offset from screen center)
      const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
      // Convert to buffer coordinates (top-left of sprite)
      // Use Math.floor for consistent alignment with terrain tiles
      const screenX = Math.floor(screenCenterX + screenOffset.x - entityRenderSize / 2);
      const screenY = Math.floor(
        screenCenterY + screenOffset.y + this.tileRenderSize / 2 - entityRenderSize,
      );

      // Composite sprite onto buffer
      for (let py = 0; py < frame.length; py++) {
        const spriteRow = frame[py];
        if (!spriteRow) continue;

        const targetY = screenY + py;
        if (targetY < 0 || targetY >= buffer.length) continue;

        for (let px = 0; px < spriteRow.length; px++) {
          const pixel = spriteRow[px];
          if (pixel === null || pixel === undefined) continue;  // Transparent or undefined

          const targetX = screenX + px;
          if (targetX < 0 || targetX >= (buffer[targetY]?.length ?? 0)) continue;

          buffer[targetY]![targetX] = pixel;
          materialGrid[targetY]![targetX] = 0;
        }
      }

      // Add name overlay above sprite
      // For players: show username for other players (not self)
      // For NPCs: always show name
      const showOverlay = isPlayerEntity ? entity.userId !== localId : true;
      if (showOverlay) {
        // Center the name above the sprite
        const namePixelX = screenX + Math.floor(entityRenderSize / 2);
        const namePixelY = screenY - Math.max(6, Math.floor(this.tileRenderSize / 10));  // Scale overlay offset

        // NPCs get a slightly different color scheme (amber/gold text)
        const overlayColors = isPlayerEntity
          ? { bgColor: { r: 40, g: 40, b: 60 }, fgColor: { r: 255, g: 255, b: 255 } }  // Players: blue-gray bg, white text
          : { bgColor: { r: 60, g: 50, b: 30 }, fgColor: { r: 255, g: 200, b: 100 } }; // NPCs: brown bg, gold text

        this.pendingOverlays.push({
          text: entityName,
          pixelX: namePixelX,
          pixelY: namePixelY,
          ...overlayColors,
        });
      }
    }
  }

  private renderEntityShadow(
    buffer: PixelGrid,
    materialGrid: Uint8Array[],
    footX: number,
    footY: number,
  ): void {
    const radiusX = Math.max(2, this.tileRenderSize * 0.43);
    const radiusY = Math.max(1, this.tileRenderSize * 0.14);
    // The scene's established light is upper-left, so the soft cast component
    // falls slightly right/down from the feet while retaining contact.
    const centerX = footX + this.tileRenderSize * 0.13;
    const centerY = footY + this.tileRenderSize * 0.08;
    const minX = Math.floor(centerX - radiusX);
    const maxX = Math.ceil(centerX + radiusX);
    const minY = Math.floor(centerY - radiusY);
    const maxY = Math.ceil(centerY + radiusY);
    for (let y = minY; y <= maxY; y++) {
      if (y < 0 || y >= buffer.length) continue;
      for (let x = minX; x <= maxX; x++) {
        if (x < 0 || x >= (buffer[y]?.length ?? 0)) continue;
        const distance = ((x + 0.5 - centerX) / radiusX) ** 2 +
          ((y + 0.5 - centerY) / radiusY) ** 2;
        if (distance >= 1) continue;
        const pixel = buffer[y]![x];
        if (!pixel) continue;
        const strength = 0.18 + (1 - distance) * 0.18;
        buffer[y]![x] = {
          r: Math.round(pixel.r * (1 - strength)),
          g: Math.round(pixel.g * (1 - strength)),
          b: Math.round(pixel.b * (1 - strength)),
        };
        materialGrid[y]![x] = 0;
      }
    }
  }

  /**
   * Render a placeholder for players without sprites
   * This is a small fallback marker - the actual placeholder sprite is generated separately
   */
  private renderPlaceholderPlayer(buffer: PixelGrid, materialGrid: Uint8Array[], player: PlayerVisualState, screenCenterX: number, screenCenterY: number): void {
    // Calculate screen position with rotation
    const worldPixelX = (player.x + 0.5) * this.tileRenderSize;
    const worldPixelY = (player.y + 0.5) * this.tileRenderSize;
    const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
    // Use Math.floor for consistent alignment with terrain tiles
    const screenX = Math.floor(screenCenterX + screenOffset.x - this.tileRenderSize / 2);
    const screenY = Math.floor(screenCenterY + screenOffset.y - this.tileRenderSize / 2);

    // Marker is same size as current tile render size
    const markerSize = this.tileRenderSize;

    // Simple colored square placeholder
    const placeholderColor: RGB = { r: 255, g: 200, b: 50 };
    for (let py = 0; py < markerSize; py++) {
      for (let px = 0; px < markerSize; px++) {
        const targetY = screenY + py;
        const targetX = screenX + px;
        if (targetY >= 0 && targetY < buffer.length &&
            targetX >= 0 && targetX < (buffer[targetY]?.length ?? 0)) {
          buffer[targetY]![targetX] = placeholderColor;
          materialGrid[targetY]![targetX] = 0;
        }
      }
    }
  }

  /**
   * Render a placeholder for NPCs without sprites
   * Uses a different color scheme to distinguish from players
   */
  private renderPlaceholderNPC(buffer: PixelGrid, materialGrid: Uint8Array[], npc: NPCVisualState, screenCenterX: number, screenCenterY: number): void {
    // Calculate screen position with rotation
    const worldPixelX = (npc.x + 0.5) * this.tileRenderSize;
    const worldPixelY = (npc.y + 0.5) * this.tileRenderSize;
    const screenOffset = this.worldToScreen(worldPixelX, worldPixelY, this.cameraCenterX, this.cameraCenterY);
    // Use Math.floor for consistent alignment with terrain tiles
    const screenX = Math.floor(screenCenterX + screenOffset.x - this.tileRenderSize / 2);
    const screenY = Math.floor(screenCenterY + screenOffset.y - this.tileRenderSize / 2);

    // Marker is same size as current tile render size
    const markerSize = this.tileRenderSize;

    // NPC placeholder color (amber/orange to distinguish from yellow player)
    const placeholderColor: RGB = { r: 255, g: 150, b: 50 };
    for (let py = 0; py < markerSize; py++) {
      for (let px = 0; px < markerSize; px++) {
        const targetY = screenY + py;
        const targetX = screenX + px;
        if (targetY >= 0 && targetY < buffer.length &&
            targetX >= 0 && targetX < (buffer[targetY]?.length ?? 0)) {
          buffer[targetY]![targetX] = placeholderColor;
          materialGrid[targetY]![targetX] = 0;
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
   * Resize viewport (tile-based)
   */
  resize(widthTiles: number, heightTiles: number): void {
    this.config.widthTiles = widthTiles;
    this.config.heightTiles = heightTiles;
  }

  /**
   * Set exact pixel dimensions for the viewport
   * This allows filling the entire screen with partial tiles at edges
   */
  setPixelDimensions(pixelWidth: number, pixelHeight: number): void {
    this.config.pixelWidth = pixelWidth;
    this.config.pixelHeight = pixelHeight;
  }

  /**
   * Get current pixel dimensions
   */
  getPixelDimensions(): { width: number; height: number } {
    return {
      width: this.config.pixelWidth ?? (this.config.widthTiles * this.tileRenderSize),
      height: this.config.pixelHeight ?? (this.config.heightTiles * this.tileRenderSize),
    };
  }
}
