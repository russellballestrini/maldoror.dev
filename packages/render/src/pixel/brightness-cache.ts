/**
 * Pre-computed Brightness Variants Cache
 *
 * Pre-generates brightness-modified versions of tiles/cells to avoid
 * runtime multiplication. Brightness levels are quantized for cache efficiency.
 */

import type { RGB, PixelGrid } from '@maldoror/protocol';
import { perfStats } from './perf-stats.js';

/**
 * Default brightness levels to pre-compute
 * 5 levels from dim (0.7) to bright (1.3)
 */
export const BRIGHTNESS_LEVELS = [0.7, 0.85, 1.0, 1.15, 1.3] as const;

/**
 * Map a continuous brightness value to the nearest pre-computed level
 */
export function quantizeBrightness(brightness: number): number {
  // Find closest level
  let closest: number = BRIGHTNESS_LEVELS[0]!;
  let minDist = Math.abs(brightness - closest);

  for (const level of BRIGHTNESS_LEVELS) {
    const dist = Math.abs(brightness - level);
    if (dist < minDist) {
      minDist = dist;
      closest = level;
    }
  }

  return closest;
}

/**
 * Apply brightness to a single color
 */
function applyBrightnessToColor(color: RGB, brightness: number): RGB {
  return {
    r: Math.min(255, Math.max(0, Math.round(color.r * brightness))),
    g: Math.min(255, Math.max(0, Math.round(color.g * brightness))),
    b: Math.min(255, Math.max(0, Math.round(color.b * brightness))),
  };
}

/**
 * Apply brightness to a pixel grid
 */
function applyBrightnessToGrid(grid: PixelGrid, brightness: number): PixelGrid {
  if (brightness === 1.0) return grid;

  return grid.map(row =>
    row.map(pixel =>
      pixel === null ? null : applyBrightnessToColor(pixel, brightness)
    )
  );
}

/**
 * Cache key for brightness variants
 */
function cacheKey(id: string, brightness: number): string {
  return `${id}:${brightness.toFixed(2)}`;
}

/**
 * Brightness Variant Cache
 *
 * Pre-computes and caches brightness-modified versions of pixel grids.
 * Use for tiles, sprites, or any repeated pixel data.
 */
class BrightnessVariantCache {
  private cache: Map<string, PixelGrid> = new Map();
  private maxSize: number;
  private accessOrder: string[] = [];

  constructor(maxSize: number = 2000) {
    this.maxSize = maxSize;
  }

  /**
   * Get or generate a brightness variant for a pixel grid
   */
  get(id: string, grid: PixelGrid, brightness: number): PixelGrid {
    // Quantize brightness to reduce variants
    const quantized = quantizeBrightness(brightness);

    // Fast path: no brightness change needed
    if (quantized === 1.0) {
      return grid;
    }

    const key = cacheKey(id, quantized);

    // Check cache
    const cached = this.cache.get(key);
    if (cached) {
      perfStats.recordBrightness(true);
      // Move to end of access order (LRU)
      const idx = this.accessOrder.indexOf(key);
      if (idx !== -1) {
        this.accessOrder.splice(idx, 1);
        this.accessOrder.push(key);
      }
      return cached;
    }

    // Generate and cache
    perfStats.recordBrightness(false, 1);
    const variant = applyBrightnessToGrid(grid, quantized);

    // Evict if needed
    while (this.cache.size >= this.maxSize && this.accessOrder.length > 0) {
      const oldest = this.accessOrder.shift();
      if (oldest) {
        this.cache.delete(oldest);
      }
    }

    this.cache.set(key, variant);
    this.accessOrder.push(key);

    return variant;
  }

  /**
   * Pre-generate all brightness variants for a grid
   * Call at startup for frequently used tiles
   */
  pregenerate(id: string, grid: PixelGrid): void {
    for (const level of BRIGHTNESS_LEVELS) {
      if (level !== 1.0) {
        const key = cacheKey(id, level);
        if (!this.cache.has(key)) {
          const variant = applyBrightnessToGrid(grid, level);
          this.cache.set(key, variant);
          this.accessOrder.push(key);
          perfStats.recordBrightness(false, 1);
        }
      }
    }
  }

  /**
   * Clear the cache
   */
  clear(): void {
    this.cache.clear();
    this.accessOrder = [];
  }

  /**
   * Get cache size
   */
  get size(): number {
    return this.cache.size;
  }

  /**
   * Get cache statistics
   */
  getStats(): { size: number; maxSize: number } {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
    };
  }
}

// Singleton instance for global use
export const brightnessCache = new BrightnessVariantCache();

/**
 * Pre-generate brightness variants for a collection of tiles
 * Call at world/game initialization
 */
export function pregenerateBrightnessVariants(
  tiles: Array<{ id: string; pixels: PixelGrid }>
): void {
  console.log(`[PerfOpt] Pre-generating brightness variants for ${tiles.length} tiles...`);
  const startTime = Date.now();

  for (const tile of tiles) {
    brightnessCache.pregenerate(tile.id, tile.pixels);
  }

  const elapsed = Date.now() - startTime;
  console.log(`[PerfOpt] Generated ${brightnessCache.size} brightness variants in ${elapsed}ms`);
}
