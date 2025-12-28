import { createContext, useContext } from 'react';

export interface WorldData {
  seed: string;
  chunkSize: number;
  tileSize: number;
}

export interface Entity {
  id: string;
  type: 'player' | 'building' | 'npc' | 'road';
  x: number;
  y: number;
  spriteUrl?: string;
  name?: string;
  direction?: 'north' | 'east' | 'south' | 'west';
  online?: boolean;
  lastSeen?: string;
  tiles?: { x: number; y: number; url: string }[];
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  pan: (dx: number, dy: number) => void;
  setPosition: (x: number, y: number) => void;
  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export interface WorldContextValue {
  worldData: WorldData | null;
  entities: Entity[];
  camera: Camera;
  showGrid: boolean;
}

export const WorldContext = createContext<WorldContextValue | null>(null);

export function useWorld() {
  const context = useContext(WorldContext);
  if (!context) {
    throw new Error('useWorld must be used within WorldContext.Provider');
  }
  return context;
}
