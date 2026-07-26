import type { PackedPixelGrid, PixelGrid } from '@maldoror/protocol';
import { resamplePackedPixelGrid, resamplePixelGrid } from '@maldoror/render';
import type {
  RegionalPackedPreparedViewport,
  RegionalPreparedViewport,
} from '@maldoror/world';

/** Collapse a generator-side object graph into six transferable planes and a
 * compact, time-live placement program. The
 * overlay plane is resampled with the production painterly filter before
 * packing, so the main renderer receives the exact semantic display LOD. */
export function packRegionalPreparedViewport(
  source: RegionalPreparedViewport,
): RegionalPackedPreparedViewport {
  const width = source.bounds.maxX - source.bounds.minX + 1;
  const height = source.bounds.maxY - source.bounds.minY + 1;
  const area = width * height;
  const pixelsPerTile = source.resolution * source.resolution;
  const bytesPerTile = pixelsPerTile * 4;
  if (source.terrain.length !== area) throw new Error('Regional viewport terrain is incomplete before packing');

  const terrainRgba = new Uint8Array(area * bytesPerTile);
  const terrainMaterial = new Uint8Array(area * pixelsPerTile);
  const terrainWalkable = new Uint8Array(area);
  for (let index = 0; index < source.terrain.length; index++) {
    const entry = source.terrain[index]!;
    const expectedX = source.bounds.minX + index % width;
    const expectedY = source.bounds.minY + Math.floor(index / width);
    if (entry.x !== expectedX || entry.y !== expectedY) {
      throw new Error(`Regional viewport terrain packing order mismatch at ${entry.x},${entry.y}`);
    }
    const grid = displayGrid(
      entry.tile.pixels,
      entry.tile.resolutions?.[String(source.resolution)],
      entry.tile.packedPixels,
      source.resolution,
    );
    packGridInto(grid, terrainRgba, index * bytesPerTile);
    packMaterialInto(entry.tile.materialMask, terrainMaterial, index * pixelsPerTile, source.resolution);
    terrainWalkable[index] = Number(entry.tile.walkable);
  }

  const overlayCoordinates = new Int32Array(source.overlays.length * 2);
  const overlayRgba = new Uint8Array(source.overlays.length * bytesPerTile);
  for (let index = 0; index < source.overlays.length; index++) {
    const entry = source.overlays[index]!;
    overlayCoordinates[index * 2] = entry.x;
    overlayCoordinates[index * 2 + 1] = entry.y;
    const grid = displayGrid(
      entry.tile.pixels,
      entry.tile.resolutions[String(source.resolution)],
      entry.tile.packedPixels,
      source.resolution,
    );
    packGridInto(grid, overlayRgba, index * bytesPerTile);
  }

  const solid = new Uint8Array(area);
  for (const [x, y] of source.solid) {
    const index = (y - source.bounds.minY) * width + x - source.bounds.minX;
    if (index < 0 || index >= area) throw new Error(`Regional viewport solid packing bounds mismatch: ${x},${y}`);
    solid[index] = 1;
  }
  return {
    version: 3,
    worldSeed: source.worldSeed,
    bounds: source.bounds,
    resolution: source.resolution,
    terrainRgba,
    terrainMaterial,
    terrainWalkable,
    overlayCoordinates,
    overlayRgba,
    solid,
    dynamicPlacements: source.dynamicPlacements.map((placement) => ({ ...placement })),
  };
}

export function regionalPackedViewportTransferList(
  viewport: RegionalPackedPreparedViewport,
): ArrayBuffer[] {
  return [
    viewport.terrainRgba.buffer,
    viewport.terrainMaterial.buffer,
    viewport.terrainWalkable.buffer,
    viewport.overlayCoordinates.buffer,
    viewport.overlayRgba.buffer,
    viewport.solid.buffer,
  ] as ArrayBuffer[];
}

function displayGrid(
  base: PixelGrid,
  exact: PixelGrid | undefined,
  packed: PackedPixelGrid | undefined,
  resolution: number,
): PixelGrid {
  if (packed) return resamplePackedPixelGrid(packed, resolution, resolution);
  const grid = exact ?? base;
  if (grid.length === resolution && grid[0]?.length === resolution) return grid;
  return resamplePixelGrid(grid, resolution, resolution);
}

function packGridInto(grid: PixelGrid, target: Uint8Array, offset: number): void {
  let write = offset;
  for (const row of grid) {
    for (const pixel of row) {
      if (pixel) {
        target[write] = pixel.r;
        target[write + 1] = pixel.g;
        target[write + 2] = pixel.b;
        target[write + 3] = pixel.a ?? 255;
      }
      write += 4;
    }
  }
}

function packMaterialInto(
  material: Uint8Array[] | undefined,
  target: Uint8Array,
  offset: number,
  resolution: number,
): void {
  if (!material || material.length === 0) return;
  const sourceHeight = material.length;
  const sourceWidth = material[0]?.length ?? 0;
  for (let y = 0; y < resolution; y++) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * sourceHeight / resolution));
    for (let x = 0; x < resolution; x++) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * sourceWidth / resolution));
      target[offset + y * resolution + x] = material[sourceY]?.[sourceX] ?? 0;
    }
  }
}
