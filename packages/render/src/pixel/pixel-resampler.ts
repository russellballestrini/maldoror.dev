import type { PackedPixelGrid, Pixel, PixelGrid, RGB } from '@maldoror/protocol';

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

/** Resample a compact immutable raster without first expanding its complete
 * source plane into RGB objects. The math and accumulation order intentionally
 * mirror resamplePixelGrid so packing is a representation change, not a visual
 * filter change. */
export function resamplePackedPixelGrid(
  packed: PackedPixelGrid,
  targetWidth: number,
  targetHeight: number,
): PixelGrid {
  validatePackedPixelGrid(packed);
  if (targetWidth <= 0 || targetHeight <= 0) return [];
  if (targetWidth <= packed.width && targetHeight <= packed.height) {
    return areaResamplePacked(packed, targetWidth, targetHeight);
  }
  return bilinearResamplePacked(packed, targetWidth, targetHeight);
}

function areaResamplePacked(
  packed: PackedPixelGrid,
  targetWidth: number,
  targetHeight: number,
): PixelGrid {
  const result: PixelGrid = [];
  const scaleX = packed.width / targetWidth;
  const scaleY = packed.height / targetHeight;
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
          if (sy < 0 || sy >= packed.height || sx < 0 || sx >= packed.width) continue;
          const offset = (sy * packed.width + sx) * 4;
          const alpha = packed.data[offset + 3]!;
          if (alpha === 0 || weight === 0) continue;
          const alphaWeight = weight * alpha / 255;
          red += packed.data[offset]! * alphaWeight;
          green += packed.data[offset + 1]! * alphaWeight;
          blue += packed.data[offset + 2]! * alphaWeight;
          opaqueWeight += alphaWeight;
        }
      }
      row.push(opaqueWeight / totalWeight < 0.02
        ? null
        : rgba(red, green, blue, opaqueWeight, totalWeight));
    }
    result.push(row);
  }
  return result;
}

function bilinearResamplePacked(
  packed: PackedPixelGrid,
  targetWidth: number,
  targetHeight: number,
): PixelGrid {
  const result: PixelGrid = [];
  for (let y = 0; y < targetHeight; y++) {
    const sourceY = ((y + 0.5) * packed.height / targetHeight) - 0.5;
    const y0 = Math.max(0, Math.floor(sourceY));
    const y1 = Math.min(packed.height - 1, y0 + 1);
    const fy = Math.max(0, sourceY - y0);
    const row: Pixel[] = [];
    for (let x = 0; x < targetWidth; x++) {
      const sourceX = ((x + 0.5) * packed.width / targetWidth) - 0.5;
      const x0 = Math.max(0, Math.floor(sourceX));
      const x1 = Math.min(packed.width - 1, x0 + 1);
      const fx = Math.max(0, sourceX - x0);
      const samples: Array<readonly [number, number]> = [
        [(y0 * packed.width + x0) * 4, (1 - fx) * (1 - fy)],
        [(y0 * packed.width + x1) * 4, fx * (1 - fy)],
        [(y1 * packed.width + x0) * 4, (1 - fx) * fy],
        [(y1 * packed.width + x1) * 4, fx * fy],
      ];
      let red = 0, green = 0, blue = 0, opaqueWeight = 0;
      for (const [offset, weight] of samples) {
        const alpha = packed.data[offset + 3]!;
        if (alpha === 0 || weight === 0) continue;
        const alphaWeight = weight * alpha / 255;
        red += packed.data[offset]! * alphaWeight;
        green += packed.data[offset + 1]! * alphaWeight;
        blue += packed.data[offset + 2]! * alphaWeight;
        opaqueWeight += alphaWeight;
      }
      row.push(opaqueWeight < 0.02 ? null : rgba(red, green, blue, opaqueWeight, 1));
    }
    result.push(row);
  }
  return result;
}

function validatePackedPixelGrid(packed: PackedPixelGrid): void {
  if (!Number.isInteger(packed.width) || !Number.isInteger(packed.height) ||
      packed.width < 1 || packed.height < 1 || packed.data.length !== packed.width * packed.height * 4) {
    throw new Error('Packed pixel grid dimensions do not match its RGBA plane');
  }
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
          const alphaWeight = weight * pixelAlpha(pixel);
          red += pixel.r * alphaWeight;
          green += pixel.g * alphaWeight;
          blue += pixel.b * alphaWeight;
          opaqueWeight += alphaWeight;
        }
      }
      row.push(opaqueWeight / totalWeight < 0.02
        ? null
        : rgba(red, green, blue, opaqueWeight, totalWeight));
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
        const alphaWeight = weight * pixelAlpha(pixel);
        red += pixel.r * alphaWeight;
        green += pixel.g * alphaWeight;
        blue += pixel.b * alphaWeight;
        opaqueWeight += alphaWeight;
      }
      row.push(opaqueWeight < 0.02 ? null : rgba(red, green, blue, opaqueWeight, 1));
    }
    result.push(row);
  }
  return result;
}

function pixelAlpha(pixel: RGB): number {
  return Math.max(0, Math.min(255, pixel.a ?? 255)) / 255;
}

function rgba(red: number, green: number, blue: number, weight: number, totalWeight: number): RGB {
  const result: RGB = {
    r: Math.round(red / weight),
    g: Math.round(green / weight),
    b: Math.round(blue / weight),
  };
  const alpha = Math.round(255 * weight / totalWeight);
  if (alpha < 255) result.a = alpha;
  return result;
}
