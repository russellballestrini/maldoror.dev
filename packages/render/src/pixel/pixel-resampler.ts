import type { Pixel, PixelGrid, RGB } from '@maldoror/protocol';

/** Painterly assets need area integration when shrinking; nearest-neighbour
 * aliases roof tiles, flowers, and paving into unstable noise. Upscaling uses
 * transparency-aware bilinear interpolation. */
export function resamplePixelGrid(grid: PixelGrid, targetWidth: number, targetHeight: number): PixelGrid {
  const sourceHeight = grid.length;
  const sourceWidth = grid[0]?.length ?? 0;
  if (sourceWidth === 0 || sourceHeight === 0 || targetWidth <= 0 || targetHeight <= 0) return [];
  if (sourceWidth === targetWidth && sourceHeight === targetHeight) return grid;
  if (targetWidth <= sourceWidth && targetHeight <= sourceHeight) {
    return areaResample(grid, sourceWidth, sourceHeight, targetWidth, targetHeight);
  }
  return bilinearResample(grid, sourceWidth, sourceHeight, targetWidth, targetHeight);
}

function areaResample(
  grid: PixelGrid,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): PixelGrid {
  const result: PixelGrid = [];
  const scaleX = sourceWidth / targetWidth;
  const scaleY = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y++) {
    const row: Pixel[] = [];
    const y0 = y * scaleY;
    const y1 = (y + 1) * scaleY;
    for (let x = 0; x < targetWidth; x++) {
      const x0 = x * scaleX;
      const x1 = (x + 1) * scaleX;
      let red = 0, green = 0, blue = 0, opaqueWeight = 0;
      const totalWeight = (x1 - x0) * (y1 - y0);
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy++) {
        const overlapY = Math.max(0, Math.min(y1, sy + 1) - Math.max(y0, sy));
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx++) {
          const overlapX = Math.max(0, Math.min(x1, sx + 1) - Math.max(x0, sx));
          const weight = overlapX * overlapY;
          const pixel = grid[sy]?.[sx] ?? null;
          if (!pixel || weight === 0) continue;
          red += pixel.r * weight;
          green += pixel.g * weight;
          blue += pixel.b * weight;
          opaqueWeight += weight;
        }
      }
      row.push(opaqueWeight / totalWeight < 0.12 ? null : rgb(red, green, blue, opaqueWeight));
    }
    result.push(row);
  }
  return result;
}

function bilinearResample(
  grid: PixelGrid,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): PixelGrid {
  const result: PixelGrid = [];
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = ((y + 0.5) * sourceHeight / targetHeight) - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = Math.max(0, sourceY - y0);
    const row: Pixel[] = [];
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = ((x + 0.5) * sourceWidth / targetWidth) - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = Math.max(0, sourceX - x0);
      const samples: Array<[Pixel, number]> = [
        [grid[y0]?.[x0] ?? null, (1 - fx) * (1 - fy)],
        [grid[y0]?.[x1] ?? null, fx * (1 - fy)],
        [grid[y1]?.[x0] ?? null, (1 - fx) * fy],
        [grid[y1]?.[x1] ?? null, fx * fy],
      ];
      let red = 0, green = 0, blue = 0, opaqueWeight = 0;
      for (const [pixel, weight] of samples) {
        if (!pixel || weight === 0) continue;
        red += pixel.r * weight;
        green += pixel.g * weight;
        blue += pixel.b * weight;
        opaqueWeight += weight;
      }
      row.push(opaqueWeight < 0.12 ? null : rgb(red, green, blue, opaqueWeight));
    }
    result.push(row);
  }
  return result;
}

function rgb(red: number, green: number, blue: number, weight: number): RGB {
  return {
    r: Math.round(red / weight),
    g: Math.round(green / weight),
    b: Math.round(blue / weight),
  };
}
