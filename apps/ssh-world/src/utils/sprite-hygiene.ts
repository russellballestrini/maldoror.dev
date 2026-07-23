import type { PixelGrid } from '@maldoror/protocol';

/**
 * Sprite edge hygiene: remove the baked-in dark anti-aliased fringe.
 *
 * Historical sprites were pixelated with a permissive alpha threshold (32),
 * which turned the artwork's anti-aliased edge into a contiguous 1-2px
 * near-black halo of OPAQUE pixels. When the renderer nearest-neighbour
 * downscales the 256px base to tile size, that halo samples into scattered
 * black speckles around every player/NPC.
 *
 * Fix at load time (covers all existing assets):
 *  - Pass A (x2): erode dark pixels that touch transparency — the halo is
 *    contiguous, so neighbour-count tests can't find it; adjacency to air can.
 *    1-2px of erosion at 256px is invisible after downscale.
 *  - Pass B: drop isolated floating specks (<=2 opaque neighbours).
 *
 * Solid dark regions (boots, outlines) only lose their outermost edge pixel
 * and survive intact.
 */
export function despeckleSpriteFrame(
  grid: PixelGrid,
  erodePasses: number = 2,
  lumMax: number = 90
): PixelGrid {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;

  for (let pass = 0; pass < erodePasses; pass++) {
    const kill: Array<[number, number]> = [];
    for (let y = 0; y < h; y++) {
      const row = grid[y]!;
      for (let x = 0; x < w; x++) {
        const p = row[x];
        if (!p) continue;
        const lum = 0.299 * p.r + 0.587 * p.g + 0.114 * p.b;
        if (lum >= lumMax) continue;
        let touchesAir = false;
        for (let dy = -1; dy <= 1 && !touchesAir; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const ny = y + dy;
            const nx = x + dx;
            if (ny < 0 || ny >= h || nx < 0 || nx >= w || !grid[ny]![nx]) {
              touchesAir = true;
              break;
            }
          }
        }
        if (touchesAir) kill.push([y, x]);
      }
    }
    for (const [y, x] of kill) grid[y]![x] = null;
    if (kill.length === 0) break;
  }

  // Pass B: isolated speck cleanup
  const kill: Array<[number, number]> = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!grid[y]![x]) continue;
      let opaque = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          if (grid[y + dy]?.[x + dx]) opaque++;
        }
      }
      if (opaque <= 2) kill.push([y, x]);
    }
  }
  for (const [y, x] of kill) grid[y]![x] = null;

  return grid;
}
