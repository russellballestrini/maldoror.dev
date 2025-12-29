import { useState, useEffect } from 'react';
import type { TerrainChunk } from '../state/WorldContext';

export function useTerrainChunks() {
  const [terrainChunks, setTerrainChunks] = useState<TerrainChunk[]>([]);
  const [chunkSize, setChunkSize] = useState(16);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchChunks = async () => {
      try {
        const response = await fetch('/api/terrain-chunks');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setTerrainChunks(data.chunks || []);
        setChunkSize(data.chunkSize || 16);
        setError(null);
      } catch (err) {
        console.error('Failed to fetch terrain chunks:', err);
        setError(err instanceof Error ? err.message : 'Failed to fetch terrain');
      } finally {
        setLoading(false);
      }
    };

    fetchChunks();
    // Terrain doesn't change often, no need to poll
  }, []);

  return { terrainChunks, chunkSize, loading, error };
}
