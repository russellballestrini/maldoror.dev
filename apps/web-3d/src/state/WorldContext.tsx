import { createContext, useContext } from 'react';

export interface WorldData {
  seed: string;
  chunkSize: number;
  tileSize: number;
}

export interface Entity {
  id: string;
  type: 'player' | 'building' | 'npc' | 'auton' | 'road';
  x: number;
  y: number;
  spriteUrl?: string;
  modelUrl?: string;
  name?: string;
  direction?: 'north' | 'east' | 'south' | 'west';
  online?: boolean;
  lastSeen?: string;
  tiles?: { x: number; y: number; url: string }[];
  isMoving?: boolean;
}

export interface TerrainChunk {
  chunkX: number;
  chunkY: number;
  tiles: string[][]; // [y][x] tile IDs
}

export interface WorldContextValue {
  worldData: WorldData | null;
  entities: Entity[];
  terrainChunks: TerrainChunk[];
  chunkSize: number;
}

export const WorldContext = createContext<WorldContextValue | null>(null);

export function useWorld() {
  const context = useContext(WorldContext);
  if (!context) {
    throw new Error('useWorld must be used within WorldContext.Provider');
  }
  return context;
}
