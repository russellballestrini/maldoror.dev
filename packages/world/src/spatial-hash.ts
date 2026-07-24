/**
 * Deterministic signed-coordinate hash for spatial generation.
 *
 * Each axis is multiplied independently before two avalanche stages. This is
 * deliberately shared by the macro biome/route fields and regional overlays:
 * the earlier folded-axis mixers preserved horizontal correlations that became
 * visible rows over travel-scale bounds.
 */
export function spatialHash2DUint32(
  seed: number,
  x: number,
  y: number,
  salt: number,
): number {
  let value = (seed ^ salt ^ Math.imul(Math.trunc(x), 0x9e3779b1)) | 0;
  value = Math.imul(value ^ (value >>> 16), 0x85ebca6b);
  value ^= Math.imul(Math.trunc(y), 0xc2b2ae35);
  value = Math.imul(value ^ (value >>> 13), 0x27d4eb2d);
  value ^= value >>> 16;
  return value >>> 0;
}

export function spatialHash2DUnit(
  seed: number,
  x: number,
  y: number,
  salt: number,
): number {
  return spatialHash2DUint32(seed, x, y, salt) / 0x1_0000_0000;
}
