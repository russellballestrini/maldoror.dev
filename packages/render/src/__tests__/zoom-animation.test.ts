import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PixelGameRenderer } from '../pixel/pixel-game-renderer.js';

afterEach(() => vi.useRealTimers());

describe('PixelGameRenderer zoom animation', () => {
  it('interpolates toward a discrete LOD target over wall-clock time', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      zoomLevel: 30,
      paletteAnimation: false,
    });

    renderer.zoomIn();
    expect(renderer.getTargetZoomLevel()).toBe(40);
    expect(renderer.getZoomLevel()).toBe(30);

    renderer.advanceAnimations(1_090);
    expect(renderer.getZoomLevel()).toBeGreaterThan(30);
    expect(renderer.getZoomLevel()).toBeLessThan(40);

    renderer.advanceAnimations(1_180);
    expect(renderer.getZoomLevel()).toBe(40);
  });

  it('primes a saved spawn without easing from the origin', () => {
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      paletteAnimation: false,
    });

    renderer.setZoomLevel(30);
    renderer.primeCamera(517, -231);

    expect(renderer.getCameraTilePosition()).toEqual({ x: 517, y: -231 });
    expect(renderer.getCameraCenter()).toEqual({ x: 6210, y: -2766 });
  });

  it('synchronizes the retained follow camera when snapping from free mode', () => {
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      zoomLevel: 30,
      paletteAnimation: false,
    });

    renderer.primeCamera(80, 40);
    renderer.setCameraMode('free');
    renderer.panCameraByTiles(12, -7);
    renderer.setCamera(83, 42);
    renderer.snapCameraToPlayer();

    expect(renderer.getCameraTilePosition()).toEqual({ x: 83, y: 42 });
  });

  it('reports target LOD and rotation-aware bounds for off-thread preparation', () => {
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      zoomLevel: 30,
      paletteAnimation: false,
    });

    expect(renderer.getWorldPreparationGeometry()).toEqual({
      resolution: 12,
      viewportRadiusX: 16,
      viewportRadiusY: 10,
    });
    renderer.rotateCameraClockwise();
    expect(renderer.getWorldPreparationGeometry()).toEqual({
      resolution: 12,
      viewportRadiusX: 10,
      viewportRadiusY: 16,
    });
    renderer.zoomOut();
    expect(renderer.getWorldPreparationGeometry().resolution).toBe(9);
  });
});
