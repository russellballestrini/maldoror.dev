import { useState, useEffect } from 'react';
import type { Entity } from '../state/WorldContext';

export function useEntities() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchEntities() {
      try {
        const response = await fetch('/api/entities');
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        setEntities(data.entities || []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch entities');
      } finally {
        setLoading(false);
      }
    }

    fetchEntities();
  }, []);

  return { entities, loading, error };
}
