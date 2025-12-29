import { useState, useEffect } from 'react';
import type { WorldData } from '../state/WorldContext';

export function useWorldData() {
  const [worldData, setWorldData] = useState<WorldData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchWorldData() {
      try {
        const response = await fetch('/api/world');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setWorldData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch world data');
      } finally {
        setLoading(false);
      }
    }

    fetchWorldData();
  }, []);

  return { worldData, loading, error };
}
