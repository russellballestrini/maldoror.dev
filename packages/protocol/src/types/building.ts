import type { PixelGrid } from './pixel.js';

/**
 * A single tile within a building
 * Each tile is 256x256 pixels at base resolution with pre-computed zoom levels
 */
export interface BuildingTile {
  pixels: PixelGrid; // Base 256x256 resolution
  resolutions: Record<string, PixelGrid>; // All zoom levels [26, 51, 77, 102, 128, 154, 179, 205, 230, 256]
}

/**
 * A complete building sprite - 3x3 grid of tiles
 * Buildings are placed with the anchor at the bottom-center tile
 *
 * Layout (looking down):
 *   [0,0] [1,0] [2,0]   ← top row
 *   [0,1] [1,1] [2,1]   ← middle row
 *   [0,2] [1,2] [2,2]   ← bottom row (anchor at [1,2])
 */
export interface BuildingSprite {
  width: 3;  // Always 3 tiles wide
  height: 3; // Always 3 tiles tall
  tiles: BuildingTile[][]; // [y][x] - 3x3 array, row-major
}

/**
 * Building data as stored/loaded
 */
export interface Building {
  id: string;
  ownerId: string;
  anchorX: number;
  anchorY: number;
  prompt: string;
  modelUsed?: string;
  createdAt: Date;
}

/**
 * Building with its sprite data loaded
 */
export interface BuildingWithSprite extends Building {
  sprite: BuildingSprite;
}

/**
 * Get all tile positions occupied by a building given its anchor position
 * Returns array of [x, y] coordinates for all 9 tiles
 */
export function getBuildingTilePositions(anchorX: number, anchorY: number): Array<[number, number]> {
  const positions: Array<[number, number]> = [];
  for (let dy = 0; dy < 3; dy++) {
    for (let dx = 0; dx < 3; dx++) {
      // Anchor is at [1, 2] (bottom-center), so offset accordingly
      const x = anchorX + (dx - 1); // -1, 0, +1
      const y = anchorY + (dy - 2); // -2, -1, 0
      positions.push([x, y]);
    }
  }
  return positions;
}

/**
 * Check if a world position is within a building's footprint
 */
export function isPositionInBuilding(
  worldX: number,
  worldY: number,
  anchorX: number,
  anchorY: number
): boolean {
  const relX = worldX - anchorX;
  const relY = worldY - anchorY;
  // Building extends from anchor: x: [-1, 0, +1], y: [-2, -1, 0]
  return relX >= -1 && relX <= 1 && relY >= -2 && relY <= 0;
}

/**
 * Get the tile index within a building for a world position
 * Returns [tileX, tileY] or null if position is outside building
 */
export function getBuildingTileIndex(
  worldX: number,
  worldY: number,
  anchorX: number,
  anchorY: number
): [number, number] | null {
  const relX = worldX - anchorX;
  const relY = worldY - anchorY;

  if (relX < -1 || relX > 1 || relY < -2 || relY > 0) {
    return null;
  }

  // Convert to tile index: relX -1..+1 → tileX 0..2, relY -2..0 → tileY 0..2
  const tileX = relX + 1;
  const tileY = relY + 2;
  return [tileX, tileY];
}
