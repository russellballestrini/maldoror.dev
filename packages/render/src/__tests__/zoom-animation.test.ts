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

  it('invalidates the cached HUD position as visual movement crosses a tile boundary', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      paletteAnimation: false,
    });
    const renderStatsBar = () => (
      renderer as unknown as { renderStatsBar(): string }
    ).renderStatsBar();

    renderer.setCamera(0, 0);
    expect(renderStatsBar()).toContain('(0, 0)');

    // This is still inside the normal one-second stats TTL. The coordinate
    // change itself must invalidate the cache, and the HUD must never expose
    // the animation's fractional camera coordinate.
    vi.setSystemTime(1_050);
    renderer.setCamera(0.6, 0);
    expect(renderStatsBar()).toContain('(1, 0)');
  });

  it('can acknowledge an accepted tile before the visual camera finishes crossing it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      paletteAnimation: false,
    });
    const renderStatsBar = () => (
      renderer as unknown as { renderStatsBar(): string }
    ).renderStatsBar();

    renderer.setCamera(0.1, 0);
    renderer.setAuthoritativePosition(1, 0);

    expect(renderStatsBar()).toContain('(1, 0)');
    expect(renderer.getCameraTilePosition().x).toBeCloseTo(0.1, 10);
    expect(renderer.getCameraTilePosition().y).toBe(0);
  });

  it('emits a synchronized header-only accepted-position response', () => {
    const renderer = new PixelGameRenderer({
      stream: new PassThrough(),
      cols: 160,
      rows: 46,
      renderMode: 'octant',
      paletteAnimation: false,
    });
    renderer.initialize();

    const response = renderer.renderPositionAcknowledgement(4, -3);

    expect(response).toContain('\x1b[?2026h');
    expect(response).toContain('Pos: ');
    expect(response).toContain('(4, -3)');
    expect(response).toContain('\x1b[?2026l');
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
