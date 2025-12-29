import { useWorldData } from './api/useWorldData';
import { useEntities } from './api/useEntities';
import { useTerrainChunks } from './api/useTerrainChunks';
import { WorldContext } from './state/WorldContext';
import { World3D } from './components/World3D';

const VERSION = 'v0.3.0';

export function App() {
  const { worldData, loading: worldLoading, error: worldError } = useWorldData();
  const { entities, loading: entitiesLoading, error: entitiesError } = useEntities();
  const { terrainChunks, chunkSize, loading: terrainLoading } = useTerrainChunks();

  const loading = worldLoading || entitiesLoading || terrainLoading;
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
    <WorldContext.Provider value={{ worldData, entities, terrainChunks, chunkSize }}>
      {loading && (
        <div className="loading-overlay">
          <h1>Maldoror 3D</h1>
          <div className="loading-spinner" />
          <p style={{ marginTop: '1rem', color: '#888' }}>Loading world...</p>
        </div>
      )}

      <div className="canvas-container">
        <World3D />
      </div>

      <div className="keyboard-hints">
        <span>WASD: Move</span>
        <span>QE: Up/Down</span>
        <span>Drag: Orbit</span>
        <span>Scroll: Zoom</span>
        <span>Click: Focus</span>
      </div>

      <div className="version-indicator">{VERSION}</div>
    </WorldContext.Provider>
  );
}
