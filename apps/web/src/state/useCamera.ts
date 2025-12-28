import { useState, useCallback, useMemo } from 'react';
import type { Camera } from './WorldContext';

const ZOOM_LEVELS = [0.03125, 0.0625, 0.125, 0.25, 0.5, 1];
const DEFAULT_ZOOM = 0.25;

export function useCamera(): Camera {
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [zoom, setZoomState] = useState(DEFAULT_ZOOM);

  const pan = useCallback((dx: number, dy: number) => {
    setX(prev => prev + dx);
    setY(prev => prev + dy);
  }, []);

  const setPosition = useCallback((newX: number, newY: number) => {
    setX(newX);
    setY(newY);
  }, []);

  const setZoom = useCallback((newZoom: number) => {
    const clamped = Math.max(ZOOM_LEVELS[0], Math.min(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], newZoom));
    setZoomState(clamped);
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        const nextIndex = ZOOM_LEVELS.findIndex(z => z > prev);
        return nextIndex === -1 ? ZOOM_LEVELS[ZOOM_LEVELS.length - 1] : ZOOM_LEVELS[nextIndex];
      }
      return currentIndex < ZOOM_LEVELS.length - 1 ? ZOOM_LEVELS[currentIndex + 1] : prev;
    });
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState(prev => {
      const currentIndex = ZOOM_LEVELS.indexOf(prev);
      if (currentIndex === -1) {
        const nextIndex = ZOOM_LEVELS.findIndex(z => z >= prev);
        return nextIndex <= 0 ? ZOOM_LEVELS[0] : ZOOM_LEVELS[nextIndex - 1];
      }
      return currentIndex > 0 ? ZOOM_LEVELS[currentIndex - 1] : prev;
    });
  }, []);

  return useMemo(() => ({
    x,
    y,
    zoom,
    pan,
    setPosition,
    setZoom,
    zoomIn,
    zoomOut,
  }), [x, y, zoom, pan, setPosition, setZoom, zoomIn, zoomOut]);
}
