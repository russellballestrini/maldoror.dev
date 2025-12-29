import { useState, useEffect, useCallback } from 'react';
import type { Entity } from '../state/WorldContext';

const POLL_INTERVAL = 1000; // 1 second polling

export function useEntities() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntities = useCallback(async () => {
    try {
      const response = await fetch('/api/entities');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      setEntities(data.entities || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch entities');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEntities();

    // Poll for updates
    const interval = setInterval(fetchEntities, POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [fetchEntities]);

  return { entities, loading, error };
}
