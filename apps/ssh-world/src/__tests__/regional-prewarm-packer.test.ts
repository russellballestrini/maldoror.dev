import type { BuildingTileData, PixelGrid, Tile } from '@maldoror/protocol';
import type { RegionalPreparedViewport } from '@maldoror/world';
import { describe, expect, it } from 'vitest';
import {
  packRegionalPreparedViewport,
  regionalPackedViewportTransferList,
} from '../game/regional-prewarm-packer.js';

describe('regional prepared viewport packing', () => {
  it('preserves RGBA, material, walkability, overlay coordinates, and collision in transferable planes', () => {
    const terrainPixels: PixelGrid = [
      [{ r: 1, g: 2, b: 3 }, { r: 4, g: 5, b: 6 }],
      [{ r: 7, g: 8, b: 9 }, { r: 10, g: 11, b: 12 }],
    ];
    const terrain: Tile = {
      id: 'terrain',
      name: 'terrain',
      pixels: terrainPixels,
      materialMask: [new Uint8Array([1, 0]), new Uint8Array([0, 0])],
      walkable: true,
    };
    const overlayPixels: PixelGrid = [
      [null, { r: 20, g: 30, b: 40, a: 128 }],
      [{ r: 50, g: 60, b: 70 }, null],
    ];
    const overlay: BuildingTileData = { pixels: overlayPixels, resolutions: { '2': overlayPixels } };
    const source: RegionalPreparedViewport = {
      version: 1,
      worldSeed: '42',
      bounds: { minX: 5, minY: 7, maxX: 5, maxY: 7 },
      resolution: 2,
      terrain: [{ x: 5, y: 7, tile: terrain }],
      overlays: [{ x: 5, y: 7, tile: overlay }],
      solid: [[5, 7]],
    };
    const packed = packRegionalPreparedViewport(source);

    expect([...packed.terrainRgba]).toEqual([
      1, 2, 3, 255, 4, 5, 6, 255,
      7, 8, 9, 255, 10, 11, 12, 255,
    ]);
    expect([...packed.terrainMaterial]).toEqual([1, 0, 0, 0]);
    expect([...packed.terrainWalkable]).toEqual([1]);
    expect([...packed.overlayCoordinates]).toEqual([5, 7]);
    expect([...packed.overlayRgba]).toEqual([
      0, 0, 0, 0, 20, 30, 40, 128,
      50, 60, 70, 255, 0, 0, 0, 0,
    ]);
    expect([...packed.solid]).toEqual([1]);

    const transferred = structuredClone(packed, {
      transfer: regionalPackedViewportTransferList(packed),
    });
    expect(transferred.terrainRgba.byteLength).toBe(16);
    expect(packed.terrainRgba.byteLength).toBe(0);
  });
});
