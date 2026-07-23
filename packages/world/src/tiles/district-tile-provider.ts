import type { Tile, PixelGrid } from '@maldoror/protocol';
import { TileProvider, type TileProviderConfig } from './tile-provider.js';

/**
 * A TileProvider whose TERRAIN is a pre-sliced "district" image (a dense,
 * cohesive canal-town scene generated in the mockup style) rather than
 * procedural noise. Buildings/props/water are baked into the district art;
 * this provider just serves the image tiles + a per-tile walkability flag.
 *
 * Everything else (players, NPCs, sprites, camera) is inherited from
 * TileProvider unchanged, so the district drops straight into the live game:
 * the player walks around a painting-quality town rendered in octant.
 *
 * Tiles are fed in via loadDistrict() (the image is decoded with sharp in the
 * app layer; the world package stays image-library-free).
 */
export class DistrictTileProvider extends TileProvider {
  private districtTiles: Map<string, Tile> = new Map();
  private widthTiles = 0;
  private heightTiles = 0;
  private edgeWater: Tile | null = null;

  constructor(config: TileProviderConfig) {
    super(config);
  }

  /**
   * @param tiles       "x,y" -> Tile (pixels + walkable + resolutions), the sliced district
   * @param widthTiles  district width in tiles
   * @param heightTiles district height in tiles
   * @param edgeWater   tile to show outside the district bounds (non-walkable)
   */
  loadDistrict(tiles: Map<string, Tile>, widthTiles: number, heightTiles: number, edgeWater: Tile | null): void {
    this.districtTiles = tiles;
    this.widthTiles = widthTiles;
    this.heightTiles = heightTiles;
    this.edgeWater = edgeWater;
  }

  getDimensions(): { width: number; height: number } {
    return { width: this.widthTiles, height: this.heightTiles };
  }

  /** True if (x,y) is inside the district and walkable. */
  isWalkable(x: number, y: number): boolean {
    const t = this.districtTiles.get(`${x},${y}`);
    return !!t && t.walkable;
  }

  override getTile(tileX: number, tileY: number): Tile | null {
    const t = this.districtTiles.get(`${tileX},${tileY}`);
    if (t) return t;
    // Outside the district: non-walkable water so the player can't wander off
    return this.edgeWater;
  }

  // District art already contains buildings/roads — suppress the overlays.
  override getRoadTileAt(): Tile | null {
    return null;
  }
  override getBuildingTileAt(): null {
    return null;
  }

  /** Convenience: a solid pixel grid (used to build the edge-water tile). */
  static solidGrid(size: number, r: number, g: number, b: number): PixelGrid {
    const grid: PixelGrid = [];
    for (let y = 0; y < size; y++) {
      const row = [];
      for (let x = 0; x < size; x++) row.push({ r, g, b });
      grid.push(row);
    }
    return grid;
  }
}
