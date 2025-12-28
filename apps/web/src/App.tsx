import { useEffect, useState } from 'react';
import { WorldCanvas } from './components/WorldCanvas';
import { CoordinateDisplay } from './components/CoordinateDisplay';
import { ZoomControls } from './components/ZoomControls';
import { Minimap } from './components/Minimap';
import { LoadingOverlay } from './components/LoadingOverlay';
import { useWorldData } from './api/useWorldData';
import { useEntities } from './api/useEntities';
import { useCamera } from './state/useCamera';
import { WorldContext } from './state/WorldContext';

import './styles.css';

const VERSION = 'v2.0.1';

export function App() {
  const { worldData, loading: worldLoading, error: worldError } = useWorldData();
  const { entities, loading: entitiesLoading, error: entitiesError } = useEntities();
  const camera = useCamera();
  const [showMinimap, setShowMinimap] = useState(true);
  const [showGrid, setShowGrid] = useState(false);

  // Parse URL hash for initial position
  useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const params = new URLSearchParams(hash);
      const x = params.get('x');
      const y = params.get('y');
      const zoom = params.get('zoom');
      if (x && y) {
        camera.setPosition(parseInt(x), parseInt(y));
      }
      if (zoom) {
        camera.setZoom(parseFloat(zoom));
      }
    }
  }, []);

  // Update URL hash when camera moves
  useEffect(() => {
    const hash = `x=${Math.round(camera.x)}&y=${Math.round(camera.y)}&zoom=${camera.zoom}`;
    window.history.replaceState(null, '', `#${hash}`);
  }, [camera.x, camera.y, camera.zoom]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;

      const panSpeed = e.shiftKey ? 10 : 1;

      switch (e.key.toLowerCase()) {
        case 'arrowup':
        case 'w':
          camera.pan(0, -panSpeed);
          e.preventDefault();
          break;
        case 'arrowdown':
        case 's':
          camera.pan(0, panSpeed);
          e.preventDefault();
          break;
        case 'arrowleft':
        case 'a':
          camera.pan(-panSpeed, 0);
          e.preventDefault();
          break;
        case 'arrowright':
        case 'd':
          camera.pan(panSpeed, 0);
          e.preventDefault();
          break;
        case '=':
        case '+':
          camera.zoomIn();
          e.preventDefault();
          break;
        case '-':
          camera.zoomOut();
          e.preventDefault();
          break;
        case 'm':
          setShowMinimap(prev => !prev);
          break;
        case 'g':
          setShowGrid(prev => !prev);
          break;
        case 'h':
          camera.setPosition(0, 0);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [camera]);

  const loading = worldLoading || entitiesLoading;
  const error = worldError || entitiesError;

  if (error) {
    return (
      <div className="error-screen">
        <h1>Failed to load world data</h1>
        <p>{error}</p>
        <button onClick={() => window.location.reload()}>Retry</button>
      </div>
    );
  }

  return (
    <WorldContext.Provider value={{ worldData, entities, camera, showGrid }}>
      {loading && <LoadingOverlay />}

      <WorldCanvas />

      <CoordinateDisplay x={camera.x} y={camera.y} />

      <ZoomControls
        zoom={camera.zoom}
        onZoomIn={camera.zoomIn}
        onZoomOut={camera.zoomOut}
      />

      {showMinimap && (
        <Minimap
          cameraX={camera.x}
          cameraY={camera.y}
          onNavigate={(x, y) => camera.setPosition(x, y)}
        />
      )}

      <div className="keyboard-hints">
        <span>WASD/Arrows: Pan</span>
        <span>+/-: Zoom</span>
        <span>M: Minimap</span>
        <span>G: Grid</span>
        <span>H: Home</span>
      </div>

      <div className="version-indicator">{VERSION}</div>
    </WorldContext.Provider>
  );
}
