import sharp from 'sharp';
import type { Tile, PixelGrid, Pixel } from '@maldoror/protocol';


/**
 * Decode a district PNG into a tile map for DistrictTileProvider.
 *
 * The district art is a dense canal-town scene (mockup style). We slice it into
 * `tilePx`-sized tiles, classify each tile's walkability (block water/deep
 * shadow; the tan flagstone paths + steps + bridges are walkable), and build a
 * resolution pyramid per tile so the octant renderer stays crisp at any zoom.
 */
export interface LoadedDistrict {
  tiles: Map<string, Tile>;
  widthTiles: number;
  heightTiles: number;
}

export async function loadDistrict(pngPath: string, tilePx = 32): Promise<LoadedDistrict> {
  const meta = await sharp(pngPath).metadata();
  // Use the native image size (no upscale). Each tile stores ONLY its base
  // pixels (tilePx²) — NO resolution pyramid. The renderer's scaled-frame cache
  // downscales visible tiles to the on-screen size on demand. (A per-tile
  // pyramid up to 256px would be gigabytes for a whole district — never do it.)
  const wTiles = Math.floor((meta.width ?? 1536) / tilePx);
  const hTiles = Math.floor((meta.height ?? 1024) / tilePx);

  const { data, info } = await sharp(pngPath)
    .resize(wTiles * tilePx, hTiles * tilePx, { fit: 'fill' })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const stride = info.width;

  const tiles = new Map<string, Tile>();
  for (let ty = 0; ty < hTiles; ty++) {
    for (let tx = 0; tx < wTiles; tx++) {
      const pixels: PixelGrid = [];
      let blocked = 0, total = 0;
      for (let y = 0; y < tilePx; y++) {
        const row: Pixel[] = [];
        for (let x = 0; x < tilePx; x++) {
          const i = ((ty * tilePx + y) * stride + (tx * tilePx + x)) * 4;
          const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
          row.push({ r, g, b });
          const bright = (r + g + b) / 3;
          // BLOCKED if water (teal/blue dominant) or deep shadow. Walkable = rest
          // (tan flagstone, steps, bridges). Roofs stay walkable in v1 — good
          // enough to explore; refined collision comes later.
          const isWater = (b > r + 6 && g > r - 6 && b > 90) || (g > r + 8 && b > r + 2 && b > 110);
          const isDark = bright < 70;
          if (isWater || isDark) blocked++;
          total++;
        }
        pixels.push(row);
      }
      const walkable = blocked / total < 0.45;
      tiles.set(`${tx},${ty}`, {
        id: `district:${tx},${ty}`,
        name: 'district',
        pixels,      // base only; renderer downscales + caches on demand
        walkable,
      });
    }
  }
  return { tiles, widthTiles: wTiles, heightTiles: hTiles };
}
